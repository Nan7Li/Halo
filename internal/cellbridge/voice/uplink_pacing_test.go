package voice

import (
	"context"
	"encoding/binary"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

// capturingChild records what is written to aplay's stdin.
type capturingChild struct {
	fakeChild
	mu      sync.Mutex
	written []int16
	args    []string
}

func (child *capturingChild) StdinPipe() (io.WriteCloser, error) {
	reader, writer := io.Pipe()
	go func() {
		buffer := make([]byte, 640)
		for {
			count, err := io.ReadFull(reader, buffer[:320])
			child.mu.Lock()
			for index := 0; index+1 < count; index += 2 {
				child.written = append(child.written, int16(binary.LittleEndian.Uint16(buffer[index:])))
			}
			child.mu.Unlock()
			if err != nil {
				return
			}
		}
	}()
	return writer, nil
}

func (child *capturingChild) samples() []int16 {
	child.mu.Lock()
	defer child.mu.Unlock()
	return append([]int16(nil), child.written...)
}

func TestPacedUplinkKeepsBurstySpeechContiguous(t *testing.T) {
	playback := &capturingChild{}
	audio := testAudio(t, func(name string, args ...string) (child, error) {
		if name == "aplay" {
			playback.args = args
			return playback, nil
		}
		return &fakeChild{name: name}, nil
	})
	audio.prime = true
	if err := audio.Start(context.Background(), "call"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(playback.args, " "), "--period-size=160") {
		t.Fatalf("aplay args %v", playback.args)
	}
	// 600 ms of speech (non-zero ramp) arriving in 43 ms bursts, the way
	// the old browser code sent it.
	const total = 4800
	sent := 0
	for sent < total {
		burst := make([]int16, 341)
		for index := range burst {
			burst[index] = int16(1 + (sent+index)%1000)
		}
		if sent+len(burst) > total {
			burst = burst[:total-sent]
		}
		if err := audio.WritePCM(burst); err != nil {
			t.Fatal(err)
		}
		sent += len(burst)
		time.Sleep(43 * time.Millisecond)
	}
	time.Sleep(400 * time.Millisecond)
	written := playback.samples()
	first := -1
	for index, sample := range written {
		if sample != 0 {
			first = index
			break
		}
	}
	if first < 0 {
		t.Fatal("no speech reached aplay")
	}
	speech := written[first:]
	if len(speech) < total {
		t.Fatalf("only %d of %d speech samples reached aplay", len(speech), total)
	}
	for index := 0; index < total; index++ {
		if want := int16(1 + index%1000); speech[index] != want {
			t.Fatalf("sample %d = %d, want %d (silence inserted or samples lost)", index, speech[index], want)
		}
	}
}

func TestPacedUplinkCutsBacklogAndRefillsAfterRunningDry(t *testing.T) {
	audio, err := OpenALSA("plughw:1,0", "plughw:1,0")
	if err != nil {
		t.Fatal(err)
	}
	if frame := audio.nextUplinkFrame(); len(frame) != FrameSamples || frame[0] != 0 {
		t.Fatal("empty queue must give one frame of silence")
	}
	speech := make([]int16, uplinkMax+FrameSamples)
	for index := range speech {
		speech[index] = int16(index)
	}
	if err := audio.enqueueUplink(speech); err != nil {
		t.Fatal(err)
	}
	if len(audio.upQueue) != uplinkKeep {
		t.Fatalf("backlog cut to %d, want %d", len(audio.upQueue), uplinkKeep)
	}
	// The newest audio survives the cut.
	if last := audio.upQueue[len(audio.upQueue)-1]; last != speech[len(speech)-1] {
		t.Fatalf("kept %d, want the newest sample", last)
	}
	for len(audio.upQueue) >= FrameSamples {
		audio.nextUplinkFrame()
	}
	// Dry: a single short frame must wait for the 60 ms prebuffer.
	audio.nextUplinkFrame()
	_ = audio.enqueueUplink(make([]int16, FrameSamples))
	if len(audio.nextUplinkFrame()) != FrameSamples || len(audio.upQueue) != FrameSamples {
		t.Fatal("played before the prebuffer refilled")
	}
}
