package server

import (
	"context"
	"errors"
	"testing"
	"time"
)

func takeFromBrowser(holder string) bool { return holder == "browser" }

func TestCallMediaLeaseIsExclusive(t *testing.T) {
	s := &Server{}
	release, err := s.acquireCallMediaLease("dev", "call", "browser")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.acquireCallMediaLease("dev", "call", "sip:handset"); !errors.Is(err, errCallMediaBusy) {
		t.Fatalf("second holder: got %v, want busy", err)
	}
	release()
	release() // idempotent
	again, err := s.acquireCallMediaLease("dev", "call", "sip:handset")
	if err != nil {
		t.Fatalf("after release: %v", err)
	}
	again()
}

func TestCallMediaLeaseHandsetTakesOverBrowser(t *testing.T) {
	s := &Server{}
	ctx, stop := context.WithCancel(context.Background())
	release, err := s.acquireCallMediaLeaseWith("dev", "call", "browser", stop, nil)
	if err != nil {
		t.Fatal(err)
	}
	// The browser stream lets go once its context ends, as serveBrowserPCM does.
	go func() {
		<-ctx.Done()
		time.Sleep(20 * time.Millisecond)
		release()
	}()
	phone, err := s.acquireCallMediaLeaseWith("dev", "call", "airsim-iphone", nil, takeFromBrowser)
	if err != nil {
		t.Fatalf("takeover: %v", err)
	}
	if ctx.Err() == nil {
		t.Fatal("browser stream was not stopped")
	}
	// The browser cannot take it back, and the old release must not free the new lease.
	release()
	if _, err := s.acquireCallMediaLeaseWith("dev", "call", "browser", func() {}, takeFromBrowser); !errors.Is(err, errCallMediaBusy) {
		t.Fatalf("browser retaking: got %v, want busy", err)
	}
	phone()
}

func TestCallMediaLeaseDoesNotTakeFromSIPOrUnstoppable(t *testing.T) {
	s := &Server{}
	sip, err := s.acquireCallMediaLease("dev", "call", "sip:handset")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.acquireCallMediaLeaseWith("dev", "call", "airsim-iphone", nil, takeFromBrowser); !errors.Is(err, errCallMediaBusy) {
		t.Fatalf("SIP holder: got %v, want busy", err)
	}
	sip()
	// A browser lease registered without a way to stop it stays put.
	browser, err := s.acquireCallMediaLease("dev", "call", "browser")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.acquireCallMediaLeaseWith("dev", "call", "airsim-iphone", nil, takeFromBrowser); !errors.Is(err, errCallMediaBusy) {
		t.Fatalf("unstoppable holder: got %v, want busy", err)
	}
	browser()
}
