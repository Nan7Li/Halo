package server

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"vocat/internal/airsim"
	"vocat/internal/store"
	"vocat/internal/vowifi"
)

func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func startTestAgent(t *testing.T) (*Server, *airsimAgent) {
	t.Helper()
	airsim.AllowLoopbackForTests(true)
	t.Cleanup(func() { airsim.AllowLoopbackForTests(false) })
	server := newAirSIMTestServer(t)
	agent := newAirSIMAgent(server)
	server.airsimAgent = agent
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	if _, err := agent.update(ctx, func(cfg *airsimAgentConfig) {
		cfg.Enabled = true
		cfg.PairPort, cfg.ControlPort, cfg.PCMPort = freePort(t), freePort(t), freePort(t)
	}); err != nil {
		t.Fatal(err)
	}
	agent.restart(ctx)
	t.Cleanup(func() {
		_, _ = agent.update(context.Background(), func(cfg *airsimAgentConfig) { cfg.Enabled = false })
		agent.restart(context.Background())
	})
	go agent.watchSMS(ctx)
	return server, agent
}

// Halo's own AirSIM client was written from the iPhone side of the
// protocol; pairing it with Halo's agent exercises both ends.
func TestAirSIMAgentPairsAndProvesIdentity(t *testing.T) {
	server, agent := startTestAgent(t)
	ctx := context.Background()
	window, err := agent.openWindow()
	if err != nil {
		t.Fatal(err)
	}
	pairing, err := airsim.Pair(ctx, "127.0.0.1", agent.config().PairPort, window.Code)
	if err != nil {
		t.Fatal(err)
	}
	if pairing.AgentID != agent.config().AgentID || pairing.ControlPort != agent.config().ControlPort {
		t.Fatalf("pairing %+v", pairing)
	}
	if len(agent.config().Clients) != 1 {
		t.Fatal("client not saved")
	}
	// The window is spent.
	if _, err := airsim.Pair(ctx, "127.0.0.1", agent.config().PairPort, window.Code); err == nil {
		t.Fatal("a spent window paired again")
	}
	client, err := airsim.NewClient(pairing)
	if err != nil {
		t.Fatal(err)
	}
	health, err := client.Health(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if health.AgentKind != "standalone" || health.Manufacturer != "Halo" {
		t.Fatalf("health %+v", health)
	}
	snapshot, err := client.Calls(ctx)
	if err != nil || snapshot.Active != nil {
		t.Fatalf("calls %+v %v", snapshot, err)
	}
	// No line is ready in the test server: dialing reports it.
	var apiErr *airsim.APIError
	if err := client.Dial(ctx, "10086", ""); !errors.As(err, &apiErr) || apiErr.Code != "no_line_ready" {
		t.Fatalf("dial = %v", err)
	}

	// An incoming call wakes the long poll and shows up as AirSIM's "incoming".
	done := make(chan airsim.Events, 1)
	go func() {
		events, _ := client.WaitEvents(ctx, snapshot.Revision)
		done <- events
	}()
	time.Sleep(100 * time.Millisecond)
	agent.observe(&agentCall{ID: "halo-1", AndroidID: "halo-1", Direction: "incoming", State: "incoming", Number: "+886912345678", deviceID: "d", callID: "c"})
	select {
	case events := <-done:
		if events.Call.Active == nil || events.Call.Active.State != "incoming" || events.Call.Active.Number != "+886912345678" {
			t.Fatalf("events %+v", events)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("long poll did not wake")
	}
	// It ends unanswered: history marks it missed.
	agent.observe(nil)
	snapshot, _ = client.Calls(ctx)
	if snapshot.Active != nil || len(snapshot.History) != 1 || !snapshot.History[0].Missed {
		t.Fatalf("after hang-up %+v", snapshot)
	}

	// Texts received after pairing are offered once and gone after ack.
	if _, err := server.store.SaveSMSMessage(ctx, store.SMSMessage{
		MessageID: "m1", DeviceID: "d", Peer: "+886900000000", Direction: "inbound", Body: "驗證碼 123456", Timestamp: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}
	messages, err := client.PendingSMS(ctx)
	if err != nil || len(messages) != 1 || messages[0].Content != "驗證碼 123456" {
		t.Fatalf("sms %+v %v", messages, err)
	}
	if err := client.AckSMS(ctx, []string{messages[0].DeliveryID}); err != nil {
		t.Fatal(err)
	}
	if messages, _ := client.PendingSMS(ctx); len(messages) != 0 {
		t.Fatalf("acked sms offered again: %+v", messages)
	}

	// Without an active call the PCM port says nothing and closes.
	if _, err := client.OpenMedia(ctx); err == nil {
		t.Fatal("PCM opened without a call")
	}
}

func TestAirSIMAgentLocksPairingAfterWrongCodes(t *testing.T) {
	_, agent := startTestAgent(t)
	window, err := agent.openWindow()
	if err != nil {
		t.Fatal(err)
	}
	wrong := fmt.Sprintf("%06d", (mustAtoi(window.Code)+1)%1_000_000)
	for range 5 {
		if _, err := airsim.Pair(context.Background(), "127.0.0.1", agent.config().PairPort, wrong); err == nil {
			t.Fatal("wrong code paired")
		}
	}
	if _, err := airsim.Pair(context.Background(), "127.0.0.1", agent.config().PairPort, window.Code); err == nil {
		t.Fatal("window still open after five wrong codes")
	}
	if len(agent.config().Clients) != 0 {
		t.Fatal("client saved")
	}
}

func mustAtoi(value string) int {
	number := 0
	for _, r := range value {
		number = number*10 + int(r-'0')
	}
	return number
}

func TestAirSIMAgentRejectsUnsignedAndReplayedRequests(t *testing.T) {
	_, agent := startTestAgent(t)
	conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", agent.config().ControlPort))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, "GET /v1/health HTTP/1.1\r\nHost: x\r\nX-AirSIM-VoWLAN-Version: 1\r\n\r\n")
	reply, _ := io.ReadAll(conn)
	if !strings.Contains(string(reply), "401") || !strings.Contains(string(reply), "authentication_failed") {
		t.Fatalf("unsigned = %s", reply)
	}
}

func TestPrivatePeerPolicy(t *testing.T) {
	for address, want := range map[string]bool{
		"192.168.1.20:1": true, "10.0.0.2:1": true, "100.101.102.103:1": true, "127.0.0.1:1": true,
		"[fd7a:115c:a1e0::1]:1": true, "8.8.8.8:1": false, "[2001:db8::1]:1": false,
	} {
		addr, _ := net.ResolveTCPAddr("tcp", address)
		if got := privatePeer(addr); got != want {
			t.Errorf("%s = %v, want %v", address, got, want)
		}
	}
}

type fakeAgentMedia struct {
	uplink chan []int16
}

func (m *fakeAgentMedia) Codec() string { return "PCMU" }
func (m *fakeAgentMedia) ReadPCM(ctx context.Context) ([]int16, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(20 * time.Millisecond):
	}
	frame := make([]int16, 160)
	for index := range frame {
		frame[index] = int16(1000 + index)
	}
	return frame, nil
}
func (m *fakeAgentMedia) WritePCM(samples []int16) error {
	m.uplink <- append([]int16(nil), samples...)
	return nil
}

func TestAirSIMAgentStreamsCallAudio(t *testing.T) {
	_, agent := startTestAgent(t)
	ctx := context.Background()
	media := &fakeAgentMedia{uplink: make(chan []int16, 16)}
	agent.mediaHook = func(context.Context, *agentCall) (vowifi.CallMedia, func(), error) { return media, nil, nil }
	window, _ := agent.openWindow()
	pairing, err := airsim.Pair(ctx, "127.0.0.1", agent.config().PairPort, window.Code)
	if err != nil {
		t.Fatal(err)
	}
	client, _ := airsim.NewClient(pairing)
	agent.observe(&agentCall{ID: "halo-1", AndroidID: "halo-1", Direction: "outgoing", State: "active", Number: "10086", deviceID: "d", callID: "c", mediaReady: true})
	stream, err := client.OpenMedia(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	down, err := stream.ReadPCM(ctx)
	if err != nil || len(down) == 0 || down[0] != 1000 || down[len(down)-1] != int16(1000+len(down)-1) {
		t.Fatalf("downlink %v %v", down, err)
	}
	up := make([]int16, 160)
	for index := range up {
		up[index] = int16(-index)
	}
	if err := stream.WritePCM(up); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-media.uplink:
		if len(got) != 160 || got[5] != -5 {
			t.Fatalf("uplink %v", got[:8])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("uplink frame never reached the call")
	}
	// One PCM session at a time.
	if second, err := client.OpenMedia(ctx); err == nil {
		second.Close()
		t.Fatal("second PCM session accepted")
	}
}

func TestAirSIMAgentServesTLSOnTheSamePort(t *testing.T) {
	_, agent := startTestAgent(t)
	dir := t.TempDir()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "phone.example.com"},
		DNSNames: []string{"phone.example.com"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	der, _ := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	keyDER, _ := x509.MarshalECPrivateKey(key)
	certPath, keyPath := dir+"/cert.pem", dir+"/key.pem"
	_ = os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600)
	_ = os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0o600)
	_, _ = agent.update(context.Background(), func(cfg *airsimAgentConfig) { cfg.TLSCert, cfg.TLSKey = certPath, keyPath })
	window, _ := agent.openWindow()
	address := fmt.Sprintf("127.0.0.1:%d", agent.config().PairPort)
	conn, err := tls.Dial("tcp", address, &tls.Config{ServerName: "phone.example.com", InsecureSkipVerify: true})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if conn.ConnectionState().PeerCertificates[0].Subject.CommonName != "phone.example.com" {
		t.Fatal("wrong certificate")
	}
	_, _ = io.WriteString(conn, "GET /pair/v1/info HTTP/1.1\r\nHost: phone.example.com\r\n\r\n")
	reply := make([]byte, 4096)
	count, _ := conn.Read(reply)
	if !strings.Contains(string(reply[:count]), window.ID) {
		t.Fatalf("TLS reply %s", reply[:count])
	}
}
