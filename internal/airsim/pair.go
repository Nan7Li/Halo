package airsim

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"
)

// Pairing is what Halo keeps after pairing with a phone: where its VoWLAN
// gateways listen, who it is, and the secret that signs every request.
type Pairing struct {
	Host         string    `json:"host"`
	ControlPort  int       `json:"control_port"`
	PCMPort      int       `json:"pcm_port"`
	AgentID      string    `json:"agent_id"`
	DeviceName   string    `json:"device_name,omitempty"`
	Manufacturer string    `json:"manufacturer,omitempty"`
	Model        string    `json:"model,omitempty"`
	Secret       string    `json:"secret"`
	PairedAt     time.Time `json:"paired_at"`
}

func (p Pairing) secret() ([]byte, error) {
	value, err := b64.DecodeString(p.Secret)
	if err != nil || len(value) < 32 {
		return nil, errors.New("AirSIM pairing secret is invalid")
	}
	return value, nil
}

func (p Pairing) valid() bool {
	_, err := p.secret()
	return err == nil && p.AgentID != "" && validPort(p.ControlPort) && validPort(p.PCMPort) &&
		ValidateHost(p.Host) == nil
}

// loopbackAllowed lets tests stand a fake phone on 127.0.0.1.
var loopbackAllowed bool

func validPort(port int) bool { return port >= 1024 && port <= 65535 }

// ValidateHost accepts what the phone's gateways accept from Halo: a private,
// link-local or Tailscale (100.64/10) IPv4 address. AirSIM refuses public
// peers and host names on its plain-TCP gateways.
func ValidateHost(host string) error {
	address, err := netip.ParseAddr(strings.TrimSpace(host))
	if err == nil && loopbackAllowed && address.IsLoopback() {
		return nil
	}
	if err != nil || !address.Is4() {
		return errors.New("请填写安卓手机的 IPv4 地址，例如 192.168.1.50")
	}
	tailscale := netip.MustParsePrefix("100.64.0.0/10")
	if !address.IsPrivate() && !address.IsLinkLocalUnicast() && !tailscale.Contains(address) {
		return errors.New("只能填写局域网或 Tailscale 地址，AirSIM 不接受公网地址")
	}
	return nil
}

type pairInfo struct {
	Product         string `json:"product"`
	Version         int    `json:"version"`
	SessionID       string `json:"session_id"`
	ServerPublicKey string `json:"server_public_key"`
	ExpiresAt       int64  `json:"expires_at"`
}

type pairResponse struct {
	AgentID     string `json:"agent_id"`
	ControlPort int    `json:"control_port"`
	PCMPort     int    `json:"pcm_port"`
	RouteProof  string `json:"route_proof"`
	Error       string `json:"error"`
}

