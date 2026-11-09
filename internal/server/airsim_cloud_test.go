package server

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"vocat/internal/store"
	"vocat/internal/vowifi"
)

// fakeRelay plays AirSIM's Relay for one device, and the iPhone on the
// media WebSocket.
type fakeRelay struct {
	t        *testing.T
	server   *httptest.Server
	mu       sync.Mutex
	posts    map[string][]map[string]any
	posted   chan string
	commands chan *websocket.Conn
	media    chan *websocket.Conn
	tokens   chan string
}

func newFakeRelay(t *testing.T) *fakeRelay {
	relay := &fakeRelay{
		t: t, posts: map[string][]map[string]any{}, posted: make(chan string, 64),
		commands: make(chan *websocket.Conn, 4), media: make(chan *websocket.Conn, 4), tokens: make(chan string, 4),
	}
	relay.server = httptest.NewTLSServer(http.HandlerFunc(relay.handle))
	t.Cleanup(relay.server.Close)
	return relay
}

func (f *fakeRelay) handle(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/v2/devices/dev-1/commands/connect":
		if r.Header.Get("Authorization") != "Bearer s3cret" || r.URL.Query().Get("agent_id") == "" {
			http.Error(w, `{"error":"device authentication failed"}`, http.StatusUnauthorized)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		f.commands <- conn
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/calls/") && strings.HasSuffix(r.URL.Path, "/connect"):
		if r.URL.Query().Get("role") != "agent" {
			http.Error(w, "role", http.StatusBadRequest)
			return
		}
		f.tokens <- r.URL.Query().Get("token")
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		f.media <- conn
	case r.Method == http.MethodPost:
		data, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(data, &payload)
		if r.URL.Path != "/v1/devices/register" && (payload["device_id"] != "dev-1" || payload["device_secret"] != "s3cret") {
			http.Error(w, `{"error":"device authentication failed"}`, http.StatusUnauthorized)
			return
		}
		f.mu.Lock()
		f.posts[r.URL.Path] = append(f.posts[r.URL.Path], payload)
		f.mu.Unlock()
		f.posted <- r.URL.Path
		if r.URL.Path == "/v2/commands/pull" {
			_, _ = io.WriteString(w, `{"commands":[]}`)
			return
		}
		w.WriteHeader(http.StatusAccepted)
		_, _ = io.WriteString(w, `{"accepted":true}`)
	default:
		http.NotFound(w, r)
	}
}

// waitPost waits for the next POST to path and returns its body.
func (f *fakeRelay) waitPost(path string) map[string]any {
	f.t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		f.mu.Lock()
		if posts := f.posts[path]; len(posts) > 0 {
			first := posts[0]
			f.posts[path] = posts[1:]
			f.mu.Unlock()
			return first
		}
		f.mu.Unlock()
		select {
		case <-f.posted:
		case <-deadline:
			f.t.Fatalf("no POST %s", path)
		}
	}
}

func readJSON(t *testing.T, ctx context.Context, conn *websocket.Conn) map[string]any {
	t.Helper()
	for {
		kind, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if kind != websocket.MessageText {
			continue
		}
		var value map[string]any
		if err := json.Unmarshal(data, &value); err != nil {
			t.Fatal(err)
		}
		return value
	}
}

func startCloudAgent(t *testing.T) (*Server, *airsimAgent, *fakeRelay) {
	t.Helper()
	server, agent := startTestAgent(t)
	relay := newFakeRelay(t)
	registration, _ := json.Marshal(map[string]any{
		"relay_url": relay.server.URL, "device_id": "dev-1", "device_secret": "s3cret",
		"bundle_id": "com.eric3u.airsim", "environment": "production", "voip_token": "ab12", "cloud_enabled": true,
	})
	if _, err := agent.update(context.Background(), func(cfg *airsimAgentConfig) {
		cfg.Cloud = true
		cfg.Clients = append(cfg.Clients, airsimAgentClient{ID: "phone", Secret: "x", CloudEnabled: true, Registration: registration})
	}); err != nil {
		t.Fatal(err)
	}
	agent.cloud.client = relay.server.Client()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go agent.cloud.run(ctx)
	return server, agent, relay
}

