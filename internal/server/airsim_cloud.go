package server

// Halo on AirSIM's cloud Relay, in the role of AirSIM's Android APK.
//
// A cloud-mode iPhone hands its Relay identity (relay_url, device_id,
// device_secret) over during pairing. With that identity Halo:
//   - registers it with the Relay and sends a heartbeat every two minutes,
//     so the iPhone shows the agent as online;
//   - holds the command WebSocket (/v2/devices/{id}/commands/connect) and
//     runs dial, SMS and call-control commands the iPhone queues there,
//     polling /v2/commands/pull while the socket is down;
//   - posts an incoming call to /v2/events/call (the Relay wakes the iPhone
//     with a VoIP push) and its phases to /v2/events/call-state;
//   - carries the call audio over the Relay's per-call media WebSocket
//     (/v1/calls/{uuid}/connect?role=agent): 20 ms 8 kHz PCM16LE frames,
//     optionally behind AirSIM's 20-byte "ASPM" header;
//   - forwards new SMS to /v1/events/sms.
//
// The Relay belongs to whoever deployed it (for AirSIM's TestFlight build,
// AirSIM's maintainer): call audio and SMS pass through it. It is off unless
// the Halo admin turns it on (airsimAgentConfig.Cloud).
//
// Written against the protocol of AirSIM's push-relay-worker and Android
// sources (StandaloneAgentService, StandaloneCloudMediaManager,
// StandaloneAgentGateway). No AirSIM code is copied.

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"vocat/internal/vowifi"
)

const (
	cloudHeartbeatEvery = 120 * time.Second
	cloudPollEvery      = 10 * time.Second
	cloudFrameBytes     = 320 // 20 ms of 8 kHz PCM16
	cloudAgentVersion   = "halo-cloud-1"
)

// airsimCloud runs at most one Relay identity: the most recently paired
// cloud-mode iPhone. AirSIM's Android APK also keeps a single registration.
type airsimCloud struct {
	a      *airsimAgent
	client *http.Client
	// now and dial are replaced in tests.
	now  func() time.Time
	dial func(context.Context, string, *websocket.DialOptions) (*websocket.Conn, *http.Response, error)

	mu       sync.Mutex
	worker   *cloudWorker
	call     *cloudCall
	results  map[string]map[string]any
	resultAt []string

	events chan func()
}

func newAirSIMCloud(a *airsimAgent) *airsimCloud {
	return &airsimCloud{
		a: a,
		client: &http.Client{
			Timeout: 20 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		now:     time.Now,
		dial:    websocket.Dial,
		results: map[string]map[string]any{},
		events:  make(chan func(), 64),
	}
}

// cloudWorker is one Relay identity and its status.
type cloudWorker struct {
	scope    string
	clientID string
	reg      map[string]any
	relay    *url.URL
	cancel   context.CancelFunc

	mu            sync.Mutex
	registered    bool
	lastHeartbeat time.Time
	connected     bool
	lastError     string
	lastErrorAt   time.Time
	reregister    bool
}

func (w *cloudWorker) deviceID() string { value, _ := w.reg["device_id"].(string); return value }
func (w *cloudWorker) secret() string   { value, _ := w.reg["device_secret"].(string); return value }
func (w *cloudWorker) agentID() string  { value, _ := w.reg["android_agent_id"].(string); return value }

func (w *cloudWorker) identity() map[string]any {
	return map[string]any{"device_id": w.deviceID(), "agent_id": w.agentID(), "device_secret": w.secret()}
}

func (w *cloudWorker) fail(err error, now time.Time) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.lastError, w.lastErrorAt = redactCloudError(err.Error(), w.secret()), now
	var status *cloudHTTPError
	if errors.As(err, &status) && status.status == http.StatusUnauthorized {
		// The Relay lost the device record: register again.
		w.reregister = true
	}
}

func redactCloudError(text, secret string) string {
	if secret != "" {
		text = strings.ReplaceAll(text, secret, "…")
	}
	if len(text) > 300 {
		text = text[:300]
	}
	return text
}

// cloudCall is one call carried over the Relay.
type cloudCall struct {
	callID     string // the Relay's call id ("android-…" or "outgoing-…")
	uuid       string
	secret     string
	relay      string
	direction  string
	generation int64
	agentCall  string // Halo's agentCall.ID
	phase      string
	cancel     context.CancelFunc
}

// ---- Supervisor ----

func (c *airsimCloud) run(ctx context.Context) {
	go c.drainEvents(ctx)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		c.reconcile(ctx)
		select {
		case <-ctx.Done():
			c.stopWorker()
			return
		case <-ticker.C:
		}
	}
}

func (c *airsimCloud) drainEvents(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case event := <-c.events:
			event()
		}
	}
}

func (c *airsimCloud) enqueue(event func()) {
	select {
	case c.events <- event:
	default:
		c.a.s.logger.Warn("AirSIM cloud event queue full", "category", "airsim")
	}
}

