package server

// Halo as the "Android phone" for AirSIM's iPhone app.
//
// The iPhone pairs with Halo exactly as it would with the AirSIM Android
// APK, then dials, answers and texts through it. Halo places the call on
// one of its own lines (the cellular module or VoWiFi) and streams the
// audio over AirSIM's PCM port. Nothing here talks to an Android phone; the
// other direction (Halo driving an Android phone) is airsim_api.go.
//
// Three TCP ports, each accepting plain TCP from private networks (LAN,
// Tailscale) and TLS from anywhere when a trusted certificate is set:
//   pairing  GET /pair/v1/info, POST /pair/v1/claim (only while a window is open)
//   control  signed HTTP: /v1/health and the /api/... agent routes
//   PCM      "AIRSIMVWL1 ts nonce sig\n" → "AIRSIMREADY", then 8 kHz PCM16LE both ways

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"vocat/internal/airsim"
	"vocat/internal/store"
	"vocat/internal/vowifi"
)

const airsimAgentKey = "airsim.agent"

var b64url = base64.RawURLEncoding

type airsimAgentConfig struct {
	Enabled     bool                `json:"enabled"`
	AgentID     string              `json:"agent_id"`
	Name        string              `json:"name,omitempty"`
	PairPort    int                 `json:"pair_port"`
	ControlPort int                 `json:"control_port"`
	PCMPort     int                 `json:"pcm_port"`
	DeviceIDs   []string            `json:"device_ids,omitempty"`
	TLSCert     string              `json:"tls_cert,omitempty"`
	TLSKey      string              `json:"tls_key,omitempty"`
	Clients     []airsimAgentClient `json:"clients,omitempty"`
}

type airsimAgentClient struct {
	ID           string          `json:"id"`
	Secret       string          `json:"secret"`
	CreatedAt    time.Time       `json:"created_at"`
	LastSeen     time.Time       `json:"last_seen,omitempty"`
	LocalMode    bool            `json:"local_mode"`
	CloudEnabled bool            `json:"cloud_enabled"`
	SMSCursor    int64           `json:"sms_cursor"`
	Registration json.RawMessage `json:"registration,omitempty"`
}

func defaultAirSIMAgentConfig() airsimAgentConfig {
	return airsimAgentConfig{PairPort: 7590, ControlPort: 7592, PCMPort: 7593}
}

// agentCall is Halo's view of one call as the iPhone sees it.
type agentCall struct {
	ID        string `json:"id"`
	AndroidID string `json:"android_id"`
	Index     int    `json:"index"`
	Direction string `json:"direction"`
	State     string `json:"state"`
	Number    string `json:"number"`
	StartedAt string `json:"started_at"`
	UpdatedAt string `json:"updated_at"`
	EndedAt   string `json:"ended_at,omitempty"`
	Missed    bool   `json:"missed"`
	SlotIndex int    `json:"slot_index"`
	SlotID    int    `json:"slot_id"`

	deviceID   string
	callID     string
	answered   bool
	mediaReady bool
}

type airsimAgent struct {
	s *Server

	mu       sync.Mutex
	cfg      airsimAgentConfig
	window   *airsim.PairWindow
	verifier *airsim.Verifier
	stop     context.CancelFunc
	running  []io.Closer
	runErr   string

	callsMu  sync.Mutex
	revision int64
	changed  chan struct{}
	active   *agentCall
	history  []agentCall
	smsRev   int64

	pcmMu   sync.Mutex
	pcmBusy bool
	// mediaHook replaces openMedia in tests.
	mediaHook func(context.Context, *agentCall) (vowifi.CallMedia, func(), error)

	certMu   sync.Mutex
	cert     *tls.Certificate
	certPath string
	certMod  time.Time
	certErr  string
}

func newAirSIMAgent(s *Server) *airsimAgent {
	return &airsimAgent{s: s, verifier: airsim.NewVerifier(), changed: make(chan struct{})}
}

// StartAirSIMAgent loads the saved configuration and, when enabled, opens
// the three ports. It also mirrors Halo's calls for the iPhone.
func (s *Server) StartAirSIMAgent(ctx context.Context) {
	if s.airsimAgent == nil {
		s.airsimAgent = newAirSIMAgent(s)
	}
	agent := s.airsimAgent
	cfg, err := agent.load(ctx)
	if err != nil {
		s.logger.Warn("AirSIM agent configuration unreadable", "category", "airsim", "error", err)
		cfg = defaultAirSIMAgentConfig()
	}
	agent.mu.Lock()
	agent.cfg = cfg
	agent.mu.Unlock()
	agent.restart(ctx)
	go agent.mirrorCalls(ctx)
	go agent.watchSMS(ctx)
}

func (a *airsimAgent) load(ctx context.Context) (airsimAgentConfig, error) {
	cfg := defaultAirSIMAgentConfig()
	setting, err := a.s.store.AppSetting(ctx, airsimAgentKey)
	if errors.Is(err, store.ErrNotFound) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(setting.Value, &cfg); err != nil {
		return defaultAirSIMAgentConfig(), err
	}
	return cfg, nil
}

func (a *airsimAgent) save(ctx context.Context, cfg airsimAgentConfig) error {
	value, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return a.s.store.UpsertAppSetting(ctx, store.AppSetting{Key: airsimAgentKey, Value: value, Sensitive: true})
}

// update applies change to the configuration, saves it and returns it.
func (a *airsimAgent) update(ctx context.Context, change func(*airsimAgentConfig)) (airsimAgentConfig, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	next := a.cfg
	next.Clients = append([]airsimAgentClient(nil), a.cfg.Clients...)
	next.DeviceIDs = append([]string(nil), a.cfg.DeviceIDs...)
	change(&next)
	if next.AgentID == "" {
		next.AgentID = airsim.NewAgentID()
	}
	if err := a.save(ctx, next); err != nil {
		return a.cfg, err
	}
	a.cfg = next
	return next, nil
}

