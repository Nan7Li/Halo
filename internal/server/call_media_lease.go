package server

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

var errCallMediaBusy = errors.New("通话音频已被其他客户端占用")

// How long a takeover waits for the previous holder to let the media go.
const callMediaTakeoverWait = 5 * time.Second

type callMediaLeaseKey struct{ deviceID, callID string }
type callMediaLease struct {
	owner string
	// cancel stops the holder's stream; nil when it cannot be taken over.
	cancel context.CancelFunc
	done   chan struct{}
}

// Both the authenticated browser WebSocket and SIP backend use this lease.
// IMS exposes one downlink channel, so a second reader must be rejected.
func (s *Server) acquireCallMediaLease(deviceID, callID, owner string) (func(), error) {
	return s.acquireCallMediaLeaseWith(deviceID, callID, owner, nil, nil)
}

// acquireCallMediaLeaseWith also records how to stop this holder (cancel,
// which makes it preemptible) and, when takeover is set, cancels a current
// holder that takeover accepts and waits for it to release the media.
func (s *Server) acquireCallMediaLeaseWith(deviceID, callID, owner string, cancel context.CancelFunc, takeover func(holder string) bool) (func(), error) {
	key := callMediaLeaseKey{deviceID: deviceID, callID: callID}
	lease := &callMediaLease{owner: owner, cancel: cancel, done: make(chan struct{})}
	deadline := time.Now().Add(callMediaTakeoverWait)
	for {
		s.callMediaLeaseMu.Lock()
		if s.callMediaLeases == nil {
			s.callMediaLeases = make(map[callMediaLeaseKey]*callMediaLease)
		}
		current := s.callMediaLeases[key]
		if current == nil {
			s.callMediaLeases[key] = lease
			s.callMediaLeaseMu.Unlock()
			break
		}
		s.callMediaLeaseMu.Unlock()
		if takeover == nil || current.cancel == nil || !takeover(current.owner) {
			return nil, errCallMediaBusy
		}
		current.cancel()
		wait := time.Until(deadline)
		if wait <= 0 {
			return nil, errCallMediaBusy
		}
		timer := time.NewTimer(wait)
		select {
		case <-current.done:
			timer.Stop()
		case <-timer.C:
			return nil, errCallMediaBusy
		}
		if s.logger != nil {
			s.logger.Info("call media taken over", "device_id", deviceID, "call_id", callID, "from", current.owner, "to", owner)
		}
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			s.callMediaLeaseMu.Lock()
			if s.callMediaLeases[key] == lease {
				delete(s.callMediaLeases, key)
			}
			s.callMediaLeaseMu.Unlock()
			close(lease.done)
		})
	}, nil
}

func callMediaCodecSupported(codec string) bool {
	switch strings.ToUpper(strings.TrimSpace(codec)) {
	case "PCMU", "PCMA":
		return true
	default:
		return false
	}
}