// desired picks the identity Halo should run, or nil.
func (c *airsimCloud) desired() *cloudWorker {
	cfg := c.a.config()
	if !cfg.Enabled || !cfg.Cloud {
		return nil
	}
	for index := len(cfg.Clients) - 1; index >= 0; index-- {
		client := cfg.Clients[index]
		if client.LocalMode || !client.CloudEnabled || len(client.Registration) == 0 {
			continue
		}
		var reg map[string]any
		if json.Unmarshal(client.Registration, &reg) != nil {
			continue
		}
		relay, err := cloudRelayURL(reg)
		if err != nil {
			continue
		}
		deviceID, _ := reg["device_id"].(string)
		secret, _ := reg["device_secret"].(string)
		if strings.TrimSpace(deviceID) == "" || secret == "" {
			continue
		}
		name := cfg.Name
		if name == "" {
			name = "Halo"
		}
		reg["android_agent_id"] = cfg.AgentID
		reg["android_device_name"] = name
		reg["android_manufacturer"] = "Halo"
		reg["android_model"] = "NAS"
		reg["android_agent_kind"] = "standalone"
		encoded, _ := json.Marshal(reg)
		digest := sha256.Sum256(append(encoded, client.ID...))
		return &cloudWorker{scope: hex.EncodeToString(digest[:]), clientID: client.ID, reg: reg, relay: relay}
	}
	return nil
}

func cloudRelayURL(reg map[string]any) (*url.URL, error) {
	raw, _ := reg["relay_url"].(string)
	relay, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || !strings.EqualFold(relay.Scheme, "https") || relay.Host == "" || relay.User != nil {
		return nil, errors.New("relay must be an https URL without credentials")
	}
	return relay, nil
}

func (c *airsimCloud) reconcile(ctx context.Context) {
	want := c.desired()
	c.mu.Lock()
	current := c.worker
	if current != nil && want != nil && current.scope == want.scope {
		c.mu.Unlock()
		return
	}
	if current == nil && want == nil {
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()
	c.stopWorker()
	if want == nil {
		return
	}
	workerCtx, cancel := context.WithCancel(ctx)
	want.cancel = cancel
	c.mu.Lock()
	c.worker = want
	c.mu.Unlock()
	c.a.s.logger.Info("AirSIM cloud started", "category", "airsim", "relay", want.relay.Host, "client", want.clientID)
	go c.heartbeatLoop(workerCtx, want)
	go c.commandLoop(workerCtx, want)
	go c.smsLoop(workerCtx, want)
}

func (c *airsimCloud) stopWorker() {
	c.mu.Lock()
	worker := c.worker
	c.worker = nil
	call := c.call
	c.call = nil
	c.mu.Unlock()
	if worker != nil {
		worker.cancel()
		c.a.s.logger.Info("AirSIM cloud stopped", "category", "airsim", "client", worker.clientID)
	}
	if call != nil && call.cancel != nil {
		call.cancel()
	}
}

func (c *airsimCloud) currentWorker() *cloudWorker {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.worker
}

// status is shown on Halo's iPhone page.
func (c *airsimCloud) status() map[string]any {
	worker := c.currentWorker()
	if worker == nil {
		return map[string]any{"running": false}
	}
	worker.mu.Lock()
	defer worker.mu.Unlock()
	result := map[string]any{
		"running": true, "relay": worker.relay.Host, "client": worker.clientID,
		"registered": worker.registered, "commands_connected": worker.connected,
	}
	if !worker.lastHeartbeat.IsZero() {
		result["last_heartbeat"] = worker.lastHeartbeat
	}
	if worker.lastError != "" {
		result["last_error"] = worker.lastError
		result["last_error_at"] = worker.lastErrorAt
	}
	return result
}

// ---- HTTP ----

type cloudHTTPError struct {
	status int
	body   string
}

func (e *cloudHTTPError) Error() string {
	return fmt.Sprintf("relay HTTP %d: %s", e.status, strings.TrimSpace(e.body))
}

func (c *airsimCloud) post(ctx context.Context, worker *cloudWorker, path string, payload map[string]any, timeout time.Duration) (map[string]any, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, worker.relay.String()+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	request.Header.Set("User-Agent", "Halo-AirSIM-Agent/1")
	response, err := c.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 256<<10))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &cloudHTTPError{status: response.StatusCode, body: string(data)}
	}
	result := map[string]any{}
	if len(bytes.TrimSpace(data)) > 0 {
		_ = json.Unmarshal(data, &result)
	}
	return result, nil
}

func withIdentity(worker *cloudWorker, fields map[string]any) map[string]any {
	payload := worker.identity()
	for key, value := range fields {
		payload[key] = value
	}
	return payload
}

// ---- Registration and heartbeat ----

