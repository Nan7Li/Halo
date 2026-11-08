package airsim

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Client signs requests to one paired phone's VoWLAN gateways.
type Client struct {
	pairing Pairing
	secret  []byte
	http    *http.Client
	now     func() time.Time
}

// NewClient checks the pairing and returns a client for it.
func NewClient(pairing Pairing) (*Client, error) {
	if !pairing.valid() {
		return nil, errors.New("AirSIM pairing is incomplete")
	}
	secret, err := pairing.secret()
	if err != nil {
		return nil, err
	}
	return &Client{
		pairing: pairing,
		secret:  secret,
		http: &http.Client{
			// Long polls wait up to 25 s on the phone.
			Timeout:   40 * time.Second,
			Transport: &http.Transport{DisableKeepAlives: true, Proxy: nil},
		},
		now: time.Now,
	}, nil
}

// APIError is a non-2xx answer from the phone.
type APIError struct {
	Status int
	Code   string
}

func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("AirSIM 返回 HTTP %d：%s", e.Status, e.Code)
	}
	return fmt.Sprintf("AirSIM 返回 HTTP %d", e.Status)
}

// do sends one signed control request. pathAndQuery is signed exactly as
// sent, query included, as VoWLANControlGateway verifies it.
func (c *Client) do(ctx context.Context, method, pathAndQuery string, input, output any) (string, error) {
	var body []byte
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return "", err
		}
		body = encoded
	}
	timestamp := c.now().Unix()
	nonce := newNonce()
	signature := sign(c.secret, canonicalRequest(method, pathAndQuery, body, timestamp, nonce))
	address := net.JoinHostPort(c.pairing.Host, strconv.Itoa(c.pairing.ControlPort))
	request, err := http.NewRequestWithContext(ctx, method, "http://"+address+pathAndQuery, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	if body == nil {
		request.Body = nil
		request.ContentLength = 0
	} else {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("X-AirSIM-VoWLAN-Version", protocolVersion)
	request.Header.Set("X-AirSIM-VoWLAN-Timestamp", strconv.FormatInt(timestamp, 10))
	request.Header.Set("X-AirSIM-VoWLAN-Nonce", nonce)
	request.Header.Set("X-AirSIM-VoWLAN-Signature", signature)
	response, err := c.http.Do(request)
	if err != nil {
		return nonce, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nonce, err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		var failure struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(payload, &failure)
		return nonce, &APIError{Status: response.StatusCode, Code: failure.Error}
	}
	if output != nil && len(payload) > 0 {
		if err := json.Unmarshal(payload, output); err != nil {
			return nonce, fmt.Errorf("AirSIM 返回的数据无法解析：%w", err)
		}
	}
	return nonce, nil
}

// SIMSlot is one of the phone's Telecom accounts.
type SIMSlot struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Number      string `json:"number"`
	Default     bool   `json:"default"`
	SlotIndex   int    `json:"slot_index"`
	CarrierName string `json:"carrier_name"`
	Embedded    bool   `json:"is_embedded"`
	DefaultSMS  bool   `json:"is_default_sms"`
}

// Battery is the phone's battery as AirSIM reports it.
type Battery struct {
	Percent  int  `json:"percent"`
	Charging bool `json:"charging"`
}

// Health is the phone's signed /v1/health answer.
type Health struct {
	OK            bool      `json:"ok"`
	AgentID       string    `json:"agent_id"`
	IdentityProof string    `json:"identity_proof"`
	AgentKind     string    `json:"agent_kind"`
	DeviceName    string    `json:"device_name"`
	Manufacturer  string    `json:"manufacturer"`
	Model         string    `json:"model"`
	PhoneNumber   string    `json:"phone_number"`
	SIMSlots      []SIMSlot `json:"sim_slots"`
	Battery       *Battery  `json:"battery"`
}