func TestAirSIMCloudStaysOffUntilTurnedOn(t *testing.T) {
	_, agent := startTestAgent(t)
	registration, _ := json.Marshal(map[string]any{"relay_url": "https://relay.example", "device_id": "d", "device_secret": "s"})
	_, _ = agent.update(context.Background(), func(cfg *airsimAgentConfig) {
		cfg.Clients = append(cfg.Clients, airsimAgentClient{ID: "phone", CloudEnabled: true, Registration: registration})
	})
	if agent.cloud.desired() != nil {
		t.Fatal("cloud ran without the admin turning it on")
	}
	_, _ = agent.update(context.Background(), func(cfg *airsimAgentConfig) { cfg.Cloud = true })
	if worker := agent.cloud.desired(); worker == nil || worker.agentID() != agent.config().AgentID {
		t.Fatalf("worker %+v", worker)
	}
	// A plain-HTTP Relay is refused: the device secret would travel in clear.
	registration, _ = json.Marshal(map[string]any{"relay_url": "http://relay.example", "device_id": "d", "device_secret": "s"})
	_, _ = agent.update(context.Background(), func(cfg *airsimAgentConfig) { cfg.Clients[0].Registration = registration })
	if agent.cloud.desired() != nil {
		t.Fatal("http relay accepted")
	}
	// Local-mode iPhones never use the Relay.
	_, _ = agent.update(context.Background(), func(cfg *airsimAgentConfig) {
		cfg.Clients[0].Registration, _ = json.Marshal(map[string]any{"relay_url": "https://relay.example", "device_id": "d", "device_secret": "s"})
		cfg.Clients[0].LocalMode = true
	})
	if agent.cloud.desired() != nil {
		t.Fatal("local-mode iPhone used the relay")
	}
}

func TestAirSIMCloudRegistersAndRunsCommands(t *testing.T) {
	_, agent, relay := startCloudAgent(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	register := relay.waitPost("/v1/devices/register")
	if register["android_agent_id"] != agent.config().AgentID || register["voip_token"] != "ab12" || register["device_secret"] != "s3cret" {
		t.Fatalf("register %v", register)
	}
	heartbeat := relay.waitPost("/v1/events/heartbeat")
	if heartbeat["event"] != "agent_heartbeat" || heartbeat["agent_id"] != agent.config().AgentID || heartbeat["cellular_state"] != "registered" {
		t.Fatalf("heartbeat %v", heartbeat)
	}

	var conn *websocket.Conn
	select {
	case conn = <-relay.commands:
	case <-ctx.Done():
		t.Fatal("command channel never connected")
	}
	defer conn.CloseNow()
	expires := time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)
	send := func(command map[string]any) map[string]any {
		command["target_agent_id"] = agent.config().AgentID
		encoded, _ := json.Marshal(command)
		if err := conn.Write(ctx, websocket.MessageText, encoded); err != nil {
			t.Fatal(err)
		}
		return readJSON(t, ctx, conn)
	}
	sms := map[string]any{"command_id": "11111111-1111-4111-8111-111111111111", "type": "send_sms", "number": "10086", "message": "hi", "expires_at": expires}
	if result := send(sms); result["status"] != "failed" || result["error"] != "no_line_ready" || result["command_id"] != sms["command_id"] {
		t.Fatalf("sms %v", result)
	}
	if result := send(map[string]any{"command_id": "22222222-2222-4222-8222-222222222222", "type": "dtmf", "number": "1", "expires_at": expires}); result["error"] != "dtmf_unsupported" {
		t.Fatalf("dtmf %v", result)
	}
	stale := map[string]any{"command_id": "33333333-3333-4333-8333-333333333333", "type": "dial", "number": "10086",
		"expires_at": time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)}
	if result := send(stale); result["error"] != "command_expired" {
		t.Fatalf("expired %v", result)
	}
	if result := send(map[string]any{"command_id": "44444444-4444-4444-8444-444444444444", "type": "call_control", "action": "end",
		"call": map[string]any{"call_uuid": "55555555-5555-4555-8555-555555555555"}, "expires_at": expires}); result["error"] != "call_mismatch" {
		t.Fatalf("call control %v", result)
	}
	// A command for another agent on the same iPhone is not ours.
	other, _ := json.Marshal(map[string]any{"command_id": "66666666-6666-4666-8666-666666666666", "type": "dtmf", "target_agent_id": "android-other", "expires_at": expires})
	_ = conn.Write(ctx, websocket.MessageText, other)
	if result := send(sms); result["command_id"] != sms["command_id"] {
		t.Fatalf("redelivery %v", result)
	}
	if status := agent.cloud.status(); status["running"] != true || status["registered"] != true || status["commands_connected"] != true {
		t.Fatalf("status %v", status)
	}
}

