package airsim

import (
	"bufio"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// Vectors from AirSIM's own tests, so Halo signs byte for byte as the phone
// verifies: HealthIdentityProofTests.java and the iOS manual pairing test.
func TestProofsMatchAirSIMVectors(t *testing.T) {
	secret := make([]byte, 32)
	for i := range secret {
		secret[i] = 0x41
	}
	if got := healthProof(secret, "fixture-nonce", "fixture-agent"); got != "Mn-nJNSJLkoH1AjaSEtBWQvvulaejVSgxFSmC_gJRJc" {
		t.Fatalf("health proof = %s", got)
	}
	for i := range secret {
		secret[i] = byte(i)
	}
	if got := routeProof(secret, "session-1", "client-key", "agent-1", 7592, 7593); got != "hQLACWxrSaTjg3tib03xCffgi2LQfdBAV_HLMPmj3hI" {
		t.Fatalf("route proof = %s", got)
	}
}

func TestCanonicalRequestHashesEmptyBody(t *testing.T) {
	got := canonicalRequest("PCM", "/v1/pcm", nil, 1700000000, "nonce-1")
	want := "PCM\n/v1/pcm\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n1700000000\nnonce-1"
	if got != want {
		t.Fatalf("canonical = %q", got)
	}
}

func TestValidateHost(t *testing.T) {
	for _, host := range []string{"192.168.1.50", "10.0.0.2", "172.16.4.1", "100.64.1.2", "169.254.3.4"} {
		if err := ValidateHost(host); err != nil {
			t.Errorf("%s rejected: %v", host, err)
		}
	}
	for _, host := range []string{"8.8.8.8", "100.128.0.1", "phone.local", "fe80::1", "", "192.168.1.2:80"} {
		if ValidateHost(host) == nil {
			t.Errorf("%s accepted", host)
		}
	}
}

// fakePhone is a minimal AirSIM Standalone: the pairing window, the signed
// control gateway and the PCM gateway, following the Java sources.
type fakePhone struct {
	t       *testing.T
	code    string
	session string
	key     *ecdh.PrivateKey
	agentID string

	mu      sync.Mutex
	secret  []byte
	nonces  map[string]bool
	dialed  []string
	sms     []SMS
	acked   []string
	smsRev  int64
	control *httptest.Server
	pcm     net.Listener
}

func newFakePhone(t *testing.T) *fakePhone {
	key, _ := ecdh.X25519().GenerateKey(rand.Reader)
	phone := &fakePhone{t: t, code: "482913", session: "8b1f0c2e-0000-4000-8000-1234567890ab",
		key: key, agentID: "agent-test", nonces: map[string]bool{}}
	phone.control = httptest.NewServer(http.HandlerFunc(phone.serveControl))
	t.Cleanup(phone.control.Close)
	pcm, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	phone.pcm = pcm
	t.Cleanup(func() { pcm.Close() })
	go phone.servePCM()
	return phone
}

func port(address string) int {
	_, value, _ := net.SplitHostPort(strings.TrimPrefix(address, "http://"))
	n, _ := strconv.Atoi(value)
	return n
}

func (p *fakePhone) pairingServer() *httptest.Server {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/pair/v1/info":
			json.NewEncoder(w).Encode(map[string]any{"product": "airsim-pair", "version": 1, "session_id": p.session,
				"server_public_key": b64.EncodeToString(p.key.PublicKey().Bytes()), "expires_at": time.Now().Add(time.Minute).UnixMilli()})
		case r.Method == http.MethodPost && r.URL.Path == "/pair/v1/claim":
			var claim map[string]any
			json.NewDecoder(r.Body).Decode(&claim)
			clientKeyText, _ := claim["client_public_key"].(string)
			clientBytes, _ := b64.DecodeString(clientKeyText)
			clientKey, err := ecdh.X25519().NewPublicKey(clientBytes)
			if err != nil {
				w.WriteHeader(401)
				return
			}
			shared, _ := p.key.ECDH(clientKey)
			key, _ := pairingKey(shared, p.session, p.code)
			sealedText, _ := claim["sealed_registration"].(string)
			sealed, _ := b64.DecodeString(sealedText)
			block, _ := aes.NewCipher(key)
			gcm, _ := cipher.NewGCM(block)
			if len(sealed) < 28 {
				w.WriteHeader(401)
				return
			}
			plain, err := gcm.Open(nil, sealed[:12], sealed[12:], []byte(p.session))
			if err != nil {
				w.WriteHeader(401)
				w.Write([]byte(`{"error":"pairing_auth_failed"}`))
				return
			}
			var registration struct {
				LocalMode bool   `json:"local_mode"`
				Secret    string `json:"vowlan_secret"`
			}
			json.Unmarshal(plain, &registration)
			if !registration.LocalMode {
				p.t.Error("Halo must pair in local mode")
			}
			secret, _ := b64.DecodeString(registration.Secret)
			p.mu.Lock()
			p.secret = secret
			p.mu.Unlock()
			control, pcm := port(p.control.URL), port(p.pcm.Addr().String())
			json.NewEncoder(w).Encode(map[string]any{"configured": true, "local_mode": true, "agent_id": p.agentID,
				"control_port": control, "pcm_port": pcm,
				"route_proof": routeProof(secret, p.session, clientKeyText, p.agentID, control, pcm)})
		default:
			w.WriteHeader(404)
		}
	}))
	p.t.Cleanup(server.Close)
	return server
}

