package wireguard

// A VPS relay: Halo and remote devices all dial out to one WireGuard hub on
// a VPS, so Halo is reachable without a public IP at home. The VPS takes the
// first address of the subnet, Halo the second, extra peers (an iPhone in
// the WireGuard app or a proxy client's WireGuard node) the rest.

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/netip"
	"regexp"
	"strconv"
	"strings"
)

// RelayInterface is the interface name on both ends.
const (
	RelayInterface    = "halovps"
	RelayVPSInterface = "halo"
	RelayDefaultPort  = 51820
	RelayDefaultNet   = "10.8.0.0/24"
	relayMTU          = 1280
	relayKeepalive    = 25
	relayMaxPeers     = 200
)

var relayHostPattern = regexp.MustCompile(`^[A-Za-z0-9.-]{1,253}$`)

// RelayPeer is one remote device behind the VPS.
type RelayPeer struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	PrivateKey string `json:"private_key"`
	Address    string `json:"address"`
	CreatedAt  string `json:"created_at"`
}

// Relay is the whole hub configuration. It holds every private key so Halo
// can hand out the VPS script and peer files; it is stored as a sensitive
// setting.
type Relay struct {
	Host          string      `json:"host"`
	Port          int         `json:"port"`
	Subnet        string      `json:"subnet"`
	VPSPrivateKey string      `json:"vps_private_key"`
	NASPrivateKey string      `json:"nas_private_key"`
	Peers         []RelayPeer `json:"peers,omitempty"`
	TunnelID      string      `json:"tunnel_id,omitempty"`
}

// GenerateKey returns a WireGuard private key and its public key.
func GenerateKey() (private, public string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	raw[0] &= 248
	raw[31] = raw[31]&127 | 64
	private = base64.StdEncoding.EncodeToString(raw)
	public, err = PublicKey(private)
	return private, public, err
}

// PublicKey derives the public key of a base64 WireGuard private key.
func PublicKey(private string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(private))
	if err != nil || len(raw) != 32 {
		return "", errors.New("invalid WireGuard private key")
	}
	key, err := ecdh.X25519().NewPrivateKey(raw)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(key.PublicKey().Bytes()), nil
}

// NormalizeRelayHost checks a VPS address: a hostname, IPv4 or IPv6
// literal, without port or scheme.
func NormalizeRelayHost(host string) (string, error) {
	host = strings.TrimSpace(host)
	host = strings.TrimPrefix(strings.TrimSuffix(host, "]"), "[")
	if host == "" {
		return "", errors.New("请填写 VPS 的 IP 或域名")
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr.String(), nil
	}
	if !relayHostPattern.MatchString(host) || strings.HasPrefix(host, "-") || strings.HasPrefix(host, ".") {
		return "", fmt.Errorf("VPS 地址 %q 无效：只填 IP 或域名，不要带端口和 http://", host)
	}
	return strings.ToLower(host), nil
}

// ParseRelaySubnet accepts a private IPv4 /24.
func ParseRelaySubnet(text string) (netip.Prefix, error) {
	prefix, err := netip.ParsePrefix(strings.TrimSpace(text))
	if err != nil || !prefix.Addr().Is4() || prefix.Bits() != 24 {
		return netip.Prefix{}, errors.New("隧道网段需要是 /24 的 IPv4 网段，例如 10.8.0.0/24")
	}
	prefix = prefix.Masked()
	cgnat := netip.MustParsePrefix("100.64.0.0/10")
	if !prefix.Addr().IsPrivate() && !cgnat.Contains(prefix.Addr()) {
		return netip.Prefix{}, errors.New("隧道网段需要是私网网段（10.x、172.16–31.x、192.168.x 或 100.64–127.x）")
	}
	return prefix, nil
}

func (r Relay) prefix() netip.Prefix {
	prefix, err := ParseRelaySubnet(r.Subnet)
	if err != nil {
		return netip.MustParsePrefix(RelayDefaultNet)
	}
	return prefix
}

func (r Relay) host(index int) netip.Addr {
	octets := r.prefix().Addr().As4()
	octets[3] = byte(index)
	return netip.AddrFrom4(octets)
}

// VPSAddress and NASAddress are the hub's and Halo's tunnel addresses.
func (r Relay) VPSAddress() netip.Addr { return r.host(1) }
func (r Relay) NASAddress() netip.Addr { return r.host(2) }

// NextPeerAddress is the lowest free address from .3 upwards.
func (r Relay) NextPeerAddress() (netip.Addr, error) {
	used := map[string]bool{}
	for _, peer := range r.Peers {
		used[peer.Address] = true
	}
	for index := 3; index < 3+relayMaxPeers && index < 255; index++ {
		candidate := r.host(index)
		if !used[candidate.String()] {
			return candidate, nil
		}
	}
	return netip.Addr{}, errors.New("隧道网段里已经没有空余地址")
}

// Endpoint is host:port, with brackets for IPv6.
func (r Relay) Endpoint() string {
	port := r.Port
	if port == 0 {
		port = RelayDefaultPort
	}
	host := r.Host
	if addr, err := netip.ParseAddr(host); err == nil && addr.Is6() {
		host = "[" + host + "]"
	}
	return host + ":" + strconv.Itoa(port)
}