// Health asks the phone to prove it is the paired agent.
func (c *Client) Health(ctx context.Context) (Health, error) {
	var health Health
	nonce, err := c.do(ctx, http.MethodGet, "/v1/health", nil, &health)
	if err != nil {
		return Health{}, err
	}
	if health.AgentID != c.pairing.AgentID ||
		!signatureEqual(healthProof(c.secret, nonce, c.pairing.AgentID), health.IdentityProof) {
		return Health{}, errors.New("这个地址上的手机不是已配对的那台")
	}
	return health, nil
}

// Call is AirSIM's view of the phone's current call.
type Call struct {
	ID        string `json:"id"`
	AndroidID string `json:"android_id"`
	Direction string `json:"direction"` // incoming | outgoing
	State     string `json:"state"`     // dialing | incoming | active | held | ended
	Number    string `json:"number"`
	StartedAt string `json:"started_at"`
	EndedAt   string `json:"ended_at"`
	Missed    bool   `json:"missed"`
	SlotIndex *int   `json:"slot_index,omitempty"`
}

// CallSnapshot is /api/calls/status.
type CallSnapshot struct {
	Active   *Call  `json:"active"`
	History  []Call `json:"history"`
	Revision int64  `json:"revision"`
}

// Events is one /api/events long-poll answer.
type Events struct {
	Revision    int64        `json:"revision"`
	SMSRevision int64        `json:"sms_revision"`
	SMSPending  int          `json:"sms_pending"`
	SIMSlots    []SIMSlot    `json:"sim_slots"`
	Call        CallSnapshot `json:"call"`
}

// WaitEvents blocks until the phone's event revision passes after, or about
// 25 seconds pass.
func (c *Client) WaitEvents(ctx context.Context, after int64) (Events, error) {
	var events Events
	_, err := c.do(ctx, http.MethodGet, "/api/events?after="+strconv.FormatInt(after, 10)+"&timeout_ms=25000", nil, &events)
	return events, err
}

// Calls returns the current call and recent history.
func (c *Client) Calls(ctx context.Context) (CallSnapshot, error) {
	var snapshot CallSnapshot
	_, err := c.do(ctx, http.MethodGet, "/api/calls/status", nil, &snapshot)
	return snapshot, err
}

// Dial places a cellular call from the phone; simAccount picks a SIM by its
// SIMSlot.ID, or the phone's default when empty.
func (c *Client) Dial(ctx context.Context, number, simAccount string) error {
	input := map[string]string{"number": number}
	if simAccount != "" {
		input["sim_account"] = simAccount
	}
	_, err := c.do(ctx, http.MethodPost, "/api/calls/dial", input, nil)
	return err
}

// Answer, Reject and Hangup act on the call with AirSIM's call ID.
func (c *Client) Answer(ctx context.Context, callID string) error {
	return c.callAction(ctx, "/api/calls/answer", callID, nil)
}

func (c *Client) Reject(ctx context.Context, callID string) error {
	return c.callAction(ctx, "/api/calls/reject", callID, nil)
}

func (c *Client) Hangup(ctx context.Context, callID string) error {
	return c.callAction(ctx, "/api/calls/hangup", callID, nil)
}

// DTMF sends one key during the call.
func (c *Client) DTMF(ctx context.Context, callID, digit string) error {
	return c.callAction(ctx, "/api/calls/dtmf", callID, map[string]string{"digit": digit})
}

func (c *Client) callAction(ctx context.Context, path, callID string, extra map[string]string) error {
	input := map[string]string{"call_id": callID}
	for key, value := range extra {
		input[key] = value
	}
	_, err := c.do(ctx, http.MethodPost, path, input, nil)
	return err
}

// SMS is a received message waiting on the phone until acknowledged.
type SMS struct {
	DeliveryID string `json:"delivery_id"`
	Sender     string `json:"sender"`
	Content    string `json:"content"`
	SIMSlot    string `json:"sim_slot"`
	Timestamp  string `json:"timestamp"`
}

// PendingSMS lists received messages Halo has not acknowledged yet.
func (c *Client) PendingSMS(ctx context.Context) ([]SMS, error) {
	var messages []SMS
	_, err := c.do(ctx, http.MethodGet, "/api/sms", nil, &messages)
	return messages, err
}