func (p *fakePhone) authenticate(method, path string, body []byte, timestamp int64, nonce, signature string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.secret == nil || p.nonces[nonce] {
		return false
	}
	if d := time.Now().Unix() - timestamp; d > 30 || d < -30 {
		return false
	}
	if !signatureEqual(sign(p.secret, canonicalRequest(method, path, body, timestamp, nonce)), signature) {
		return false
	}
	p.nonces[nonce] = true
	return true
}

func (p *fakePhone) serveControl(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	timestamp, _ := strconv.ParseInt(r.Header.Get("X-AirSIM-VoWLAN-Timestamp"), 10, 64)
	nonce := r.Header.Get("X-AirSIM-VoWLAN-Nonce")
	if r.Header.Get("X-AirSIM-VoWLAN-Version") != "1" ||
		!p.authenticate(r.Method, r.URL.RequestURI(), body, timestamp, nonce, r.Header.Get("X-AirSIM-VoWLAN-Signature")) {
		w.WriteHeader(401)
		w.Write([]byte(`{"error":"authentication_failed"}`))
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	switch r.URL.Path {
	case "/v1/health":
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "agent_id": p.agentID,
			"identity_proof": healthProof(p.secret, nonce, p.agentID), "device_name": "Backup",
			"manufacturer": "Google", "model": "Pixel 6", "battery": map[string]any{"percent": 81, "charging": true},
			"sim_slots": []map[string]any{{"id": "sim-1", "label": "SIM 1", "slot_index": 0, "default": true}}})
	case "/api/calls/status":
		json.NewEncoder(w).Encode(map[string]any{"active": nil, "history": []any{}, "revision": 1})
	case "/api/events":
		json.NewEncoder(w).Encode(map[string]any{"revision": 2, "sms_revision": p.smsRev, "sms_pending": len(p.sms),
			"call": map[string]any{"active": map[string]any{"id": "android-1", "state": "incoming", "direction": "incoming", "number": "+886912345678"}}})
	case "/api/calls/dial":
		var input map[string]string
		json.Unmarshal(body, &input)
		p.dialed = append(p.dialed, input["number"])
		w.Write([]byte(`{"dialing":true}`))
	case "/api/sms":
		json.NewEncoder(w).Encode(p.sms)
	case "/api/sms/ack":
		var input struct {
			IDs []string `json:"ids"`
		}
		json.Unmarshal(body, &input)
		p.acked = append(p.acked, input.IDs...)
		p.sms = nil
		w.Write([]byte(`{"accepted":true}`))
	default:
		w.WriteHeader(404)
	}
}

func (p *fakePhone) servePCM() {
	for {
		conn, err := p.pcm.Accept()
		if err != nil {
			return
		}
		go func() {
			defer conn.Close()
			reader := bufio.NewReader(conn)
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			fields := strings.Fields(line)
			if len(fields) != 4 || fields[0] != pcmMagic {
				return
			}
			timestamp, _ := strconv.ParseInt(fields[1], 10, 64)
			if !p.authenticate("PCM", "/v1/pcm", nil, timestamp, fields[2], fields[3]) {
				return
			}
			conn.Write([]byte(pcmReady))
			// Echo one frame back, as a loopback call.
			frame := make([]byte, FrameSamples*2)
			if _, err := io.ReadFull(reader, frame); err != nil {
				return
			}
			conn.Write(frame)
		}()
	}
}

func pairWith(t *testing.T, phone *fakePhone, code string) (Pairing, error) {
	window := phone.pairingServer()
	pairing, err := Pair(context.Background(), "127.0.0.1", port(window.URL), code)
	return pairing, err
}

func allowLoopback(t *testing.T) {
	loopbackAllowed = true
	t.Cleanup(func() { loopbackAllowed = false })
}

func TestPairRefusesLoopback(t *testing.T) {
	if _, err := Pair(context.Background(), "127.0.0.1", 1, "482913"); err == nil {
		t.Fatal("loopback accepted as a phone address")
	}
}

