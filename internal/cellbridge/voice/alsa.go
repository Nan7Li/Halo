// Adapted from CellBridge gateway/internal/voice/alsa.go
// Upstream commit 2ee9d6b05d8a4391f782e6ce8a6d23ef57015fda
// Copyright (c) 2026 CellBridge contributors
// License: MIT (LICENSES/cellbridge-MIT.txt)
//
// Local changes: a playback start failure reaps the capture process that
// already started; Start and Stop do not hold the mutex across process
// waits; device names are validated before exec; process creation is
// injectable so the lifecycle can be tested without hardware.

package voice

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"sync"
	"time"
)

const (
	SampleRate   = 8000
	Channels     = 1
	FrameSamples = SampleRate / 50

	// ALSA runs on 20 ms periods with 200 ms of headroom. The old 128 ms
	// periods delivered the downlink in bursts the browser could not
	// smooth, and playback only started once a full second was queued.
	alsaPeriod = FrameSamples
	alsaBuffer = 10 * FrameSamples
	// Playback starts once 60 ms is in the device.
	alsaStartDelay = "60000"

	// Uplink jitter buffer in front of aplay: wait for 60 ms after running
	// dry, keep at most 300 ms, and cut a backlog back to 120 ms.
	uplinkPrebuffer = 3 * FrameSamples
	uplinkMax       = 15 * FrameSamples
	uplinkKeep      = 6 * FrameSamples
)

var deviceNamePattern = regexp.MustCompile(`^[A-Za-z0-9_:,.=-]{1,80}$`)

// waitTimeout bounds a child Wait after Kill. Tests shorten it.
var waitTimeout = 3 * time.Second

// Audio runs arecord and aplay against one USB audio device. Capture is
// started first: on the QDC507 gadget, starting playback first locks the
// full-duplex clock and capture stays silent.
type Audio struct {
	captureDevice  string
	playbackDevice string

	mu        sync.Mutex
	epoch     uint64
	call      string
	starting  bool
	closed    bool
	capture   child
	playback  child
	rx        io.ReadCloser
	tx        io.WriteCloser
	txMu      sync.Mutex
	primeStop chan struct{}
	prime     bool
	upMu      sync.Mutex
	upQueue   []int16
	upPrimed  bool
	upErr     error
	spawn     spawner
	once      sync.Once
	watch     sync.WaitGroup
}

type child interface {
	Start() error
	Kill() error
	Wait() error
	StdoutPipe() (io.ReadCloser, error)
	StdinPipe() (io.WriteCloser, error)
}

type spawner func(name string, args ...string) (child, error)

type execChild struct {
	cmd      *exec.Cmd
	waitOnce sync.Once
	waitErr  error
}

func (child *execChild) Start() error { return child.cmd.Start() }
func (child *execChild) Kill() error {
	if child.cmd.Process == nil {
		return nil
	}
	return child.cmd.Process.Kill()
}
func (child *execChild) Wait() error {
	child.waitOnce.Do(func() { child.waitErr = child.cmd.Wait() })
	return child.waitErr
}
func (child *execChild) StdoutPipe() (io.ReadCloser, error) { return child.cmd.StdoutPipe() }
func (child *execChild) StdinPipe() (io.WriteCloser, error) { return child.cmd.StdinPipe() }

func defaultSpawn(name string, args ...string) (child, error) {
	cmd := exec.Command(name, args...)
	cmd.Stderr = io.Discard
	return &execChild{cmd: cmd}, nil
}

// OpenALSA checks the device names and returns a stopped audio pair.
func OpenALSA(captureDevice, playbackDevice string) (*Audio, error) {
	if err := ValidateDevice(captureDevice); err != nil {
		return nil, fmt.Errorf("capture device: %w", err)
	}
	if err := ValidateDevice(playbackDevice); err != nil {
		return nil, fmt.Errorf("playback device: %w", err)
	}
	return &Audio{
		captureDevice:  captureDevice,
		playbackDevice: playbackDevice,
		prime:          true,
		spawn:          defaultSpawn,
	}, nil
}