func (a *airsimAgent) config() airsimAgentConfig {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg
}

// restart closes the ports and reopens them from the current configuration.
func (a *airsimAgent) restart(parent context.Context) {
	a.mu.Lock()
	if a.stop != nil {
		a.stop()
	}
	for _, closer := range a.running {
		_ = closer.Close()
	}
	a.running = nil
	a.runErr = ""
	cfg := a.cfg
	if !cfg.Enabled {
		a.window = nil
		a.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(parent))
	a.stop = cancel
	a.mu.Unlock()

	var failures []string
	open := func(port int, name string, serve func(net.Listener)) {
		listener, err := net.Listen("tcp", ":"+strconv.Itoa(port))
		if err != nil {
			failures = append(failures, fmt.Sprintf("%s %d: %v", name, port, err))
			return
		}
		wrapped := &airsimListener{Listener: listener, agent: a}
		a.mu.Lock()
		a.running = append(a.running, wrapped)
		a.mu.Unlock()
		go serve(wrapped)
	}
	open(cfg.PairPort, "pairing", func(listener net.Listener) { a.serveHTTP(ctx, listener, http.HandlerFunc(a.handlePair)) })
	open(cfg.ControlPort, "control", func(listener net.Listener) { a.serveHTTP(ctx, listener, http.HandlerFunc(a.handleControl)) })
	open(cfg.PCMPort, "pcm", func(listener net.Listener) { a.servePCM(ctx, listener) })
	if len(failures) > 0 {
		a.mu.Lock()
		a.runErr = strings.Join(failures, "; ")
		a.mu.Unlock()
		a.s.logger.Warn("AirSIM agent port unavailable", "category", "airsim", "error", strings.Join(failures, "; "))
	}
}

func (a *airsimAgent) serveHTTP(ctx context.Context, listener net.Listener, handler http.Handler) {
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       20 * time.Second,
		// Long polls wait up to 25 s.
		WriteTimeout: 40 * time.Second,
		BaseContext:  func(net.Listener) context.Context { return ctx },
	}
	go func() {
		<-ctx.Done()
		_ = server.Close()
	}()
	_ = server.Serve(listener)
}

// ---- Listener: plain TCP from private peers, TLS from anyone ----

type airsimListener struct {
	net.Listener
	agent *airsimAgent
}

func (l *airsimListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		wrapped, ok := l.agent.admit(conn)
		if ok {
			return wrapped, nil
		}
		_ = conn.Close()
	}
}

type peekedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *peekedConn) Read(p []byte) (int, error) { return c.reader.Read(p) }

// admit sniffs the first byte: a TLS handshake (0x16) is served with the
// configured certificate; anything else must come from a private address.
func (a *airsimAgent) admit(conn net.Conn) (net.Conn, bool) {
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	reader := bufio.NewReader(conn)
	first, err := reader.Peek(1)
	_ = conn.SetReadDeadline(time.Time{})
	if err != nil {
		return nil, false
	}
	peeked := &peekedConn{Conn: conn, reader: reader}
	if first[0] == 0x16 {
		if !a.tlsConfigured() {
			return nil, false
		}
		return tls.Server(peeked, &tls.Config{
			MinVersion:     tls.VersionTLS12,
			NextProtos:     []string{"http/1.1"},
			GetCertificate: a.certificate,
		}), true
	}
	return peeked, privatePeer(conn.RemoteAddr())
}

func privatePeer(address net.Addr) bool {
	host, _, err := net.SplitHostPort(address.String())
	if err != nil {
		return false
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	ip = ip.Unmap()
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
		return true
	}
	// Tailscale and other CGNAT overlays.
	return netip.MustParsePrefix("100.64.0.0/10").Contains(ip)
}

func (a *airsimAgent) tlsConfigured() bool {
	cfg := a.config()
	return cfg.TLSCert != "" && cfg.TLSKey != ""
}

// certificate reloads the PEM files when they change, so a renewed
// certificate (acme.sh, a NAS certificate manager) is picked up.
func (a *airsimAgent) certificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	cfg := a.config()
	info, err := os.Stat(cfg.TLSCert)
	if err != nil {
		return nil, err
	}
	a.certMu.Lock()
	defer a.certMu.Unlock()
	if a.cert != nil && a.certPath == cfg.TLSCert && info.ModTime().Equal(a.certMod) {
		return a.cert, nil
	}
	pair, err := tls.LoadX509KeyPair(cfg.TLSCert, cfg.TLSKey)
	if err != nil {
		a.certErr = err.Error()
		return nil, err
	}
	a.cert, a.certPath, a.certMod, a.certErr = &pair, cfg.TLSCert, info.ModTime(), ""
	return a.cert, nil
}

// ---- Pairing ----

func (a *airsimAgent) openWindow() (*airsim.PairWindow, error) {
	window, err := airsim.NewPairWindow(time.Now())
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.window = window
	a.mu.Unlock()
	return window, nil
}

func (a *airsimAgent) currentWindow() *airsim.PairWindow {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.window == nil || !a.window.Open(time.Now()) {
		return nil
	}
	return a.window
}

func agentJSON(w http.ResponseWriter, status int, value any) {
	body, _ := json.Marshal(value)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Connection", "close")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func agentError(w http.ResponseWriter, status int, code string) {
	agentJSON(w, status, map[string]string{"error": code})
}