func (c *airsimCloud) heartbeatLoop(ctx context.Context, worker *cloudWorker) {
	failures := 0
	for ctx.Err() == nil {
		wait := cloudHeartbeatEvery
		if err := c.registerAndBeat(ctx, worker); err != nil {
			if ctx.Err() != nil {
				return
			}
			worker.fail(err, c.now())
			failures = min(failures+1, 6)
			wait = time.Duration(1<<failures) * time.Second
			c.a.s.logger.Info("AirSIM cloud heartbeat failed", "category", "airsim", "error", redactCloudError(err.Error(), worker.secret()))
		} else {
			failures = 0
		}
		if !sleepCtx(ctx, wait) {
			return
		}
	}
}

func (c *airsimCloud) registerAndBeat(ctx context.Context, worker *cloudWorker) error {
	worker.mu.Lock()
	needRegister := !worker.registered || worker.reregister
	worker.mu.Unlock()
	if needRegister {
		if _, err := c.post(ctx, worker, "/v1/devices/register", worker.reg, 15*time.Second); err != nil {
			return err
		}
		worker.mu.Lock()
		worker.registered, worker.reregister = true, false
		worker.mu.Unlock()
	}
	_, err := c.post(ctx, worker, "/v1/events/heartbeat", withIdentity(worker, map[string]any{
		"event": "agent_heartbeat", "agent_version": cloudAgentVersion, "agent_kind": "standalone",
		"command_routing_version": 1, "device_name": worker.reg["android_device_name"],
		"manufacturer": "Halo", "model": "NAS", "phone_number": c.phoneNumber(ctx),
		"at_ok": true, "cellular_state": "registered", "cellular_registration": "Halo",
		"cellular_recovery": "not_required", "ecm_carrier": "halo",
	}), 12*time.Second)
	if err != nil {
		return err
	}
	worker.mu.Lock()
	worker.lastHeartbeat, worker.lastError = c.now(), ""
	worker.mu.Unlock()
	return nil
}

func (c *airsimCloud) phoneNumber(ctx context.Context) string {
	for _, line := range c.a.lines(ctx) {
		if line.number != "" {
			return line.number
		}
	}
	return ""
}