func mustPublic(private string) string {
	public, err := PublicKey(private)
	if err != nil {
		return ""
	}
	return public
}

// VPSPublicKey is shown so a proxy client's WireGuard node can be filled by hand.
func (r Relay) VPSPublicKey() string { return mustPublic(r.VPSPrivateKey) }

// NASConfig is Halo's side: a client that keeps the hole to the VPS open.
func (r Relay) NASConfig() string {
	return fmt.Sprintf(`[Interface]
PrivateKey = %s
Address = %s/32
MTU = %d

[Peer]
PublicKey = %s
Endpoint = %s
AllowedIPs = %s
PersistentKeepalive = %d
`, r.NASPrivateKey, r.NASAddress(), relayMTU, r.VPSPublicKey(), r.Endpoint(), r.prefix(), relayKeepalive)
}

// PeerConfig is a remote device's file, for the WireGuard app or a proxy
// client's WireGuard node. Only the tunnel subnet is routed through it.
func (r Relay) PeerConfig(peer RelayPeer) string {
	return fmt.Sprintf(`[Interface]
PrivateKey = %s
Address = %s/32
MTU = %d

[Peer]
PublicKey = %s
Endpoint = %s
AllowedIPs = %s
PersistentKeepalive = %d
`, peer.PrivateKey, peer.Address, relayMTU, r.VPSPublicKey(), r.Endpoint(), r.prefix(), relayKeepalive)
}

// VPSConfig is the hub. Forwarding between peers on the one interface lets
// an iPhone reach Halo; a proxy server on the VPS reaches Halo directly.
func (r Relay) VPSConfig() string {
	var builder strings.Builder
	fmt.Fprintf(&builder, `[Interface]
PrivateKey = %s
Address = %s/24
ListenPort = %d
MTU = %d
PostUp = sysctl -qw net.ipv4.ip_forward=1; iptables -I FORWARD -i %%i -o %%i -j ACCEPT || true
PostDown = iptables -D FORWARD -i %%i -o %%i -j ACCEPT || true

[Peer]
# Halo
PublicKey = %s
AllowedIPs = %s/32
`, r.VPSPrivateKey, r.VPSAddress(), r.portOrDefault(), relayMTU, mustPublic(r.NASPrivateKey), r.NASAddress())
	for _, peer := range r.Peers {
		fmt.Fprintf(&builder, "\n[Peer]\n# %s\nPublicKey = %s\nAllowedIPs = %s/32\n",
			sanitizeComment(peer.Name), mustPublic(peer.PrivateKey), peer.Address)
	}
	return builder.String()
}

func (r Relay) portOrDefault() int {
	if r.Port == 0 {
		return RelayDefaultPort
	}
	return r.Port
}

func sanitizeComment(text string) string {
	text = strings.Map(func(char rune) rune {
		if char < 0x20 || char == 0x7f || char == '[' || char == ']' {
			return -1
		}
		return char
	}, text)
	if text == "" {
		return "peer"
	}
	return text
}

// VPSScript installs WireGuard on the VPS and writes the hub. It is
// idempotent: run it again after adding or removing a device.
func (r Relay) VPSScript() string {
	port := strconv.Itoa(r.portOrDefault())
	iface := RelayVPSInterface
	return `#!/bin/bash
# Halo VPS relay. Run as root on the VPS; safe to run again.
set -e
[ "$(id -u)" = 0 ] || { echo "请用 root 运行（sudo bash）"; exit 1; }
if ! command -v wg >/dev/null 2>&1 || ! command -v wg-quick >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wireguard-tools iptables
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q wireguard-tools iptables
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q epel-release >/dev/null 2>&1 || true
    yum install -y -q wireguard-tools iptables
  elif command -v apk >/dev/null 2>&1; then
    apk add -q wireguard-tools iptables
  else
    echo "找不到包管理器，请先手动安装 wireguard-tools"; exit 1
  fi
fi
umask 077
mkdir -p /etc/wireguard
cat > /etc/wireguard/` + iface + `.conf <<'HALO_RELAY_EOF'
` + r.VPSConfig() + `HALO_RELAY_EOF
echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-halo-relay.conf
sysctl -q -p /etc/sysctl.d/99-halo-relay.conf || true
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow ` + port + `/udp >/dev/null
fi
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd -q --permanent --add-port=` + port + `/udp && firewall-cmd -q --reload
fi
if ip link show ` + iface + ` >/dev/null 2>&1; then
  wg syncconf ` + iface + ` <(wg-quick strip ` + iface + `)
elif command -v systemctl >/dev/null 2>&1; then
  systemctl enable -q wg-quick@` + iface + `
  systemctl restart wg-quick@` + iface + `
else
  wg-quick up ` + iface + `
fi
wg show ` + iface + `
echo
echo "完成。请确认云服务商的安全组/防火墙已放行 UDP ` + port + `。"
`
}