// Pair claims the phone's open two-minute pairing window at host:port with
// its six-digit code. Halo registers in AirSIM's local mode: no Relay, no
// push tokens, only a fresh VoWLAN secret. The phone answers with the live
// ports of its control and PCM gateways, signed with that secret.
func Pair(ctx context.Context, host string, port int, code string) (Pairing, error) {
	host = strings.TrimSpace(host)
	code = strings.TrimSpace(code)
	if err := ValidateHost(host); err != nil {
		return Pairing{}, err
	}
	if port < 1 || port > 65535 {
		return Pairing{}, errors.New("配对端口无效")
	}
	if !validCode(code) {
		return Pairing{}, errors.New("配对码应为 6 位数字")
	}
	base := "http://" + net.JoinHostPort(host, strconv.Itoa(port))
	client := &http.Client{Timeout: 25 * time.Second}

	var info pairInfo
	if status, err := pairRequest(ctx, client, http.MethodGet, base+"/pair/v1/info", nil, &info); err != nil {
		return Pairing{}, fmt.Errorf("连不上安卓的配对窗口：%w", err)
	} else if status == http.StatusGone {
		return Pairing{}, errors.New("安卓的配对窗口已过期，请重新打开")
	} else if status != http.StatusOK || info.Product != "airsim-pair" || info.Version != 1 || info.SessionID == "" {
		return Pairing{}, errors.New("这个地址不是 AirSIM 的配对窗口")
	}
	serverKeyBytes, err := b64.DecodeString(info.ServerPublicKey)
	if err != nil {
		return Pairing{}, errors.New("安卓返回的配对公钥无效")
	}
	serverKey, err := ecdh.X25519().NewPublicKey(serverKeyBytes)
	if err != nil {
		return Pairing{}, errors.New("安卓返回的配对公钥无效")
	}
	clientKey, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return Pairing{}, err
	}
	shared, err := clientKey.ECDH(serverKey)
	if err != nil {
		return Pairing{}, errors.New("安卓返回的配对公钥无效")
	}
	key, err := pairingKey(shared, info.SessionID, code)
	if err != nil {
		return Pairing{}, err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return Pairing{}, err
	}
	registration, _ := json.Marshal(map[string]any{
		"cloud_enabled": false,
		"local_mode":    true,
		"vowlan_secret": b64.EncodeToString(secret),
	})
	sealed, err := seal(registration, key, info.SessionID)
	if err != nil {
		return Pairing{}, err
	}
	clientKeyText := b64.EncodeToString(clientKey.PublicKey().Bytes())
	claim, _ := json.Marshal(map[string]any{
		"version":             1,
		"session_id":          info.SessionID,
		"client_public_key":   clientKeyText,
		"sealed_registration": b64.EncodeToString(sealed),
		"want_direct_route":   true,
	})
	var response pairResponse
	status, err := pairRequest(ctx, client, http.MethodPost, base+"/pair/v1/claim", claim, &response)
	if err != nil {
		return Pairing{}, fmt.Errorf("配对请求失败：%w", err)
	}
	switch status {
	case http.StatusOK:
	case http.StatusUnauthorized:
		return Pairing{}, errors.New("配对码不对，请核对安卓上显示的 6 位数字")
	case http.StatusForbidden:
		return Pairing{}, errors.New("安卓拒绝了这台 NAS 的网络来源，需要在同一局域网或 Tailscale 内")
	case http.StatusGone:
		return Pairing{}, errors.New("安卓的配对窗口已过期，请重新打开")
	default:
		return Pairing{}, fmt.Errorf("安卓拒绝配对（HTTP %d %s）", status, response.Error)
	}
	if response.AgentID == "" {
		return Pairing{}, errors.New("安卓没有返回设备身份")
	}
	if response.ControlPort == 0 || response.RouteProof == "" {
		return Pairing{}, errors.New("密钥已保存，但安卓的直连网关还没就绪。请确认 AirSIM 是默认电话应用、Shizuku 通话音频桥已启动，再重新打开配对窗口")
	}
	if !validPort(response.ControlPort) || !validPort(response.PCMPort) {
		return Pairing{}, errors.New("安卓返回的网关端口无效")
	}
	expected := routeProof(secret, info.SessionID, clientKeyText, response.AgentID, response.ControlPort, response.PCMPort)
	if !signatureEqual(expected, response.RouteProof) {
		return Pairing{}, errors.New("安卓返回的网关端口签名不符，已放弃这次配对")
	}
	return Pairing{
		Host:        host,
		ControlPort: response.ControlPort,
		PCMPort:     response.PCMPort,
		AgentID:     response.AgentID,
		Secret:      b64.EncodeToString(secret),
		PairedAt:    time.Now().UTC(),
	}, nil
}

func pairRequest(ctx context.Context, client *http.Client, method, url string, body []byte, out any) (int, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return 0, err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return response.StatusCode, err
	}
	if len(payload) > 0 && out != nil {
		_ = json.Unmarshal(payload, out)
	}
	return response.StatusCode, nil
}

// AllowLoopbackForTests lets another package's tests pair with an agent on
// 127.0.0.1. Production code never calls it.
func AllowLoopbackForTests(allowed bool) { loopbackAllowed = allowed }
