package airsim

// The agent side: Halo answering AirSIM's iPhone client as if it were the
// paired Android phone. The SIM and the call stay on the NAS (a cellular
// module or VoWiFi); the iPhone app is only the handset.
//
// Written against the protocol of AirSIM's Android sources (PairingServer,
// PairingSession, PairingCrypto, VoWLANAuth, VoWLANControlGateway,
// VoWLANPCMProtocol, DirectGatewayRoutes). No AirSIM code is copied.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"sync"
	"time"
)

// PairLifetime is how long a pairing window stays open, as on Android.
const PairLifetime = 2 * time.Minute

// maxPairFailures closes a window after this many wrong codes. Android has
// no limit; Halo may be reachable from the internet, so it has one.
const maxPairFailures = 5

var (
	ErrPairExpired = errors.New("pairing_expired")
	ErrPairUsed    = errors.New("pairing_used")
	ErrPairAuth    = errors.New("pairing_auth_failed")
	ErrPairLocked  = errors.New("pairing_locked")
)

// PairWindow is one short-lived pairing session with its six-digit code.
type PairWindow struct {
	ID        string
	Code      string
	ExpiresAt time.Time

	private  *ecdh.PrivateKey
	mu       sync.Mutex
	used     bool
	failures int
}

// NewPairWindow opens a window that expires PairLifetime after now.
func NewPairWindow(now time.Time) (*PairWindow, error) {
	private, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	number, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return nil, err
	}
	return &PairWindow{
		ID:        newUUID(),
		Code:      fmt.Sprintf("%06d", number.Int64()),
		ExpiresAt: now.Add(PairLifetime),
		private:   private,
	}, nil
}

// PairInfo is the public answer to GET /pair/v1/info.
type PairInfo struct {
	Product         string `json:"product"`
	Version         int    `json:"version"`
	SessionID       string `json:"session_id"`
	ServerPublicKey string `json:"server_public_key"`
	ExpiresAt       int64  `json:"expires_at"`
	ServerTime      int64  `json:"server_time"`
}

func (w *PairWindow) Info(now time.Time) PairInfo {
	return PairInfo{
		Product:         "airsim-pair",
		Version:         1,
		SessionID:       w.ID,
		ServerPublicKey: b64.EncodeToString(w.private.PublicKey().Bytes()),
		ExpiresAt:       w.ExpiresAt.UnixMilli(),
		ServerTime:      now.UnixMilli(),
	}
}

// Open reports whether the window can still be claimed.
func (w *PairWindow) Open(now time.Time) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return !w.used && w.failures < maxPairFailures && !now.After(w.ExpiresAt)
}

// Claim decrypts the iPhone's sealed registration. The window is spent on
// success; wrong codes count towards maxPairFailures.
func (w *PairWindow) Claim(now time.Time, clientPublicKey, sealedRegistration string) ([]byte, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	switch {
	case w.used:
		return nil, ErrPairUsed
	case w.failures >= maxPairFailures:
		return nil, ErrPairLocked
	case now.After(w.ExpiresAt):
		return nil, ErrPairExpired
	}
	fail := func() ([]byte, error) {
		w.failures++
		if w.failures >= maxPairFailures {
			return nil, ErrPairLocked
		}
		return nil, ErrPairAuth
	}
	peerRaw, err := b64.DecodeString(clientPublicKey)
	if err != nil {
		return fail()
	}
	peer, err := ecdh.X25519().NewPublicKey(peerRaw)
	if err != nil {
		return fail()
	}
	shared, err := w.private.ECDH(peer)
	if err != nil {
		return fail()
	}
	key, err := pairingKey(shared, w.ID, w.Code)
	if err != nil {
		return fail()
	}
	sealed, err := b64.DecodeString(sealedRegistration)
	if err != nil {
		return fail()
	}
	plaintext, err := open(sealed, key, w.ID)
	if err != nil {
		return fail()
	}
	w.used = true
	return plaintext, nil
}

// open reverses seal: nonce(12) || AES-256-GCM, session ID as AAD.
func open(combined, key []byte, aad string) ([]byte, error) {
	if len(combined) < 12+16 || len(key) != 32 {
		return nil, errors.New("invalid AES-GCM payload")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, combined[:12], combined[12:], []byte(aad))
}

// Registration is the decrypted claim. Raw keeps every field the iPhone
// sent except the VoWLAN secret, for the Relay registration later.
type Registration struct {
	Secret       []byte
	LocalMode    bool
	CloudEnabled bool
	DeviceID     string
	RelayURL     string
	Raw          json.RawMessage
}