func TestAirSIMCloudRingsAndCarriesAudio(t *testing.T) {
	server, agent, relay := startCloudAgent(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	media := &fakeAgentMedia{uplink: make(chan []int16, 16)}
	agent.mediaHook = func(context.Context, *agentCall) (vowifi.CallMedia, func(), error) { return media, nil, nil }
	relay.waitPost("/v1/events/heartbeat")

	agent.observe(&agentCall{ID: "halo-1", AndroidID: "halo-1", Direction: "incoming", State: "incoming", Number: "+886912345678", deviceID: "d", callID: "c"})
	ring := relay.waitPost("/v2/events/call")
	secret, _ := ring["call_secret"].(string)
	uuid, _ := ring["call_uuid"].(string)
	if ring["event"] != "incoming_call" || ring["number"] != "+886912345678" || len(secret) != 64 || len(uuid) != 36 ||
		ring["agent_id"] != agent.config().AgentID || ring["media_transport"] != "legacy_pcm" {
		t.Fatalf("ring %v", ring)
	}
	if state := relay.waitPost("/v2/events/call-state"); state["phase"] != "ringing" || state["call_uuid"] != uuid {
		t.Fatalf("ringing %v", state)
	}
	if token := <-relay.tokens; token != secret {
		t.Fatal("media socket used the wrong call secret")
	}
	conn := <-relay.media
	defer conn.CloseNow()
	if ready := readJSON(t, ctx, conn); ready["status"] != "agent_ready" || ready["call_uuid"] != uuid {
		t.Fatalf("ready %v", ready)
	}

	// The line picks up (the test server has no real line to answer on).
	agent.observe(&agentCall{ID: "halo-1", AndroidID: "halo-1", Direction: "incoming", State: "active", Number: "+886912345678", deviceID: "d", callID: "c", mediaReady: true, answered: true})
	if state := relay.waitPost("/v2/events/call-state"); state["phase"] != "active" {
		t.Fatalf("active %v", state)
	}
	if owner := relay.waitPost("/v1/events/call-owner"); owner["owner"] != "android" || owner["phase"] != "active" {
		t.Fatalf("owner %v", owner)
	}

	answer, _ := json.Marshal(map[string]any{"action": "answer", "call_uuid": uuid, "media_protocol": "airsim-pcm-v1"})
	if err := conn.Write(ctx, websocket.MessageText, answer); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"answer_ok", "pcm_listening", "active", "pcm_ready"} {
		if got := readJSON(t, ctx, conn); got["status"] != want {
			t.Fatalf("status %v, want %s", got, want)
		}
	}
	kind, frame, err := conn.Read(ctx)
	if err != nil || kind != websocket.MessageBinary || len(frame) != 340 || string(frame[:4]) != "ASPM" {
		t.Fatalf("downlink %d %d %v", kind, len(frame), err)
	}
	if first := int16(binary.LittleEndian.Uint16(frame[20:])); first != 1000 {
		t.Fatalf("downlink sample %d", first)
	}
	up := make([]byte, 20, 340)
	copy(up, "ASPM")
	up[4] = 1
	binary.BigEndian.PutUint16(up[6:], 20)
	for index := 0; index < 160; index++ {
		up = binary.LittleEndian.AppendUint16(up, uint16(int16(-index)))
	}
	if err := conn.Write(ctx, websocket.MessageBinary, up); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-media.uplink:
		if len(got) != 160 || got[7] != -7 {
			t.Fatalf("uplink %v", got[:8])
		}
	case <-ctx.Done():
		t.Fatal("uplink never reached the call")
	}

	// Hang-up on the line ends the cloud call.
	agent.observe(nil)
	if state := relay.waitPost("/v2/events/call-state"); state["phase"] != "ended" || state["call_uuid"] != uuid {
		t.Fatalf("ended %v", state)
	}
	closed := make(chan struct{})
	go func() {
		for {
			if _, _, err := conn.Read(ctx); err != nil {
				close(closed)
				return
			}
		}
	}()
	select {
	case <-closed:
	case <-ctx.Done():
		t.Fatal("media socket stayed open after the call")
	}

	// New texts go to the Relay once.
	if _, err := server.store.SaveSMSMessage(context.Background(), store.SMSMessage{
		MessageID: "m1", DeviceID: "d", Peer: "+886900000000", Direction: "inbound", Body: "驗證碼 123456", Timestamp: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}
	if sms := relay.waitPost("/v1/events/sms"); sms["event"] != "incoming_sms" || sms["content"] != "驗證碼 123456" || !strings.HasPrefix(sms["delivery_id"].(string), "halo-sms-") {
		t.Fatalf("sms %v", sms)
	}
}

func TestCloudPCMFrames(t *testing.T) {
	payload := make([]byte, 320)
	payload[0] = 7
	framed := encodeCloudPCM("airsim-pcm-v1", payload, 3, time.UnixMilli(5))
	if len(framed) != 340 || binary.BigEndian.Uint32(framed[8:]) != 3 {
		t.Fatalf("framed %d", len(framed))
	}
	if back, err := decodeCloudPCM(framed); err != nil || back[0] != 7 {
		t.Fatalf("decode %v", err)
	}
	if raw := encodeCloudPCM("", payload, 0, time.Now()); len(raw) != 320 {
		t.Fatal("legacy frames carry a header")
	}
	if _, err := decodeCloudPCM(make([]byte, 100)); err == nil {
		t.Fatal("short frame accepted")
	}
	broken := append([]byte(nil), framed...)
	broken[4] = 9
	if _, err := decodeCloudPCM(broken); err == nil {
		t.Fatal("bad version accepted")
	}
}