// ValidateDevice rejects empty names and shell metacharacters. arecord and
// aplay receive the name as one argument, and this keeps a configured value
// from being mistaken for a command.
func ValidateDevice(name string) error {
	if !deviceNamePattern.MatchString(name) {
		return fmt.Errorf("ALSA device %q is invalid", name)
	}
	return nil
}

// Probe reports whether the host has arecord and aplay. A missing tool is an
// unavailable reason, not a successful audio path.
func Probe(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, err := exec.LookPath("arecord"); err != nil {
		return fmt.Errorf("arecord is unavailable: %w", err)
	}
	if _, err := exec.LookPath("aplay"); err != nil {
		return fmt.Errorf("aplay is unavailable: %w", err)
	}
	return nil
}

func reap(proc child) {
	if proc == nil {
		return
	}
	_ = proc.Kill()
	done := make(chan struct{})
	go func() {
		_ = proc.Wait()
		close(done)
	}()
	timer := time.NewTimer(waitTimeout)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
	}
}

// Start opens capture, then playback. The mutex is not held while a child
// starts or while a failed child is reaped.
func (audio *Audio) Start(ctx context.Context, callID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if callID == "" {
		return errors.New("ALSA call id is required")
	}
	audio.mu.Lock()
	if audio.closed {
		audio.mu.Unlock()
		return errors.New("ALSA audio is closed")
	}
	if audio.starting {
		audio.mu.Unlock()
		return errors.New("ALSA audio is starting")
	}
	if audio.call != "" && audio.call != callID {
		current := audio.call
		audio.mu.Unlock()
		return fmt.Errorf("ALSA audio is already active for call %s", current)
	}
	if audio.call == callID && !audio.starting {
		audio.mu.Unlock()
		return nil
	}
	epoch := audio.epoch
	audio.call = callID
	audio.starting = true
	audio.mu.Unlock()

	abort := func(capture, playback child, rx io.ReadCloser, tx io.WriteCloser, err error) error {
		if rx != nil {
			_ = rx.Close()
		}
		if tx != nil {
			_ = tx.Close()
		}
		reap(capture)
		reap(playback)
		audio.mu.Lock()
		if audio.epoch == epoch && audio.call == callID {
			audio.call = ""
			audio.starting = false
		}
		audio.mu.Unlock()
		return err
	}

	capture, err := audio.spawn("arecord", "-q", "-D", audio.captureDevice, "-t", "raw", "-f", "S16_LE", "-r", fmt.Sprint(SampleRate), "-c", fmt.Sprint(Channels), "--buffer-size="+fmt.Sprint(alsaBuffer), "--period-size="+fmt.Sprint(alsaPeriod))
	if err != nil {
		return abort(nil, nil, nil, nil, fmt.Errorf("create ALSA capture: %w", err))
	}
	playback, err := audio.spawn("aplay", "-q", "-D", audio.playbackDevice, "-t", "raw", "-f", "S16_LE", "-r", fmt.Sprint(SampleRate), "-c", fmt.Sprint(Channels), "--buffer-size="+fmt.Sprint(alsaBuffer), "--period-size="+fmt.Sprint(alsaPeriod), "--start-delay="+alsaStartDelay)
	if err != nil {
		return abort(nil, nil, nil, nil, fmt.Errorf("create ALSA playback: %w", err))
	}
	rx, err := capture.StdoutPipe()
	if err != nil {
		return abort(capture, playback, nil, nil, fmt.Errorf("create ALSA capture pipe: %w", err))
	}
	tx, err := playback.StdinPipe()
	if err != nil {
		return abort(capture, playback, rx, nil, fmt.Errorf("create ALSA playback pipe: %w", err))
	}
	if err := capture.Start(); err != nil {
		return abort(capture, playback, rx, tx, fmt.Errorf("start ALSA capture: %w", err))
	}
	if err := playback.Start(); err != nil {
		// arecord is already running. Reap it even though it was never published.
		return abort(capture, playback, rx, tx, fmt.Errorf("start ALSA playback: %w", err))
	}
	if err := ctx.Err(); err != nil {
		return abort(capture, playback, rx, tx, err)
	}

	audio.mu.Lock()
	if audio.epoch != epoch || audio.call != callID {
		audio.mu.Unlock()
		_ = rx.Close()
		_ = tx.Close()
		reap(capture)
		reap(playback)
		return errors.New("ALSA start was cancelled")
	}
	audio.capture = capture
	audio.playback = playback
	audio.rx = rx
	audio.tx = tx
	audio.starting = false
	var primeStop chan struct{}
	if audio.prime {
		primeStop = make(chan struct{})
		audio.primeStop = primeStop
		audio.upMu.Lock()
		audio.upQueue, audio.upPrimed, audio.upErr = audio.upQueue[:0], false, nil
		audio.upMu.Unlock()
	}
	proc, monitored := playback.(*execChild)
	if monitored {
		audio.watch.Add(1)
	}
	audio.mu.Unlock()
	if monitored {
		go func() {
			defer audio.watch.Done()
			_ = proc.Wait()
			// A dead playback child closes capture too. Its EOF lets the
			// controller clear MediaReady and report the audio failure.
			_ = audio.stop(callID, epoch, true)
		}()
	}
	if primeStop != nil {
		go audio.primeLoop(callID, primeStop)
	}
	return nil
}