func TestPairControlAndMediaAgainstFakePhone(t *testing.T) {
	allowLoopback(t)
	phone := newFakePhone(t)
	if _, err := pairWith(t, phone, "000000"); err == nil || !strings.Contains(err.Error(), "配对码") {
		t.Fatalf("wrong code: %v", err)
	}
	pairing, err := pairWith(t, phone, phone.code)
	if err != nil {
		t.Fatal(err)
	}
	if pairing.AgentID != phone.agentID || pairing.ControlPort != port(phone.control.URL) {
		t.Fatalf("pairing = %+v", pairing)
	}
	client, err := NewClient(pairing)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	health, err := client.Health(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if health.Model != "Pixel 6" || health.Battery == nil || health.Battery.Percent != 81 || len(health.SIMSlots) != 1 {
		t.Fatalf("health = %+v", health)
	}
	if err := client.Dial(ctx, "+886912345678", "sim-1"); err != nil {
		t.Fatal(err)
	}
	if len(phone.dialed) != 1 || phone.dialed[0] != "+886912345678" {
		t.Fatalf("dialed = %v", phone.dialed)
	}
	events, err := client.WaitEvents(ctx, 0)
	if err != nil || events.Call.Active == nil || events.Call.Active.State != "incoming" {
		t.Fatalf("events = %+v, %v", events, err)
	}

	// A different secret is refused, and so is a replayed nonce.
	forged := pairing
	forged.Secret = b64.EncodeToString(make([]byte, 32))
	other, _ := NewClient(forged)
	var apiErr *APIError
	if _, err := other.Calls(ctx); !errors.As(err, &apiErr) || apiErr.Status != 401 {
		t.Fatalf("forged request: %v", err)
	}

	media, err := client.OpenMedia(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer media.Close()
	frame := make([]int16, FrameSamples)
	for i := range frame {
		frame[i] = int16(i * 100)
	}
	if err := media.WritePCM(frame); err != nil {
		t.Fatal(err)
	}
	readCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	echo, err := media.ReadPCM(readCtx)
	if err != nil {
		t.Fatal(err)
	}
	if len(echo) != FrameSamples || echo[10] != 1000 {
		t.Fatalf("echo = %v", echo[:12])
	}
	if media.Codec() != "PCMU" {
		t.Fatal("browser bridge needs a supported codec name")
	}
}

type memoryStorage struct {
	mu      sync.Mutex
	pairing *Pairing
}

func (s *memoryStorage) LoadPairing(context.Context) (Pairing, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pairing == nil {
		return Pairing{}, false, nil
	}
	return *s.pairing, true, nil
}

func (s *memoryStorage) SavePairing(_ context.Context, p Pairing) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pairing = &p
	return nil
}

func (s *memoryStorage) DeletePairing(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pairing = nil
	return nil
}

func TestManagerFollowsPhoneAndMovesSMSIntoHalo(t *testing.T) {
	allowLoopback(t)
	phone := newFakePhone(t)
	phone.sms = []SMS{{DeliveryID: "d-1", Sender: "+886900000000", Content: "驗證碼 123456", Timestamp: "2026-11-08T10:00:00Z"}}
	phone.smsRev = 1
	window := phone.pairingServer()

	var mu sync.Mutex
	var stored []SMS
	storage := &memoryStorage{}
	manager := NewManager(storage, func(_ context.Context, _ Pairing, message SMS) error {
		mu.Lock()
		defer mu.Unlock()
		stored = append(stored, message)
		return nil
	}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	manager.Start(ctx)
	if _, err := manager.Pair(ctx, "127.0.0.1", port(window.URL), phone.code); err != nil {
		t.Fatal(err)
	}
	if storage.pairing == nil || storage.pairing.Model != "Pixel 6" {
		t.Fatalf("saved pairing = %+v", storage.pairing)
	}
	deadline := time.After(3 * time.Second)
	for {
		status := manager.Status()
		mu.Lock()
		done := status.State == "online" && status.Call != nil && len(stored) == 1
		mu.Unlock()
		if done {
			break
		}
		select {
		case <-manager.Changed():
		case <-deadline:
			t.Fatalf("status = %+v, stored = %v", status, stored)
		}
	}
	phone.mu.Lock()
	acked := append([]string(nil), phone.acked...)
	phone.mu.Unlock()
	if len(acked) != 1 || acked[0] != "d-1" {
		t.Fatalf("acked = %v", acked)
	}
	if err := manager.Unpair(ctx); err != nil {
		t.Fatal(err)
	}
	if status := manager.Status(); status.Paired || storage.pairing != nil {
		t.Fatalf("after unpair: %+v", status)
	}
}