func ParseRegistration(plaintext []byte) (Registration, error) {
	var fields map[string]any
	if err := json.Unmarshal(plaintext, &fields); err != nil {
		return Registration{}, errors.New("registration is not JSON")
	}
	encoded, _ := fields["vowlan_secret"].(string)
	secret, err := b64.DecodeString(encoded)
	if err != nil || len(secret) < 32 {
		return Registration{}, errors.New("VoWLAN secret missing")
	}
	delete(fields, "vowlan_secret")
	raw, _ := json.Marshal(fields)
	text := func(key string) string { value, _ := fields[key].(string); return strings.TrimSpace(value) }
	flag := func(key string) bool { value, _ := fields[key].(bool); return value }
	return Registration{
		Secret:       secret,
		LocalMode:    flag("local_mode"),
		CloudEnabled: flag("cloud_enabled"),
		DeviceID:     text("device_id"),
		RelayURL:     text("relay_url"),
		Raw:          raw,
	}, nil
}

// HealthProof, RouteProof and DialProof are the signed receipts the iPhone
// checks before trusting an answer.
func HealthProof(secret []byte, nonce, agentID string) string {
	return healthProof(secret, nonce, agentID)
}

func RouteProof(secret []byte, session, clientKey, agentID string, controlPort, pcmPort int) string {
	return routeProof(secret, session, clientKey, agentID, controlPort, pcmPort)
}

func DialProof(secret []byte, nonce, operationID, androidID, backendID string) string {
	return sign(secret, "AIRSIM-DIAL1\n"+nonce+"\n"+operationID+"\n"+androidID+"\n"+backendID)
}

// ClockSkew is how far a signed timestamp may be from now.
const ClockSkew = 30 * time.Second

// Verifier checks signed control requests and PCM prefaces against every
// paired iPhone, and rejects replayed nonces.
type Verifier struct {
	mu     sync.Mutex
	seen   map[string]time.Time
	lastGC time.Time
}

func NewVerifier() *Verifier { return &Verifier{seen: make(map[string]time.Time)} }

// Match returns the index of the secret that signed canonical, or -1.
func (v *Verifier) Match(secrets [][]byte, signature string, method, pathAndQuery string, body []byte, timestamp int64, nonce string, now time.Time) int {
	if len(nonce) < 7 || len(nonce) > 128 || signature == "" {
		return -1
	}
	at := time.Unix(timestamp, 0)
	if at.Before(now.Add(-ClockSkew)) || at.After(now.Add(ClockSkew)) {
		return -1
	}
	canonical := canonicalRequest(method, pathAndQuery, body, timestamp, nonce)
	match := -1
	for index, secret := range secrets {
		if len(secret) >= 32 && signatureEqual(sign(secret, canonical), signature) {
			match = index
			break
		}
	}
	if match < 0 || !v.accept(nonce, now) {
		return -1
	}
	return match
}

func (v *Verifier) accept(nonce string, now time.Time) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if now.Sub(v.lastGC) > ClockSkew {
		for key, at := range v.seen {
			if now.Sub(at) > 2*ClockSkew {
				delete(v.seen, key)
			}
		}
		v.lastGC = now
	}
	if _, replay := v.seen[nonce]; replay {
		return false
	}
	v.seen[nonce] = now
	return true
}

// PCMPreface is the first line on the PCM port: "AIRSIMVWL1 ts nonce sig\n".
type PCMPreface struct {
	Timestamp int64
	Nonce     string
	Signature string
}

func ParsePCMPreface(line string) (PCMPreface, error) {
	if len(line) > 1024 || !strings.HasSuffix(line, "\n") {
		return PCMPreface{}, errors.New("invalid PCM preface")
	}
	fields := strings.Split(strings.TrimSuffix(line, "\n"), " ")
	if len(fields) != 4 || fields[0] != pcmMagic || len(fields[2]) < 7 || len(fields[2]) > 128 ||
		len(fields[3]) < 40 || len(fields[3]) > 128 {
		return PCMPreface{}, errors.New("invalid PCM preface")
	}
	timestamp, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil {
		return PCMPreface{}, errors.New("invalid PCM timestamp")
	}
	return PCMPreface{Timestamp: timestamp, Nonce: fields[2], Signature: fields[3]}, nil
}

// PCMReady is written back once the preface is accepted.
const PCMReady = pcmReady

// NewAgentID is a stable-looking Android agent identifier.
func NewAgentID() string {
	value := make([]byte, 12)
	_, _ = rand.Read(value)
	return "android-" + hex.EncodeToString(value)
}

// ClientID names a paired iPhone without revealing its secret.
func ClientID(secret []byte) string {
	digest := sha256.Sum256(secret)
	return hex.EncodeToString(digest[:6])
}

func newUUID() string {
	value := make([]byte, 16)
	_, _ = rand.Read(value)
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	text := hex.EncodeToString(value)
	return text[0:8] + "-" + text[8:12] + "-" + text[12:16] + "-" + text[16:20] + "-" + text[20:32]
}