// primeLoop is the only writer to aplay while prime is on. Every 20 ms of
// wall clock it writes one frame: the next queued uplink frame, or silence.
// The QDC507 needs playback fed without gaps from the moment the call
// starts, and pacing here (instead of writing whenever the browser or SIP
// client sends) means late or bunched packets cannot leave holes in the
// uplink or stack silence between words.
func (audio *Audio) primeLoop(callID string, stop chan struct{}) {
	const period = 20 * time.Millisecond
	ticker := time.NewTicker(period)
	defer ticker.Stop()
	started := time.Now()
	var written int64
	for {
		select {
		case <-stop:
			return
		case now := <-ticker.C:
			audio.mu.Lock()
			active := audio.call == callID
			audio.mu.Unlock()
			if !active {
				return
			}
			// Catch up on ticks the runtime dropped; after a long stall,
			// start counting again instead of flooding the device.
			due := int64(now.Sub(started)/period) - written
			if due > 5 {
				started = now
				written = 0
				due = 1
			}
			for ; due > 0; due-- {
				if err := audio.writeNow(audio.nextUplinkFrame()); err != nil {
					audio.upMu.Lock()
					audio.upErr = err
					audio.upMu.Unlock()
					return
				}
				written++
			}
		}
	}
}

// nextUplinkFrame takes one 20 ms frame from the uplink queue, or silence
// while the queue refills.
func (audio *Audio) nextUplinkFrame() []int16 {
	frame := make([]int16, FrameSamples)
	audio.upMu.Lock()
	defer audio.upMu.Unlock()
	if !audio.upPrimed {
		if len(audio.upQueue) < uplinkPrebuffer {
			return frame
		}
		audio.upPrimed = true
	}
	taken := copy(frame, audio.upQueue)
	audio.upQueue = audio.upQueue[:copy(audio.upQueue, audio.upQueue[taken:])]
	if taken < FrameSamples {
		audio.upPrimed = false
	}
	return frame
}

func (audio *Audio) snapshot() (io.ReadCloser, io.WriteCloser, string) {
	audio.mu.Lock()
	defer audio.mu.Unlock()
	return audio.rx, audio.tx, audio.call
}