func sleepCtx(ctx context.Context, wait time.Duration) bool {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// ---- Commands ----

func (c *airsimCloud) commandLoop(ctx context.Context, worker *cloudWorker) {
	failures := 0
	for ctx.Err() == nil {
		connectedAt := c.now()
		err := c.commandSocket(ctx, worker)
		if ctx.Err() != nil {
			return
		}
		worker.mu.Lock()
		worker.connected = false
		worker.mu.Unlock()
		if err != nil {
			worker.fail(err, c.now())
		}
		if c.now().Sub(connectedAt) > time.Minute {
			failures = 0
		}
		failures = min(failures+1, 5)
		// While the socket is down, still pick up queued commands.
		if err := c.pollCommands(ctx, worker); err != nil && ctx.Err() == nil {
			worker.fail(err, c.now())
		}
		if !sleepCtx(ctx, min(time.Duration(1<<failures)*time.Second, cloudPollEvery)) {
			return
		}
	}
}

func (c *airsimCloud) commandSocket(ctx context.Context, worker *cloudWorker) error {
	endpoint := "wss://" + worker.relay.Host + "/v2/devices/" + url.PathEscape(worker.deviceID()) +
		"/commands/connect?agent_id=" + url.QueryEscape(worker.agentID())
	header := http.Header{}
	header.Set("Authorization", "Bearer "+worker.secret())
	conn, response, err := c.dial(ctx, endpoint, &websocket.DialOptions{HTTPClient: c.client, HTTPHeader: header})
	if err != nil {
		if response != nil {
			return &cloudHTTPError{status: response.StatusCode, body: "command channel refused"}
		}
		return err
	}
	defer conn.CloseNow()
	conn.SetReadLimit(64 << 10)
	worker.mu.Lock()
	worker.connected = true
	worker.mu.Unlock()
	pingCtx, stopPing := context.WithCancel(ctx)
	defer stopPing()
	go func() {
		for sleepCtx(pingCtx, 25*time.Second) {
			pinged, cancel := context.WithTimeout(pingCtx, 10*time.Second)
			err := conn.Ping(pinged)
			cancel()
			if err != nil {
				_ = conn.Close(websocket.StatusGoingAway, "keepalive failed")
				return
			}
		}
	}()
	for {
		kind, data, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		if kind != websocket.MessageText {
			continue
		}
		var command map[string]any
		if json.Unmarshal(data, &command) != nil {
			continue
		}
		if target, _ := command["target_agent_id"].(string); target != worker.agentID() {
			continue
		}
		result := c.execute(ctx, worker, command)
		encoded, _ := json.Marshal(result)
		if err := conn.Write(ctx, websocket.MessageText, encoded); err != nil {
			return err
		}
	}
}

func (c *airsimCloud) pollCommands(ctx context.Context, worker *cloudWorker) error {
	batch, err := c.post(ctx, worker, "/v2/commands/pull", worker.identity(), 12*time.Second)
	if err != nil {
		return err
	}
	commands, _ := batch["commands"].([]any)
	for _, item := range commands {
		command, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if target, _ := command["target_agent_id"].(string); target != worker.agentID() {
			continue
		}
		result := c.execute(ctx, worker, command)
		completion := worker.identity()
		for _, key := range []string{"command_id", "status", "result", "error"} {
			if value, ok := result[key]; ok {
				completion[key] = value
			}
		}
		if _, err := c.post(ctx, worker, "/v2/commands/complete", completion, 12*time.Second); err != nil {
			return err
		}
	}
	return nil
}

func commandFailed(id, reason string) map[string]any {
	return map[string]any{"command_id": id, "status": "failed", "error": reason}
}

func commandDone(id string, result map[string]any) map[string]any {
	return map[string]any{"command_id": id, "status": "completed", "result": result}
}

// execute runs one Relay command once; a redelivered command gets the same
// answer without acting again.
func (c *airsimCloud) execute(ctx context.Context, worker *cloudWorker, command map[string]any) map[string]any {
	text := func(key string) string { value, _ := command[key].(string); return strings.TrimSpace(value) }
	id := strings.ToLower(text("command_id"))
	if !validCommandID(id) {
		return commandFailed(id, "invalid_command_id")
	}
	c.mu.Lock()
	if cached, ok := c.results[id]; ok {
		c.mu.Unlock()
		return cached
	}
	c.mu.Unlock()
	result := c.run1(ctx, worker, id, command, text)
	c.mu.Lock()
	c.results[id] = result
	c.resultAt = append(c.resultAt, id)
	for len(c.resultAt) > 128 {
		delete(c.results, c.resultAt[0])
		c.resultAt = c.resultAt[1:]
	}
	c.mu.Unlock()
	return result
}

func validCommandID(id string) bool {
	if len(id) != 36 {
		return false
	}
	for index, char := range id {
		switch index {
		case 8, 13, 18, 23:
			if char != '-' {
				return false
			}
		default:
			if !strings.ContainsRune("0123456789abcdef", char) {
				return false
			}
		}
	}
	return true
}

func (c *airsimCloud) run1(ctx context.Context, worker *cloudWorker, id string, command map[string]any, text func(string) string) map[string]any {
	if expires, err := time.Parse(time.RFC3339Nano, text("expires_at")); err != nil || c.now().After(expires) {
		return commandFailed(id, "command_expired")
	}
	switch text("type") {
	case "dial":
		return c.dialCommand(ctx, worker, id, command, text("number"))
	case "send_sms":
		switch c.a.sendSMSOn(ctx, text("sim_account"), text("number"), command["message"]) {
		case nil:
			return commandDone(id, map[string]any{"sent": true, "segments": 1})
		case errNoLine:
			return commandFailed(id, "no_line_ready")
		default:
			return commandFailed(id, "sms_send_failed")
		}
	case "dtmf":
		return commandFailed(id, "dtmf_unsupported")
	case "call_control":
		call, _ := command["call"].(map[string]any)
		current := c.boundCall(call)
		if current == nil {
			return commandFailed(id, "call_mismatch")
		}
		action := text("action")
		switch action {
		case "answer":
			if status, result := c.a.actOnActive(ctx, current.agentCall, "answer"); status >= 300 {
				return commandFailed(id, errorCode(result))
			}
			return commandDone(id, map[string]any{"answered": true, "android_confirmed": true})
		case "reject", "end", "rescue_hangup":
			if status, result := c.a.actOnActive(ctx, current.agentCall, "hangup"); status >= 300 {
				return commandFailed(id, errorCode(result))
			}
			return commandDone(id, map[string]any{"ended": true, "android_confirmed": true})
		}
		return commandFailed(id, "invalid_call_action")
	}
	return commandFailed(id, "unsupported_command")
}

func errorCode(result map[string]any) string {
	if code, _ := result["error"].(string); code != "" {
		return code
	}
	return "call_failed"
}

// boundCall returns the cloud call that descriptor names, if it is current.
func (c *airsimCloud) boundCall(descriptor map[string]any) *cloudCall {
	if descriptor == nil {
		return nil
	}
	uuid, _ := descriptor["call_uuid"].(string)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.call == nil || !strings.EqualFold(c.call.uuid, uuid) {
		return nil
	}
	copied := *c.call
	return &copied
}

func (c *airsimCloud) dialCommand(ctx context.Context, worker *cloudWorker, id string, command map[string]any, number string) map[string]any {
	descriptor, _ := command["call"].(map[string]any)
	call, err := outgoingCloudCall(descriptor, worker)
	if err != nil {
		return commandFailed(id, err.Error())
	}
	callID, status, result := c.a.placeCall(ctx, "", number, func(agentCallID string) {
		call.agentCall = agentCallID
		call.phase = "connecting"
		c.adopt(ctx, call)
	})
	if status >= 300 {
		return commandFailed(id, errorCode(result))
	}
	if callID == "" {
		return commandFailed(id, "owned_dial_receipt_unavailable")
	}
	c.enqueue(func() { c.postPhase(ctx, worker, call, "connecting") })
	return commandDone(id, map[string]any{"dialing": true, "android_confirmed": true})
}

func outgoingCloudCall(descriptor map[string]any, worker *cloudWorker) (*cloudCall, error) {
	if descriptor == nil {
		return nil, errors.New("call_descriptor_missing")
	}
	text := func(key string) string { value, _ := descriptor[key].(string); return strings.TrimSpace(value) }
	call := &cloudCall{
		callID: text("call_id"), uuid: strings.ToLower(text("call_uuid")), secret: text("call_secret"),
		relay: strings.TrimRight(text("relay_url"), "/"), direction: "outgoing", generation: 1,
	}
	if value, ok := descriptor["generation"].(float64); ok && value >= 1 {
		call.generation = int64(value)
	}
	if call.relay == "" {
		call.relay = worker.relay.String()
	}
	relay, err := url.Parse(call.relay)
	if call.callID == "" || call.uuid == "" || call.secret == "" || err != nil ||
		!strings.EqualFold(relay.Scheme, "https") || relay.Host == "" || relay.User != nil {
		return nil, errors.New("call_descriptor_invalid")
	}
	return call, nil
}

// adopt makes call the cloud call and starts its media session.
func (c *airsimCloud) adopt(ctx context.Context, call *cloudCall) {
	mediaCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	call.cancel = cancel
	c.mu.Lock()
	previous := c.call
	c.call = call
	c.mu.Unlock()
	if previous != nil && previous.cancel != nil {
		previous.cancel()
	}
	go c.media(mediaCtx, call)
}

// ---- Call events ----

func cloudPhase(state string) string {
	switch state {
	case "incoming":
		return "ringing"
	case "dialing":
		return "connecting"
	case "active", "held":
		return "active"
	case "ended":
		return "ended"
	}
	return ""
}

// observe is called by the agent on every change of its active call.
func (c *airsimCloud) observe(before, after *agentCall) {
	if before == nil && after == nil {
		return
	}
	c.enqueue(func() { c.onCall(before, after) })
}

func (c *airsimCloud) onCall(before, after *agentCall) {
	worker := c.currentWorker()
	if worker == nil {
		return
	}
	ctx := context.Background()
	c.mu.Lock()
	call := c.call
	c.mu.Unlock()

	if before != nil && (after == nil || after.ID != before.ID) && call != nil && call.agentCall == before.ID {
		c.endCall(ctx, worker, call)
		call = nil
	}
	if after == nil {
		return
	}
	if call == nil && after.Direction == "incoming" && after.State == "incoming" {
		incoming, err := newIncomingCloudCall(worker, after.ID, c.now())
		if err != nil {
			return
		}
		ringing := withIdentity(worker, map[string]any{
			"event": "incoming_call", "call_id": incoming.callID, "call_uuid": incoming.uuid,
			"generation": incoming.generation, "call_secret": incoming.secret,
			"number": after.Number, "caller_name": "",
			"issued_at":       c.now().UTC().Format(time.RFC3339Nano),
			"expires_at":      c.now().Add(90 * time.Second).UTC().Format(time.RFC3339Nano),
			"media_transport": "legacy_pcm",
		})
		if err := c.postRelay(ctx, worker, "/v2/events/call", ringing, 5*time.Second); err != nil {
			worker.fail(err, c.now())
			c.a.s.logger.Info("AirSIM cloud incoming call not delivered", "category", "airsim",
				"error", redactCloudError(err.Error(), worker.secret()))
			return
		}
		c.adopt(ctx, incoming)
		call = incoming
	}
	if call == nil || call.agentCall != after.ID {
		return
	}
	if phase := cloudPhase(after.State); phase != "" && phase != call.phase {
		c.postPhase(ctx, worker, call, phase)
	}
}

func newIncomingCloudCall(worker *cloudWorker, agentCallID string, now time.Time) (*cloudCall, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	return &cloudCall{
		callID: "android-" + strconv.FormatInt(now.UnixMilli(), 10), uuid: newCloudUUID(),
		secret: hex.EncodeToString(secret), relay: worker.relay.String(), direction: "incoming",
		generation: 1, agentCall: agentCallID,
	}, nil
}

func newCloudUUID() string {
	value := make([]byte, 16)
	_, _ = rand.Read(value)
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	text := hex.EncodeToString(value)
	return text[0:8] + "-" + text[8:12] + "-" + text[12:16] + "-" + text[16:20] + "-" + text[20:32]
}

func (c *airsimCloud) postPhase(ctx context.Context, worker *cloudWorker, call *cloudCall, phase string) {
	c.mu.Lock()
	if c.call != nil && c.call.uuid == call.uuid {
		c.call.phase = phase
	}
	c.mu.Unlock()
	call.phase = phase
	state := withIdentity(worker, map[string]any{
		"event": "call_state", "call_id": call.callID, "call_uuid": call.uuid, "generation": call.generation,
		"phase": phase, "source": "agent", "timestamp": c.now().UTC().Format(time.RFC3339Nano),
		"trace_id": "halo-" + call.uuid + "-" + phase,
	})
	if err := c.postRelay(ctx, worker, "/v2/events/call-state", state, 12*time.Second); err != nil {
		worker.fail(err, c.now())
	}
	if phase == "active" || phase == "ended" {
		// Best effort, as on Android: tells the iPhone the call is owned by
		// the phone side.
		_, _ = c.post(ctx, worker, "/v1/events/call-owner", withIdentity(worker, map[string]any{
			"event": "call_owner", "call_id": call.callID, "call_uuid": call.uuid,
			"generation": call.generation, "owner": "android", "phase": phase,
		}), 12*time.Second)
	}
}

func (c *airsimCloud) endCall(ctx context.Context, worker *cloudWorker, call *cloudCall) {
	c.postPhase(ctx, worker, call, "ended")
	c.mu.Lock()
	if c.call != nil && c.call.uuid == call.uuid {
		c.call = nil
	}
	c.mu.Unlock()
	if call.cancel != nil {
		call.cancel()
	}
}

// postRelay posts a call event. A lifecycle the Relay still holds from a
// call that never ended (a crash, a lost "ended") makes it refuse the new
// one with 409 identity_mismatch: end exactly that stale call and retry once.
func (c *airsimCloud) postRelay(ctx context.Context, worker *cloudWorker, path string, payload map[string]any, timeout time.Duration) error {
	_, err := c.post(ctx, worker, path, payload, timeout)
	var refused *cloudHTTPError
	if err == nil || !errors.As(err, &refused) || refused.status != http.StatusConflict {
		return err
	}
	var answer struct {
		Reason    string `json:"reason"`
		Lifecycle struct {
			CallID     string `json:"call_id"`
			CallUUID   string `json:"call_uuid"`
			Generation int64  `json:"generation"`
		} `json:"lifecycle"`
	}
	if json.Unmarshal([]byte(refused.body), &answer) != nil || answer.Reason != "identity_mismatch" ||
		answer.Lifecycle.CallID == "" || answer.Lifecycle.CallUUID == "" {
		return err
	}
	if _, stale := c.post(ctx, worker, "/v2/events/call-state", withIdentity(worker, map[string]any{
		"event": "call_state", "call_id": answer.Lifecycle.CallID, "call_uuid": answer.Lifecycle.CallUUID,
		"generation": max(answer.Lifecycle.Generation, 1), "phase": "ended", "source": "agent",
		"timestamp": c.now().UTC().Format(time.RFC3339Nano), "trace_id": "halo-stale-" + answer.Lifecycle.CallUUID,
	}), 12*time.Second); stale != nil {
		return err
	}
	_, err = c.post(ctx, worker, path, payload, timeout)
	return err
}

// ---- Media ----

// media holds the agent end of the Relay's media WebSocket for one call,
// reconnecting until the call ends.
func (c *airsimCloud) media(ctx context.Context, call *cloudCall) {
	endpoint := "wss" + strings.TrimPrefix(call.relay, "https") + "/v1/calls/" + call.uuid +
		"/connect?role=agent&token=" + url.QueryEscape(call.secret)
	failures := 0
	for ctx.Err() == nil {
		conn, response, err := c.dial(ctx, endpoint, &websocket.DialOptions{HTTPClient: c.client})
		if err != nil {
			if response != nil {
				switch response.StatusCode {
				case http.StatusUnauthorized, http.StatusNotFound, http.StatusGone, http.StatusBadRequest:
					// The Relay no longer has this call.
					return
				}
			}
			failures = min(failures+1, 4)
			if !sleepCtx(ctx, min(time.Duration(1<<failures)*time.Second, 15*time.Second)) {
				return
			}
			continue
		}
		failures = 0
		conn.SetReadLimit(64 << 10)
		done := c.serveMedia(ctx, call, conn)
		conn.CloseNow()
		if done {
			return
		}
		if !sleepCtx(ctx, time.Second) {
			return
		}
	}
}

func cloudStatus(call *cloudCall, status, message string) []byte {
	value := map[string]any{"status": status, "call_id": call.callID, "call_uuid": call.uuid, "generation": call.generation}
	if message != "" {
		value["message"] = message
	}
	encoded, _ := json.Marshal(value)
	return encoded
}

// serveMedia runs one media connection. It reports true once the call is
// over (rejected or ended from the iPhone).
func (c *airsimCloud) serveMedia(ctx context.Context, call *cloudCall, conn *websocket.Conn) bool {
	connCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	send := func(kind websocket.MessageType, data []byte) error {
		written, done := context.WithTimeout(connCtx, 5*time.Second)
		defer done()
		return conn.Write(written, kind, data)
	}
	if send(websocket.MessageText, cloudStatus(call, "agent_ready", "")) != nil {
		return false
	}
	var (
		pumpMu   sync.Mutex
		uplink   vowifi.CallMedia
		started  bool
		protocol string
	)
	for {
		kind, data, err := conn.Read(connCtx)
		if err != nil {
			return false
		}
		if kind == websocket.MessageBinary {
			pumpMu.Lock()
			media := uplink
			pumpMu.Unlock()
			if media == nil {
				continue
			}
			payload, err := decodeCloudPCM(data)
			if err != nil {
				return false
			}
			for offset := 0; offset+cloudFrameBytes <= len(payload); offset += cloudFrameBytes {
				samples := make([]int16, cloudFrameBytes/2)
				for index := range samples {
					samples[index] = int16(binary.LittleEndian.Uint16(payload[offset+index*2:]))
				}
				if media.WritePCM(samples) != nil {
					return false
				}
			}
			continue
		}
		var control struct {
			Action        string `json:"action"`
			MediaProtocol string `json:"media_protocol"`
		}
		if json.Unmarshal(data, &control) != nil {
			continue
		}
		switch control.Action {
		case "answer":
			protocol = control.MediaProtocol
			if call.direction == "incoming" {
				if active := c.a.activeCall(); active != nil && active.ID == call.agentCall && active.State == "incoming" {
					if status, result := c.a.actOnActive(connCtx, call.agentCall, "answer"); status >= 300 {
						_ = send(websocket.MessageText, cloudStatus(call, "action_error", errorCode(result)))
						continue
					}
				}
			}
			_ = send(websocket.MessageText, cloudStatus(call, "answer_ok", ""))
			if !started {
				started = true
				go c.pump(connCtx, call, conn, protocol, send, func(media vowifi.CallMedia) {
					pumpMu.Lock()
					uplink = media
					pumpMu.Unlock()
				})
			}
		case "reject", "end":
			if active := c.a.activeCall(); active != nil && active.ID == call.agentCall {
				if status, result := c.a.actOnActive(connCtx, call.agentCall, "hangup"); status >= 300 {
					_ = send(websocket.MessageText, cloudStatus(call, "action_error", errorCode(result)))
					continue
				}
			}
			final := "ended"
			if control.Action == "reject" {
				final = "rejected"
			}
			_ = send(websocket.MessageText, cloudStatus(call, final, ""))
			return true
		}
	}
}

// pump waits for the call's audio, then streams it to the Relay; uplink
// frames go to the media handed to attach.
func (c *airsimCloud) pump(ctx context.Context, call *cloudCall, conn *websocket.Conn, protocol string,
	send func(websocket.MessageType, []byte) error, attach func(vowifi.CallMedia)) {
	var agentCall *agentCall
	deadline := c.now().Add(45 * time.Second)
	for c.now().Before(deadline) {
		if active := c.a.activeCall(); active != nil && active.ID == call.agentCall && active.State == "active" && active.mediaReady {
			agentCall = active
			break
		}
		if !sleepCtx(ctx, 150*time.Millisecond) {
			return
		}
	}
	if agentCall == nil {
		_ = send(websocket.MessageText, cloudStatus(call, "action_error", "media_unavailable"))
		return
	}
	media, release, err := c.a.openMedia(ctx, agentCall)
	if release != nil {
		defer release()
	}
	if err != nil {
		c.a.s.logger.Info("AirSIM cloud call has no media", "category", "airsim", "reason", err.Error())
		_ = send(websocket.MessageText, cloudStatus(call, "action_error", "media_unavailable"))
		return
	}
	attach(media)
	defer attach(nil)
	for _, status := range []string{"pcm_listening", "active", "pcm_ready"} {
		if send(websocket.MessageText, cloudStatus(call, status, "")) != nil {
			return
		}
	}
	c.a.s.logger.Info("AirSIM cloud audio connected", "category", "airsim", "device_id", agentCall.deviceID)
	var pending []byte
	var sequence uint32
	first := true
	for {
		samples, err := media.ReadPCM(ctx)
		if err != nil {
			_ = conn.Close(websocket.StatusGoingAway, "call media ended")
			return
		}
		for _, sample := range samples {
			pending = binary.LittleEndian.AppendUint16(pending, uint16(sample))
		}
		for len(pending) >= cloudFrameBytes {
			frame := encodeCloudPCM(protocol, pending[:cloudFrameBytes], sequence, c.now())
			sequence++
			pending = pending[cloudFrameBytes:]
			if send(websocket.MessageBinary, frame) != nil {
				return
			}
			if first {
				first = false
				_ = send(websocket.MessageText, cloudStatus(call, "pcm_first_frame", ""))
			}
		}
		pending = append([]byte(nil), pending...)
	}
}

// AirSIM's optional frame header: "ASPM", version 1, flags 0, header length
// 20, sequence and send time (big endian), then 320 bytes of PCM.
const cloudPCMProtocol = "airsim-pcm-v1"

func encodeCloudPCM(protocol string, payload []byte, sequence uint32, now time.Time) []byte {
	if !strings.EqualFold(protocol, cloudPCMProtocol) {
		return append([]byte(nil), payload...)
	}
	frame := make([]byte, 20, 20+len(payload))
	copy(frame, "ASPM")
	frame[4] = 1
	binary.BigEndian.PutUint16(frame[6:], 20)
	binary.BigEndian.PutUint32(frame[8:], sequence)
	binary.BigEndian.PutUint64(frame[12:], uint64(now.UnixMilli()))
	return append(frame, payload...)
}

func decodeCloudPCM(frame []byte) ([]byte, error) {
	if len(frame) < 4 || string(frame[:4]) != "ASPM" {
		if len(frame)%cloudFrameBytes != 0 {
			return nil, errors.New("PCM frame length")
		}
		return frame, nil
	}
	if len(frame) != 20+cloudFrameBytes || frame[4] != 1 || binary.BigEndian.Uint16(frame[6:]) != 20 {
		return nil, errors.New("AirSIM PCM frame invalid")
	}
	return frame[20:], nil
}

// ---- SMS ----

func (c *airsimCloud) smsLoop(ctx context.Context, worker *cloudWorker) {
	cursor, ok := c.smsCursor(ctx, worker.clientID)
	if !ok {
		return
	}
	failures := 0
	for ctx.Err() == nil {
		inserted := c.a.s.store.SMSInserted()
		next, err := c.pushSMS(ctx, worker, cursor)
		if next != cursor {
			cursor = next
			c.saveSMSCursor(ctx, worker.clientID, cursor)
		}
		wait := 30 * time.Second
		if err != nil && ctx.Err() == nil {
			worker.fail(err, c.now())
			failures = min(failures+1, 6)
			wait = time.Duration(1<<failures) * time.Second
		} else {
			failures = 0
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-inserted:
			timer.Stop()
		case <-timer.C:
		}
	}
}

// smsCursor starts a new identity at the newest SMS, so turning the cloud on
// does not push the whole inbox.
func (c *airsimCloud) smsCursor(ctx context.Context, clientID string) (int64, bool) {
	client, ok := c.a.client(clientID)
	if !ok {
		return 0, false
	}
	if client.CloudSMSCursor > 0 {
		return client.CloudSMSCursor, true
	}
	latest, err := c.a.s.store.LatestSMSMessageID(ctx)
	if err != nil {
		return 0, false
	}
	c.saveSMSCursor(ctx, clientID, latest)
	return latest, true
}

func (c *airsimCloud) saveSMSCursor(ctx context.Context, clientID string, cursor int64) {
	_, _ = c.a.update(ctx, func(cfg *airsimAgentConfig) {
		for index := range cfg.Clients {
			if cfg.Clients[index].ID == clientID && cursor > cfg.Clients[index].CloudSMSCursor {
				cfg.Clients[index].CloudSMSCursor = cursor
			}
		}
	})
}

func (c *airsimCloud) pushSMS(ctx context.Context, worker *cloudWorker, cursor int64) (int64, error) {
	messages, err := c.a.s.store.ListInboundSMSAfterID(ctx, cursor, 20)
	if err != nil {
		return cursor, err
	}
	slots := map[string]int{}
	for _, line := range c.a.lines(ctx) {
		slots[line.config.ID] = line.index
	}
	for _, message := range messages {
		event := withIdentity(worker, map[string]any{
			"event": "incoming_sms", "delivery_id": "halo-sms-" + strconv.FormatInt(message.ID, 10),
			"sender": message.Peer, "content": message.Body,
			"timestamp": message.Timestamp.UTC().Format(time.RFC3339Nano),
		})
		if slot, ok := slots[message.DeviceID]; ok {
			event["sim_slot"] = "SIM " + strconv.Itoa(slot+1)
		}
		if _, err := c.post(ctx, worker, "/v1/events/sms", event, 12*time.Second); err != nil {
			var refused *cloudHTTPError
			// 400: the Relay will never take this one (empty text, too
			// large); 409: the iPhone has no alert token. Skip it rather
			// than hold every later SMS behind it.
			if !errors.As(err, &refused) || (refused.status != http.StatusBadRequest && refused.status != http.StatusConflict) {
				return cursor, err
			}
		}
		cursor = message.ID
	}
	return cursor, nil
}
