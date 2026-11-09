package wireguard

import (
	"strings"
	"testing"
)

func testRelay(t *testing.T) Relay {
	t.Helper()
	vps, _, err := GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	nas, _, err := GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	return Relay{Host: "vps.example.com", Port: 51820, Subnet: "10.8.0.0/24", VPSPrivateKey: vps, NASPrivateKey: nas}
}

func TestGenerateKeyMatchesKnownVector(t *testing.T) {
	// RFC 7748 §6.1 Alice.
	public, err := PublicKey("dwdtCnMYpX08FsFyUbJmRd9ML4frwJkqsXf7pR25LCo=")
	if err != nil {
		t.Fatal(err)
	}
	if public != "hSDwCYkwp1R0i33ctD73Wg2/Og0mOBr066SpjqqbTmo=" {
		t.Fatalf("public key = %s", public)
	}
}

func TestRelayAddressesAndConfigs(t *testing.T) {
	relay := testRelay(t)
	if relay.VPSAddress().String() != "10.8.0.1" || relay.NASAddress().String() != "10.8.0.2" {
		t.Fatalf("addresses %s %s", relay.VPSAddress(), relay.NASAddress())
	}
	next, err := relay.NextPeerAddress()
	if err != nil || next.String() != "10.8.0.3" {
		t.Fatalf("next = %s %v", next, err)
	}
	peerKey, _, _ := GenerateKey()
	relay.Peers = []RelayPeer{{ID: "a", Name: "iPhone\n[Peer]", PrivateKey: peerKey, Address: "10.8.0.3"}}
	if next, _ := relay.NextPeerAddress(); next.String() != "10.8.0.4" {
		t.Fatalf("next after one peer = %s", next)
	}

	nas := relay.NASConfig()
	parsed, err := parseConfig(nas)
	if err != nil {
		t.Fatalf("NAS config does not parse: %v\n%s", err, nas)
	}
	if parsed.Peers[0].Endpoint != "vps.example.com:51820" || parsed.Peers[0].AllowedIPs[0] != "10.8.0.0/24" {
		t.Fatalf("NAS peer = %+v", parsed.Peers[0])
	}
	if _, err := parseConfig(relay.PeerConfig(relay.Peers[0])); err != nil {
		t.Fatalf("peer config does not parse: %v", err)
	}

	vps := relay.VPSConfig()
	if !strings.Contains(vps, "AllowedIPs = 10.8.0.2/32") || !strings.Contains(vps, "AllowedIPs = 10.8.0.3/32") {
		t.Fatalf("VPS config misses peers:\n%s", vps)
	}
	if strings.Count(vps, "[Peer]") != 2 {
		t.Fatalf("a peer name injected a section:\n%s", vps)
	}
	if !strings.Contains(vps, "-i %i -o %i") {
		t.Fatalf("PostUp placeholders not kept:\n%s", vps)
	}
	script := relay.VPSScript()
	if !strings.Contains(script, "<<'HALO_RELAY_EOF'\n[Interface]") || !strings.Contains(script, "\nHALO_RELAY_EOF\n") {
		t.Fatalf("heredoc malformed:\n%s", script)
	}
}

func TestRelayIPv6Endpoint(t *testing.T) {
	host, err := NormalizeRelayHost("[2001:db8::1]")
	if err != nil {
		t.Fatal(err)
	}
	relay := Relay{Host: host, Port: 443}
	if relay.Endpoint() != "[2001:db8::1]:443" {
		t.Fatalf("endpoint = %s", relay.Endpoint())
	}
}

func TestRelayValidation(t *testing.T) {
	for _, bad := range []string{"", "http://x.com", "x.com:51820", "a b", "-x.com"} {
		if _, err := NormalizeRelayHost(bad); err == nil {
			t.Errorf("host %q accepted", bad)
		}
	}
	for _, bad := range []string{"8.8.8.0/24", "10.8.0.0/16", "fd00::/64", "x"} {
		if _, err := ParseRelaySubnet(bad); err == nil {
			t.Errorf("subnet %q accepted", bad)
		}
	}
	if prefix, err := ParseRelaySubnet("10.9.0.7/24"); err != nil || prefix.String() != "10.9.0.0/24" {
		t.Fatalf("subnet = %s %v", prefix, err)
	}
}