// ReadPCM reads one caller-sized block of signed little-endian samples.
func (audio *Audio) ReadPCM(samples []int16) (int, error) {
	rx, _, callID := audio.snapshot()
	if callID == "" || rx == nil {
		return 0, errors.New("ALSA audio is not active")
	}
	if len(samples) == 0 {
		return 0, nil
	}
	buffer := make([]byte, len(samples)*2)
	count, err := io.ReadFull(rx, buffer)
	for index := 0; index+1 < count; index += 2 {
		samples[index/2] = int16(binary.LittleEndian.Uint16(buffer[index : index+2]))
	}
	return count / 2, err
}

// WritePCM queues signed samples for playback. With prime on, primeLoop
// paces them into aplay; otherwise they are written straight through.
func (audio *Audio) WritePCM(samples []int16) error {
	_, tx, callID := audio.snapshot()
	if callID == "" || tx == nil {
		return errors.New("ALSA audio is not active")
	}
	if len(samples) == 0 {
		return nil
	}
	audio.mu.Lock()
	paced := audio.primeStop != nil
	audio.mu.Unlock()
	if !paced {
		return audio.writeNow(samples)
	}
	return audio.enqueueUplink(samples)
}

// enqueueUplink adds samples to the paced queue, cutting a backlog (a
// sender clock running fast, or a burst after a stall) back to 120 ms.
func (audio *Audio) enqueueUplink(samples []int16) error {
	audio.upMu.Lock()
	defer audio.upMu.Unlock()
	if audio.upErr != nil {
		return audio.upErr
	}
	audio.upQueue = append(audio.upQueue, samples...)
	if len(audio.upQueue) > uplinkMax {
		drop := len(audio.upQueue) - uplinkKeep
		audio.upQueue = audio.upQueue[:copy(audio.upQueue, audio.upQueue[drop:])]
	}
	return nil
}

// writeNow writes samples to the aplay pipe.
func (audio *Audio) writeNow(samples []int16) error {
	_, tx, callID := audio.snapshot()
	if callID == "" || tx == nil {
		return errors.New("ALSA audio is not active")
	}
	buffer := make([]byte, len(samples)*2)
	for index, sample := range samples {
		binary.LittleEndian.PutUint16(buffer[index*2:], uint16(sample))
	}
	audio.txMu.Lock()
	defer audio.txMu.Unlock()
	_, err := tx.Write(buffer)
	return err
}

// Stop reaps only the processes this audio value published or, if Start is
// still in flight, bumps the epoch so Start reaps its own children.
func (audio *Audio) Stop(context.Context) error {
	return audio.stop("", 0, false)
}

func (audio *Audio) stop(callID string, epoch uint64, conditional bool) error {
	audio.mu.Lock()
	if conditional && (audio.call != callID || audio.epoch != epoch) {
		audio.mu.Unlock()
		return nil
	}
	audio.epoch++
	capture, playback := audio.capture, audio.playback
	rx, tx := audio.rx, audio.tx
	primeStop := audio.primeStop
	audio.capture, audio.playback, audio.rx, audio.tx = nil, nil, nil, nil
	audio.primeStop = nil
	audio.call = ""
	audio.starting = false
	audio.mu.Unlock()

	if primeStop != nil {
		close(primeStop)
	}
	if rx != nil {
		_ = rx.Close()
	}
	if tx != nil {
		_ = tx.Close()
	}
	reap(capture)
	reap(playback)
	return nil
}

// Close stops the pair once.
func (audio *Audio) Close() error {
	var err error
	audio.once.Do(func() {
		audio.mu.Lock()
		audio.closed = true
		audio.mu.Unlock()
		err = audio.Stop(context.Background())
		audio.watch.Wait()
	})
	return err
}

// ActiveCall returns the call id that owns the pair, if any.
func (audio *Audio) ActiveCall() string {
	audio.mu.Lock()
	defer audio.mu.Unlock()
	return audio.call
}