func (a *airsimAgent) handlePair(w http.ResponseWriter, r *http.Request) {
	window := a.currentWindow()
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/pair/v1/info":
		if window == nil {
			agentError(w, http.StatusGone, "pairing_expired")
			return
		}
		agentJSON(w, http.StatusOK, window.Info(time.Now()))
	case r.Method == http.MethodPost && r.URL.Path == "/pair/v1/claim":
		if window == nil {
			agentError(w, http.StatusGone, "pairing_expired")
			return
		}
		a.claim(w, r, window)
	default:
		agentError(w, http.StatusNotFound, "not_found")
	}
}

func (a *airsimAgent) claim(w http.ResponseWriter, r *http.Request, window *airsim.PairWindow) {
	var claim struct {
		Version            int    `json:"version"`
		SessionID          string `json:"session_id"`
		ClientPublicKey    string `json:"client_public_key"`
		SealedRegistration string `json:"sealed_registration"`
		WantDirectRoute    bool   `json:"want_direct_route"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<10)).Decode(&claim); err != nil {
		agentError(w, http.StatusBadRequest, "invalid_session")
		return
	}
	if claim.Version != 1 || claim.SessionID != window.ID {
		agentError(w, http.StatusBadRequest, "invalid_session")
		return
	}
	plaintext, err := window.Claim(time.Now(), claim.ClientPublicKey, claim.SealedRegistration)
	if err != nil {
		a.s.logger.Info("AirSIM iPhone pairing rejected", "category", "airsim", "reason", err.Error(), "peer", r.RemoteAddr)
		if errors.Is(err, airsim.ErrPairExpired) || errors.Is(err, airsim.ErrPairLocked) || errors.Is(err, airsim.ErrPairUsed) {
			agentError(w, http.StatusGone, err.Error())
			return
		}
		agentError(w, http.StatusUnauthorized, "pairing_auth_failed")
		return
	}
	registration, err := airsim.ParseRegistration(plaintext)
	clear(plaintext)
	if err != nil {
		agentError(w, http.StatusUnauthorized, "pairing_auth_failed")
		return
	}
	client := airsimAgentClient{
		ID:           airsim.ClientID(registration.Secret),
		Secret:       b64url.EncodeToString(registration.Secret),
		CreatedAt:    time.Now().UTC(),
		LocalMode:    registration.LocalMode,
		CloudEnabled: registration.CloudEnabled && !registration.LocalMode,
		Registration: registration.Raw,
	}
	if latest, err := a.s.store.LatestSMSMessageID(r.Context()); err == nil {
		client.SMSCursor = latest
	}
	cfg, err := a.update(r.Context(), func(cfg *airsimAgentConfig) {
		kept := cfg.Clients[:0]
		for _, existing := range cfg.Clients {
			if existing.ID != client.ID {
				kept = append(kept, existing)
			}
		}
		cfg.Clients = append(kept, client)
	})
	if err != nil {
		agentError(w, http.StatusServiceUnavailable, "agent_unavailable")
		return
	}
	a.mu.Lock()
	a.window = nil
	a.mu.Unlock()
	response := map[string]any{"configured": true, "agent_id": cfg.AgentID}
	if registration.LocalMode {
		response["local_mode"] = true
	} else if registration.DeviceID != "" {
		hint := registration.DeviceID
		if len(hint) > 8 {
			hint = "…" + hint[len(hint)-8:]
		}
		response["device_id_hint"] = hint
	}
	if claim.WantDirectRoute {
		response["control_port"] = cfg.ControlPort
		response["pcm_port"] = cfg.PCMPort
		response["route_proof"] = airsim.RouteProof(registration.Secret, window.ID, claim.ClientPublicKey, cfg.AgentID, cfg.ControlPort, cfg.PCMPort)
	}
	a.s.logger.Info("AirSIM iPhone paired", "category", "airsim", "client", client.ID, "local_mode", client.LocalMode, "peer", r.RemoteAddr)
	agentJSON(w, http.StatusOK, response)
}

// ---- Signed control API ----

func (a *airsimAgent) secrets() ([][]byte, []string) {
	cfg := a.config()
	secrets := make([][]byte, 0, len(cfg.Clients))
	ids := make([]string, 0, len(cfg.Clients))
	for _, client := range cfg.Clients {
		secret, err := b64url.DecodeString(client.Secret)
		if err != nil {
			continue
		}
		secrets = append(secrets, secret)
		ids = append(ids, client.ID)
	}
	return secrets, ids
}

var airsimAgentGET = map[string]bool{
	"/v1/health": true, "/api/health": true, "/api/status": true, "/api/debug": true, "/api/events": true,
	"/api/calls/early-media": true, "/api/calls/status": true, "/api/calls/events": true,
	"/api/calls/audio/host/config": true, "/api/push/status": true, "/api/sms": true, "/api/sms/status": true,
	"/api/feedback": true, "/api/local-mode": true,
}

var airsimAgentPOST = map[string]bool{
	"/api/calls/resolve": true, "/api/calls/dial": true, "/api/calls/answer": true, "/api/calls/reject": true,
	"/api/calls/hangup": true, "/api/calls/history/ack": true, "/api/calls/dtmf": true, "/api/calls/audio/mute": true,
	"/api/calls/audio/host/warmup": true, "/api/calls/audio/host/register": true, "/api/push/register": true,
	"/api/push/mode": true, "/api/sms/send": true, "/api/sms/ack": true, "/api/sms/refresh": true, "/api/local-mode": true,
}

func (a *airsimAgent) handleControl(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if (r.Method == http.MethodGet && !airsimAgentGET[path]) || (r.Method == http.MethodPost && !airsimAgentPOST[path]) ||
		(r.Method != http.MethodGet && r.Method != http.MethodPost) {
		agentError(w, http.StatusNotFound, "not_found")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 32<<10))
	if err != nil {
		agentError(w, http.StatusBadRequest, "bad_request")
		return
	}
	if r.Header.Get("X-AirSIM-VoWLAN-Version") != "1" {
		agentError(w, http.StatusUnauthorized, "authentication_failed")
		return
	}
	timestamp, _ := strconv.ParseInt(r.Header.Get("X-AirSIM-VoWLAN-Timestamp"), 10, 64)
	nonce := r.Header.Get("X-AirSIM-VoWLAN-Nonce")
	secrets, ids := a.secrets()
	index := a.verifier.Match(secrets, r.Header.Get("X-AirSIM-VoWLAN-Signature"), r.Method, r.URL.RequestURI(), body, timestamp, nonce, time.Now())
	if index < 0 {
		agentError(w, http.StatusUnauthorized, "authentication_failed")
		return
	}
	request := agentRequest{w: w, r: r, body: body, nonce: nonce, secret: secrets[index], clientID: ids[index]}
	a.touch(ids[index])
	a.route(request)
}

type agentRequest struct {
	w        http.ResponseWriter
	r        *http.Request
	body     []byte
	nonce    string
	secret   []byte
	clientID string
}

func (q agentRequest) input() map[string]any {
	values := map[string]any{}
	if len(q.body) > 0 {
		_ = json.Unmarshal(q.body, &values)
	}
	return values
}

func (q agentRequest) text(key string) string {
	value, _ := q.input()[key].(string)
	return strings.TrimSpace(value)
}

func (a *airsimAgent) touch(clientID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for index := range a.cfg.Clients {
		if a.cfg.Clients[index].ID == clientID {
			a.cfg.Clients[index].LastSeen = time.Now().UTC()
		}
	}
}

func (a *airsimAgent) route(q agentRequest) {
	ctx := q.r.Context()
	switch q.r.URL.Path {
	case "/v1/health":
		a.health(q)
	case "/api/health":
		agentJSON(q.w, http.StatusOK, map[string]any{"ok": true, "product": "airsim", "version": "halo-agent-1",
			"runtime_profile": "android-standalone", "canonical_call_ids": true, "sim_slots": a.simSlots(ctx)})
	case "/api/status":
		agentJSON(q.w, http.StatusOK, map[string]any{"ok": true, "configured": true, "runtime_profile": "android-standalone",
			"pending_commands": 0, "transport": "in_process"})
	case "/api/push/status":
		client, _ := a.client(q.clientID)
		agentJSON(q.w, http.StatusOK, map[string]any{"configured": !client.LocalMode, "cloud_enabled": client.CloudEnabled})
	case "/api/debug":
		agentJSON(q.w, http.StatusOK, map[string]any{"events": []any{}, "runtime_profile": "android-standalone"})
	case "/api/feedback":
		agentJSON(q.w, http.StatusOK, map[string]any{"runtime_profile": "android-standalone", "manufacturer": "Halo", "model": "NAS"})
	case "/api/calls/audio/host/config":
		agentJSON(q.w, http.StatusOK, map[string]any{"transport": "tcp_pcm_s16le", "sample_rate": 8000, "channels": 1,
			"route_ready": true, "route_listening": true})
	case "/api/calls/status":
		agentJSON(q.w, http.StatusOK, a.callSnapshot())
	case "/api/calls/events":
		after, timeout := longPollParams(q.r, 25*time.Second)
		a.waitChange(ctx, after, timeout)
		agentJSON(q.w, http.StatusOK, a.callSnapshot())
	case "/api/events":
		after, timeout := longPollParams(q.r, 15*time.Second)
		a.waitChange(ctx, after, timeout)
		a.agentEvents(q)
	case "/api/sms":
		agentJSON(q.w, http.StatusOK, a.pendingSMS(ctx, q.clientID))
	case "/api/sms/status":
		agentJSON(q.w, http.StatusOK, map[string]any{"auto_cleanup_me": true, "count": len(a.pendingSMS(ctx, q.clientID)), "last_poll_error": ""})
	case "/api/calls/early-media", "/api/local-mode":
		// Early media and AirSIM's pure-local mode switch are Android
		// features Halo does not offer; the iPhone treats 404 as unsupported.
		agentError(q.w, http.StatusNotFound, "not_found")
	case "/api/calls/dial":
		a.dial(q)
	case "/api/calls/answer":
		a.callAction(q, "answer")
	case "/api/calls/reject", "/api/calls/hangup":
		a.callAction(q, "hangup")
	case "/api/calls/dtmf":
		agentError(q.w, http.StatusNotImplemented, "dtmf_unsupported")
	case "/api/calls/resolve":
		if a.activeCall() == nil {
			agentError(q.w, http.StatusConflict, "cloud_call_identity_mismatch")
			return
		}
		agentJSON(q.w, http.StatusOK, a.callSnapshot())
	case "/api/calls/history/ack":
		a.ackHistory(q)
	case "/api/calls/audio/host/warmup":
		agentJSON(q.w, http.StatusOK, map[string]any{"warming": true})
	case "/api/calls/audio/host/register":
		enabled, _ := q.input()["enabled"].(bool)
		agentJSON(q.w, http.StatusOK, map[string]any{"enabled": enabled})
	case "/api/calls/audio/mute":
		muted, _ := q.input()["muted"].(bool)
		agentJSON(q.w, http.StatusOK, map[string]any{"muted": muted})
	case "/api/push/register":
		a.pushRegister(q)
	case "/api/push/mode":
		enabled, _ := q.input()["enabled"].(bool)
		_, err := a.update(ctx, func(cfg *airsimAgentConfig) {
			for index := range cfg.Clients {
				if cfg.Clients[index].ID == q.clientID {
					cfg.Clients[index].CloudEnabled = enabled && !cfg.Clients[index].LocalMode
				}
			}
		})
		if err != nil {
			agentError(q.w, http.StatusServiceUnavailable, "agent_unavailable")
			return
		}
		agentJSON(q.w, http.StatusOK, map[string]any{"cloud_enabled": enabled})
	case "/api/sms/send":
		a.sendSMS(q)
	case "/api/sms/ack":
		a.ackSMS(q)
	case "/api/sms/refresh":
		agentJSON(q.w, http.StatusOK, map[string]any{"accepted": true})
	default:
		agentError(q.w, http.StatusNotFound, "not_found")
	}
}

func longPollParams(r *http.Request, limit time.Duration) (int64, time.Duration) {
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	timeout := limit
	if value, err := strconv.Atoi(r.URL.Query().Get("timeout_ms")); err == nil && value >= 0 {
		timeout = min(time.Duration(value)*time.Millisecond, limit)
	}
	return after, timeout
}

func (a *airsimAgent) client(id string) (airsimAgentClient, bool) {
	for _, client := range a.config().Clients {
		if client.ID == id {
			return client, true
		}
	}
	return airsimAgentClient{}, false
}

func (a *airsimAgent) health(q agentRequest) {
	cfg := a.config()
	name := cfg.Name
	if name == "" {
		name = "Halo"
	}
	number := ""
	slots := a.simSlots(q.r.Context())
	for _, slot := range slots {
		if value, _ := slot["number"].(string); value != "" {
			number = value
			break
		}
	}
	agentJSON(q.w, http.StatusOK, map[string]any{
		"ok": true, "transport": "vowlan", "version": 1,
		"agent_id":           cfg.AgentID,
		"identity_proof":     airsim.HealthProof(q.secret, q.nonce, cfg.AgentID),
		"canonical_call_ids": true,
		"agent_kind":         "standalone",
		"device_name":        name,
		"manufacturer":       "Halo",
		"model":              "NAS",
		"phone_number":       number,
		"sim_slots":          slots,
	})
}

// ---- Lines (SIM slots) ----

type agentLine struct {
	config     store.Device
	physicalID string
	index      int
	number     string
	carrier    string
}

// lines are Halo devices that can carry a call with audio right now, in a
// stable order. The configured device list narrows them.
func (a *airsimAgent) lines(ctx context.Context) []agentLine {
	devices, err := a.s.store.ListDevices(ctx)
	if err != nil {
		return nil
	}
	sort.Slice(devices, func(i, j int) bool { return devices[i].ID < devices[j].ID })
	allowed := map[string]bool{}
	for _, id := range a.config().DeviceIDs {
		allowed[id] = true
	}
	var lines []agentLine
	for _, config := range devices {
		if len(allowed) > 0 && !allowed[config.ID] {
			continue
		}
		ready, _, transport := a.s.callAudioCapability(config)
		if !ready || (transport != "cellular" && transport != "vowifi") {
			continue
		}
		entry, physicalID, present := a.s.physicalForConfig(config)
		if !present {
			continue
		}
		line := agentLine{config: config, physicalID: physicalID, index: len(lines)}
		if entry.Snapshot != nil {
			if association, err := a.s.store.PhoneAssociation(ctx, strings.TrimSpace(entry.Snapshot.ICCID)); err == nil {
				line.number = association.Number
			}
			line.carrier = strings.TrimSpace(entry.Snapshot.OperatorName)
		}
		lines = append(lines, line)
	}
	return lines
}

func (a *airsimAgent) simSlots(ctx context.Context) []map[string]any {
	lines := a.lines(ctx)
	slots := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		label := strings.TrimSpace(line.config.Name)
		if label == "" {
			label = line.config.ID
		}
		slots = append(slots, map[string]any{
			"id": line.config.ID, "label": label, "number": line.number, "default": line.index == 0,
			"slot_index": line.index, "sub_id": line.index + 1, "carrier_name": line.carrier,
			"is_embedded": false, "is_default_voice": line.index == 0, "is_default_sms": line.index == 0,
		})
	}
	return slots
}

func (a *airsimAgent) lineFor(ctx context.Context, slotID string) (agentLine, bool) {
	lines := a.lines(ctx)
	for _, line := range lines {
		if slotID != "" && line.config.ID == slotID {
			return line, true
		}
	}
	if len(lines) == 0 {
		return agentLine{}, false
	}
	return lines[0], true
}

// invoke runs one of Halo's own call handlers in process.
func (a *airsimAgent) invoke(ctx context.Context, line agentLine, action string, input map[string]any) (int, map[string]any) {
	body, _ := json.Marshal(input)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/devices/"+line.config.ID+"/calls/"+action, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	a.s.handleCallAction(recorder, request, line.config, line.physicalID, action)
	var payload struct {
		Data  map[string]any `json:"data"`
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(recorder.Body.Bytes(), &payload)
	if recorder.Code >= 300 {
		return recorder.Code, map[string]any{"error": firstNonEmpty(payload.Error.Code, "call_failed"), "message": payload.Error.Message}
	}
	return recorder.Code, payload.Data
}

func (a *airsimAgent) lineCalls(ctx context.Context, line agentLine) []vowifi.Call {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/devices/"+line.config.ID+"/calls", nil)
	a.s.handleCalls(recorder, request, line.config, line.physicalID)
	var payload struct {
		Data struct {
			Calls []vowifi.Call `json:"calls"`
		} `json:"data"`
	}
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &payload) != nil {
		return nil
	}
	return payload.Data.Calls
}

// ---- Calls ----

func agentCallID(deviceID, callID string) string {
	digest := sha256.Sum256([]byte(deviceID + "\x00" + callID))
	return "halo-" + hex.EncodeToString(digest[:8])
}

func agentState(call vowifi.Call) string {
	switch call.State {
	case "ended", "failed":
		return "ended"
	case "active":
		return "active"
	case "held":
		return "held"
	}
	if call.Direction == "incoming" {
		return "incoming"
	}
	return "dialing"
}

// mirrorCalls keeps the iPhone's view of the active call in step with
// Halo's lines and bumps the revision on every change.
func (a *airsimAgent) mirrorCalls(ctx context.Context) {
	ticker := time.NewTicker(700 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		if !a.config().Enabled {
			continue
		}
		a.refreshCalls(ctx)
	}
}

func (a *airsimAgent) refreshCalls(ctx context.Context) {
	var live *agentCall
	for _, line := range a.lines(ctx) {
		for _, call := range a.lineCalls(ctx, line) {
			if call.State == "ended" || call.State == "failed" {
				continue
			}
			started := call.StartedAt
			if started.IsZero() {
				started = time.Now()
			}
			id := agentCallID(line.config.ID, call.ID)
			live = &agentCall{
				ID: id, AndroidID: id, Index: 1, Direction: call.Direction, State: agentState(call),
				Number: call.Number, StartedAt: started.UTC().Format(time.RFC3339),
				SlotIndex: line.index, SlotID: line.index,
				deviceID: line.config.ID, callID: call.ID, answered: call.State == "active",
				mediaReady: call.MediaReady,
			}
			break
		}
		if live != nil {
			break
		}
	}
	a.observe(live)
}

// observe records the current live call (nil for none).
func (a *airsimAgent) observe(live *agentCall) {
	now := time.Now().UTC().Format(time.RFC3339)
	a.callsMu.Lock()
	defer a.callsMu.Unlock()
	previous := a.active
	changed := false
	if previous != nil && (live == nil || live.ID != previous.ID) {
		ended := *previous
		ended.State = "ended"
		ended.EndedAt = now
		ended.UpdatedAt = now
		ended.Missed = ended.Direction == "incoming" && !ended.answered
		a.history = append(a.history, ended)
		if len(a.history) > 50 {
			a.history = a.history[len(a.history)-50:]
		}
		a.active = nil
		changed = true
	}
	if live != nil {
		if a.active == nil || a.active.State != live.State || a.active.mediaReady != live.mediaReady {
			changed = true
		}
		if a.active != nil {
			live.answered = live.answered || a.active.answered
			live.StartedAt = a.active.StartedAt
		}
		live.UpdatedAt = now
		a.active = live
	}
	if changed {
		a.bumpLocked()
	}
}

func (a *airsimAgent) bumpLocked() {
	a.revision++
	close(a.changed)
	a.changed = make(chan struct{})
}

func (a *airsimAgent) bump() {
	a.callsMu.Lock()
	a.bumpLocked()
	a.callsMu.Unlock()
}

func (a *airsimAgent) waitChange(ctx context.Context, after int64, timeout time.Duration) {
	a.callsMu.Lock()
	revision, changed := a.revision, a.changed
	a.callsMu.Unlock()
	if revision != after || timeout <= 0 {
		return
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-changed:
	case <-timer.C:
	case <-ctx.Done():
	}
}

func (a *airsimAgent) activeCall() *agentCall {
	a.callsMu.Lock()
	defer a.callsMu.Unlock()
	if a.active == nil {
		return nil
	}
	copied := *a.active
	return &copied
}

func (a *airsimAgent) callSnapshot() map[string]any {
	a.callsMu.Lock()
	defer a.callsMu.Unlock()
	var active any
	if a.active != nil {
		active = a.active
	}
	history := append([]agentCall{}, a.history...)
	return map[string]any{
		"active": active, "history": history, "polling": false, "event_driven": true,
		"poll_interval_s": 0, "last_poll_error": "", "revision": a.revision,
	}
}

func (a *airsimAgent) agentEvents(q agentRequest) {
	ctx := q.r.Context()
	a.callsMu.Lock()
	revision, smsRevision := a.revision, a.smsRev
	a.callsMu.Unlock()
	agentJSON(q.w, http.StatusOK, map[string]any{
		"revision": revision, "sms_revision": smsRevision, "sms_pending": len(a.pendingSMS(ctx, q.clientID)),
		"sim_revision": 0, "sim_slots": a.simSlots(ctx), "call": a.callSnapshot(),
	})
}

func (a *airsimAgent) dial(q agentRequest) {
	ctx := q.r.Context()
	input := q.input()
	number, _ := input["number"].(string)
	simAccount, _ := input["sim_account"].(string)
	operationID, _ := input["operation_id"].(string)
	line, ok := a.lineFor(ctx, strings.TrimSpace(simAccount))
	if !ok {
		agentError(q.w, http.StatusServiceUnavailable, "no_line_ready")
		return
	}
	number = strings.TrimSpace(number)
	status, result := a.invoke(ctx, line, "dial", map[string]any{"number": number})
	if status >= 300 {
		agentJSON(q.w, http.StatusBadGateway, result)
		return
	}
	output := map[string]any{"dialing": true, "number": number, "android_confirmed": true}
	callID, _ := result["call_id"].(string)
	if callID == "" {
		// Lines without a call id in the dial answer: take the outgoing
		// call that shows up next.
		deadline := time.Now().Add(2 * time.Second)
		for callID == "" && time.Now().Before(deadline) {
			for _, call := range a.lineCalls(ctx, line) {
				if call.Direction == "outgoing" && call.State != "ended" && call.State != "failed" {
					callID = call.ID
					break
				}
			}
			if callID == "" {
				time.Sleep(100 * time.Millisecond)
			}
		}
	}
	if callID != "" {
		id := agentCallID(line.config.ID, callID)
		a.observe(&agentCall{
			ID: id, AndroidID: id, Index: 1, Direction: "outgoing", State: "dialing", Number: number,
			StartedAt: time.Now().UTC().Format(time.RFC3339), SlotIndex: line.index, SlotID: line.index,
			deviceID: line.config.ID, callID: callID,
		})
		if operationID != "" {
			output["operation_id"] = operationID
			output["android_id"] = id
			output["backend_id"] = id
			output["operation_proof"] = airsim.DialProof(q.secret, q.nonce, operationID, id, id)
		}
	} else if operationID != "" {
		agentError(q.w, http.StatusGatewayTimeout, "owned_dial_receipt_unavailable")
		return
	}
	agentJSON(q.w, http.StatusOK, output)
}

func (a *airsimAgent) callAction(q agentRequest, action string) {
	ctx := q.r.Context()
	active := a.activeCall()
	requested := q.text("call_id")
	if active == nil || (requested != "" && requested != active.ID && requested != active.AndroidID) {
		agentError(q.w, http.StatusConflict, "call_not_found")
		return
	}
	var line agentLine
	found := false
	for _, candidate := range a.lines(ctx) {
		if candidate.config.ID == active.deviceID {
			line, found = candidate, true
		}
	}
	if !found {
		agentError(q.w, http.StatusConflict, "call_not_found")
		return
	}
	status, result := a.invoke(ctx, line, action, map[string]any{"call_id": active.callID})
	if status >= 300 {
		agentJSON(q.w, http.StatusBadGateway, result)
		return
	}
	go a.refreshCalls(context.WithoutCancel(ctx))
	switch {
	case action == "answer":
		agentJSON(q.w, http.StatusOK, map[string]any{"answered": true})
	case q.r.URL.Path == "/api/calls/reject":
		agentJSON(q.w, http.StatusOK, map[string]any{"rejected": true})
	default:
		agentJSON(q.w, http.StatusOK, map[string]any{"hung_up": true})
	}
}

func (a *airsimAgent) ackHistory(q agentRequest) {
	var input struct {
		IDs []string `json:"ids"`
	}
	_ = json.Unmarshal(q.body, &input)
	drop := map[string]bool{}
	for _, id := range input.IDs {
		drop[id] = true
	}
	a.callsMu.Lock()
	kept := a.history[:0]
	for _, call := range a.history {
		if !drop[call.ID] && !drop[call.AndroidID] {
			kept = append(kept, call)
		}
	}
	a.history = kept
	a.callsMu.Unlock()
	agentJSON(q.w, http.StatusOK, map[string]any{"accepted": true})
}

func (a *airsimAgent) pushRegister(q agentRequest) {
	registration, err := airsim.ParseRegistration(append([]byte(nil), q.body...))
	raw := json.RawMessage(q.body)
	localMode := false
	cloud := false
	if err == nil {
		raw, localMode, cloud = registration.Raw, registration.LocalMode, registration.CloudEnabled
	} else {
		// Re-registration normally carries no VoWLAN secret.
		var fields map[string]any
		if json.Unmarshal(q.body, &fields) != nil {
			agentError(q.w, http.StatusBadRequest, "bad_request")
			return
		}
		localMode, _ = fields["local_mode"].(bool)
		cloud, _ = fields["cloud_enabled"].(bool)
	}
	_, err = a.update(q.r.Context(), func(cfg *airsimAgentConfig) {
		for index := range cfg.Clients {
			if cfg.Clients[index].ID == q.clientID {
				cfg.Clients[index].Registration = raw
				cfg.Clients[index].LocalMode = localMode
				cfg.Clients[index].CloudEnabled = cloud && !localMode
			}
		}
	})
	if err != nil {
		agentError(q.w, http.StatusServiceUnavailable, "agent_unavailable")
		return
	}
	agentJSON(q.w, http.StatusOK, map[string]any{"configured": true, "local_mode": localMode})
}

// ---- SMS ----

func (a *airsimAgent) watchSMS(ctx context.Context) {
	for {
		inserted := a.s.store.SMSInserted()
		select {
		case <-ctx.Done():
			return
		case <-inserted:
			a.callsMu.Lock()
			a.smsRev++
			a.bumpLocked()
			a.callsMu.Unlock()
		}
	}
}

func (a *airsimAgent) pendingSMS(ctx context.Context, clientID string) []map[string]any {
	client, ok := a.client(clientID)
	if !ok {
		return []map[string]any{}
	}
	messages, err := a.s.store.ListInboundSMSAfterID(ctx, client.SMSCursor, 50)
	if err != nil {
		return []map[string]any{}
	}
	slots := map[string]int{}
	for _, line := range a.lines(ctx) {
		slots[line.config.ID] = line.index
	}
	values := make([]map[string]any, 0, len(messages))
	for _, message := range messages {
		values = append(values, map[string]any{
			"delivery_id": "halo-sms-" + strconv.FormatInt(message.ID, 10),
			"sender":      message.Peer,
			"content":     message.Body,
			"sim_slot":    strconv.Itoa(slots[message.DeviceID]),
			"timestamp":   message.Timestamp.UTC().Format(time.RFC3339),
		})
	}
	return values
}

func (a *airsimAgent) ackSMS(q agentRequest) {
	var input struct {
		IDs []string `json:"ids"`
	}
	_ = json.Unmarshal(q.body, &input)
	highest := int64(0)
	for _, id := range input.IDs {
		if value, err := strconv.ParseInt(strings.TrimPrefix(id, "halo-sms-"), 10, 64); err == nil && value > highest {
			highest = value
		}
	}
	if highest > 0 {
		_, _ = a.update(q.r.Context(), func(cfg *airsimAgentConfig) {
			for index := range cfg.Clients {
				if cfg.Clients[index].ID == q.clientID && highest > cfg.Clients[index].SMSCursor {
					cfg.Clients[index].SMSCursor = highest
				}
			}
		})
		a.bump()
	}
	agentJSON(q.w, http.StatusOK, map[string]any{"accepted": true})
}

func (a *airsimAgent) sendSMS(q agentRequest) {
	ctx := q.r.Context()
	line, ok := a.lineFor(ctx, q.text("sim_account"))
	if !ok {
		agentError(q.w, http.StatusServiceUnavailable, "no_line_ready")
		return
	}
	body, _ := json.Marshal(map[string]any{"phone": q.text("phone"), "message": q.input()["message"], "device_id": line.config.ID})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/sms/send", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	a.s.handleSMSSend(recorder, request)
	if recorder.Code >= 300 {
		agentError(q.w, http.StatusBadGateway, "sms_send_failed")
		return
	}
	agentJSON(q.w, http.StatusOK, map[string]any{"sent": true, "segments": 1})
}

// ---- PCM ----

// openMedia takes the call's audio the same way the browser does: the
// cellular PCM bridge or VoWiFi RTP, under the per-call media lease.
func (a *airsimAgent) openMedia(ctx context.Context, call *agentCall) (vowifi.CallMedia, func(), error) {
	if a.mediaHook != nil {
		return a.mediaHook(ctx, call)
	}
	config, err := a.s.store.Device(ctx, call.deviceID)
	if err != nil {
		return nil, nil, err
	}
	open, _, _, message := a.s.callMediaOpener(config, call.callID)
	if open == nil {
		return nil, nil, errors.New(message)
	}
	// The iPhone is the handset: it takes the audio from a Halo browser tab
	// that picked it up first (every open tab plays a live call), but not
	// from a SIP handset.
	releaseLease, err := a.s.acquireCallMediaLeaseWith(config.ID, call.callID, "airsim-iphone", nil, func(holder string) bool {
		return holder == "browser"
	})
	if err != nil {
		return nil, nil, err
	}
	media, releaseMedia, err := open(ctx)
	release := func() {
		if releaseMedia != nil {
			releaseMedia()
		}
		releaseLease()
	}
	if err != nil || media == nil {
		release()
		return nil, nil, firstErr(err, errors.New("no call media"))
	}
	if !callMediaCodecSupported(media.Codec()) {
		release()
		return nil, nil, errors.New("call codec cannot be converted to PCM")
	}
	return media, release, nil
}

func firstErr(values ...error) error {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func (a *airsimAgent) servePCM(ctx context.Context, listener net.Listener) {
	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()
	for {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		go a.handlePCM(ctx, conn)
	}
}

func (a *airsimAgent) handlePCM(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	reader := bufio.NewReaderSize(conn, 4096)
	line, err := reader.ReadString('\n')
	if err != nil {
		return
	}
	preface, err := airsim.ParsePCMPreface(line)
	if err != nil {
		return
	}
	secrets, _ := a.secrets()
	if a.verifier.Match(secrets, preface.Signature, "PCM", "/v1/pcm", nil, preface.Timestamp, preface.Nonce, time.Now()) < 0 {
		a.s.logger.Info("AirSIM iPhone PCM rejected", "category", "airsim", "peer", conn.RemoteAddr().String())
		return
	}
	a.pcmMu.Lock()
	if a.pcmBusy {
		a.pcmMu.Unlock()
		return
	}
	a.pcmBusy = true
	a.pcmMu.Unlock()
	defer func() {
		a.pcmMu.Lock()
		a.pcmBusy = false
		a.pcmMu.Unlock()
	}()

	// The iPhone connects right after answer or dial; wait for the line's
	// media to come up.
	var call *agentCall
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		call = a.activeCall()
		if call != nil && call.State == "active" && call.mediaReady {
			break
		}
		call = nil
		select {
		case <-ctx.Done():
			return
		case <-time.After(150 * time.Millisecond):
		}
	}
	if call == nil {
		return
	}
	mediaCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	media, release, err := a.openMedia(mediaCtx, call)
	if release != nil {
		defer release()
	}
	if err != nil {
		a.s.logger.Info("AirSIM iPhone PCM has no media", "category", "airsim", "reason", err.Error())
		return
	}
	_ = conn.SetDeadline(time.Time{})
	if _, err := io.WriteString(conn, airsim.PCMReady); err != nil {
		return
	}
	a.s.logger.Info("AirSIM iPhone audio connected", "category", "airsim", "device_id", call.deviceID)

	go func() {
		defer cancel()
		frame := make([]byte, 320)
		for {
			if _, err := io.ReadFull(reader, frame); err != nil {
				return
			}
			samples := make([]int16, 160)
			for index := range samples {
				samples[index] = int16(binary.LittleEndian.Uint16(frame[index*2:]))
			}
			if media.WritePCM(samples) != nil {
				return
			}
		}
	}()
	for {
		samples, err := media.ReadPCM(mediaCtx)
		if err != nil {
			return
		}
		payload := make([]byte, len(samples)*2)
		for index, sample := range samples {
			binary.LittleEndian.PutUint16(payload[index*2:], uint16(sample))
		}
		_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
		if _, err := conn.Write(payload); err != nil {
			return
		}
	}
}
