// Package airsim lets Halo drive an Android phone running the AirSIM
// Standalone APK (github.com/kai-wu-cortex/AirSIM) as a cellular terminal.
//
// Halo takes the place of AirSIM's iPhone client on the local network: it
// pairs once with the phone's six-digit code (manual IP pairing, local mode,
// no Relay), then signs every control request with the VoWLAN secret it
// generated during pairing, and streams 8 kHz mono PCM16LE call audio over
// the authenticated VoWLAN PCM gateway.
//
// The wire formats here mirror AirSIM's Android sources:
// PairingCrypto, PairingServer, VoWLANAuth, VoWLANControlGateway,
// VoWLANPCMProtocol and DirectGatewayRoutes. AirSIM is licensed under the
// PolyForm Noncommercial License 1.0.0; see LICENSES/airsim-PolyForm-Noncommercial-1.0.0.txt.
package airsim

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strconv"
)

const (
	protocolVersion = "1"
	pairInfoPrefix  = "AirSIMPair/v1:"
	pcmMagic        = "AIRSIMVWL1"
	pcmReady        = "AIRSIMREADY"

	// SampleRate is the call audio rate on the AirSIM PCM gateway.
	SampleRate = 8000
	// FrameSamples is one 20 ms frame: AirSIM relays 320-byte frames.
	FrameSamples = 160
)

var b64 = base64.RawURLEncoding

// canonicalRequest is VoWLANAuth.canonicalRequest: the signed string of a
// control request or PCM preface.
func canonicalRequest(method, pathAndQuery string, body []byte, timestamp int64, nonce string) string {
	digest := sha256.Sum256(body)
	return method + "\n" + pathAndQuery + "\n" + hex.EncodeToString(digest[:]) + "\n" +
		strconv.FormatInt(timestamp, 10) + "\n" + nonce
}

// sign is VoWLANAuth.sign: unpadded base64url HMAC-SHA256.
func sign(secret []byte, canonical string) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(canonical))
	return b64.EncodeToString(mac.Sum(nil))
}

func signatureEqual(a, b string) bool {
	return hmac.Equal([]byte(a), []byte(b))
}

// healthProof is DirectGatewayRoutes.healthProof: the phone proves it holds
// this pairing's secret and is the paired agent.
func healthProof(secret []byte, nonce, agentID string) string {
	return sign(secret, "AIRSIM-HEALTH1\n"+nonce+"\n"+agentID)
}

// routeProof is DirectGatewayRoutes.proof: binds the ports returned by a
// manual pairing claim to this session and this client key.
func routeProof(secret []byte, session, clientKey, agentID string, controlPort, pcmPort int) string {
	return sign(secret, "AIRSIM-DIRECT1\n"+session+"\n"+clientKey+"\n"+agentID+"\n"+
		strconv.Itoa(controlPort)+"\n"+strconv.Itoa(pcmPort))
}

// pairingKey is PairingCrypto.deriveKey: HKDF-SHA256 over the X25519 shared
// secret, salted with the session and bound to the six-digit code.
func pairingKey(shared []byte, session, code string) ([]byte, error) {
	if len(shared) != 32 || session == "" || !validCode(code) {
		return nil, errors.New("invalid pairing key inputs")
	}
	return hkdf.Key(sha256.New, shared, []byte(session), pairInfoPrefix+code, 32)
}

// seal is PairingCrypto.seal: nonce(12) || AES-256-GCM(plaintext), with the
// session ID as additional data.
func seal(plaintext, key []byte, aad string) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, []byte(aad)), nil
}

func validCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	for _, r := range code {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// newNonce is a fresh replay-cache nonce (22 characters; AirSIM accepts 7–128).
func newNonce() string {
	value := make([]byte, 16)
	_, _ = rand.Read(value)
	return b64.EncodeToString(value)
}