// AckSMS tells the phone these messages are safely stored in Halo.
func (c *Client) AckSMS(ctx context.Context, ids []string) error {
	_, err := c.do(ctx, http.MethodPost, "/api/sms/ack", map[string]any{"ids": ids}, nil)
	return err
}

// SendSMS sends a text from the phone.
func (c *Client) SendSMS(ctx context.Context, phone, message, simAccount string) error {
	input := map[string]string{"phone": phone, "message": message}
	if simAccount != "" {
		input["sim_account"] = simAccount
	}
	_, err := c.do(ctx, http.MethodPost, "/api/sms/send", input, nil)
	return err
}

// Media is the call's two-way audio on the phone's PCM gateway: 8 kHz mono
// signed 16-bit little-endian, as AirSIM's Shizuku bridge carries it. It
// implements vowifi.CallMedia.
type Media struct {
	conn   net.Conn
	reader *bufio.Reader
	write  sync.Mutex
	once   sync.Once
}

// OpenMedia authenticates to the PCM gateway. The phone allows one PCM
// session at a time, and only while a call is up.
func (c *Client) OpenMedia(ctx context.Context) (*Media, error) {
	dialer := net.Dialer{Timeout: 5 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(c.pairing.Host, strconv.Itoa(c.pairing.PCMPort)))
	if err != nil {
		return nil, fmt.Errorf("连不上安卓的通话音频端口：%w", err)
	}
	if tcp, ok := conn.(*net.TCPConn); ok {
		_ = tcp.SetNoDelay(true)
	}
	timestamp := c.now().Unix()
	nonce := newNonce()
	signature := sign(c.secret, canonicalRequest("PCM", "/v1/pcm", nil, timestamp, nonce))
	_ = conn.SetDeadline(time.Now().Add(8 * time.Second))
	if _, err := fmt.Fprintf(conn, "%s %d %s %s\n", pcmMagic, timestamp, nonce, signature); err != nil {
		conn.Close()
		return nil, err
	}
	reader := bufio.NewReaderSize(conn, 4096)
	ready := make([]byte, len(pcmReady))
	if _, err := io.ReadFull(reader, ready); err != nil || string(ready) != pcmReady {
		conn.Close()
		return nil, errors.New("安卓拒绝了通话音频：需要通话已接通、Shizuku 音频桥在运行，且同时只能有一个收听端")
	}
	_ = conn.SetDeadline(time.Time{})
	return &Media{conn: conn, reader: reader}, nil
}

// Codec names the narrowband telephone audio the frames carry. They are
// already linear PCM; "PCMU" is what Halo's browser bridge accepts for
// decoded 8 kHz call audio.
func (m *Media) Codec() string { return "PCMU" }

// ReadPCM returns the next 20 ms frame from the phone.
func (m *Media) ReadPCM(ctx context.Context) ([]int16, error) {
	if deadline, ok := ctx.Deadline(); ok {
		_ = m.conn.SetReadDeadline(deadline)
	}
	stop := context.AfterFunc(ctx, func() { _ = m.conn.SetReadDeadline(time.Unix(1, 0)) })
	defer stop()
	frame := make([]byte, FrameSamples*2)
	if _, err := io.ReadFull(m.reader, frame); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	samples := make([]int16, FrameSamples)
	for i := range samples {
		samples[i] = int16(binary.LittleEndian.Uint16(frame[i*2:]))
	}
	return samples, nil
}

// WritePCM sends audio to the call.
func (m *Media) WritePCM(samples []int16) error {
	payload := make([]byte, len(samples)*2)
	for i, sample := range samples {
		binary.LittleEndian.PutUint16(payload[i*2:], uint16(sample))
	}
	m.write.Lock()
	defer m.write.Unlock()
	_ = m.conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
	_, err := m.conn.Write(payload)
	return err
}

// Close ends the audio session; the phone keeps the call.
func (m *Media) Close() error {
	var err error
	m.once.Do(func() { err = m.conn.Close() })
	return err
}
