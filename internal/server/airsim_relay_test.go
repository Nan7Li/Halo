package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"vocat/internal/store"
	"vocat/internal/wireguard"
)

func TestRelayAPISetsUpTunnelAndPeers(t *testing.T) {
	database, err := store.Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	runner := &recordingWGRunner{up: map[string]bool{}}
	manager, err := wireguard.NewWithRunner(database, filepath.Join(t.TempDir(), "wg"), slog.New(slog.NewTextHandler(io.Discard, nil)), runner)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		store:               database,
		logger:              slog.New(slog.NewTextHandler(io.Discard, nil)),
		maxRequestBodyBytes: 1 << 20,
		wireguard:           manager,
	}
	call := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(method, "/api/"+path, strings.NewReader(body))
		if body != "" {
			request.Header.Set("Content-Type", "application/json")
		}
		if !server.routeAirSIMAgentAPI(recorder, request, path) {
			t.Fatalf("%s %s not routed", method, path)
		}
		return recorder
	}
	decode := func(recorder *httptest.ResponseRecorder) relayStatus {
		t.Helper()
		if recorder.Code != http.StatusOK {
			t.Fatalf("status %d: %s", recorder.Code, recorder.Body)
		}
		var payload struct {
			Data relayStatus `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Data
	}

	// The relay works even when the AirSIM agent itself is not running.
	if status := decode(call(http.MethodGet, "airsim-agent/relay", "")); status.Configured {
		t.Fatalf("fresh status configured: %+v", status)
	}
	if recorder := call(http.MethodPut, "airsim-agent/relay", `{"host":"http://x"}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("bad host accepted: %d", recorder.Code)
	}

	status := decode(call(http.MethodPut, "airsim-agent/relay", `{"host":"vps.example.com","port":51888}`))
	if !status.Configured || !status.Running || status.NASAddress != "10.8.0.2" || status.Error != "" {
		t.Fatalf("after setup: %+v", status)
	}
	if !runner.up[wireguard.RelayInterface] {
		t.Fatal("tunnel not brought up")
	}
	relay, _, _ := server.loadRelay(context.Background())
	firstKey := relay.NASPrivateKey

	// Saving again keeps the keys and the tunnel.
	decode(call(http.MethodPut, "airsim-agent/relay", `{"host":"1.2.3.4","port":51888}`))
	relay, _, _ = server.loadRelay(context.Background())
	if relay.NASPrivateKey != firstKey {
		t.Fatal("keys rotated on save")
	}
	snapshot, _ := manager.Snapshot(context.Background())
	if len(snapshot.Tunnels) != 1 {
		t.Fatalf("tunnels = %d", len(snapshot.Tunnels))
	}

	script := call(http.MethodGet, "airsim-agent/relay/script", "")
	if !strings.Contains(script.Body.String(), "ListenPort = 51888") || !strings.Contains(script.Body.String(), "AllowedIPs = 10.8.0.2/32") {
		t.Fatalf("script:\n%s", script.Body)
	}

	status = decode(call(http.MethodPost, "airsim-agent/relay/peers", `{"name":"iPhone"}`))
	if len(status.Peers) != 1 || status.Peers[0].Address != "10.8.0.3" {
		t.Fatalf("peers: %+v", status.Peers)
	}
	peer := call(http.MethodGet, "airsim-agent/relay/peers/"+status.Peers[0].ID+"/config", "")
	if !strings.Contains(peer.Body.String(), "Address = 10.8.0.3/32") || !strings.Contains(peer.Body.String(), "Endpoint = 1.2.3.4:51888") {
		t.Fatalf("peer config:\n%s", peer.Body)
	}
	script = call(http.MethodGet, "airsim-agent/relay/script", "")
	if !strings.Contains(script.Body.String(), "AllowedIPs = 10.8.0.3/32") {
		t.Fatal("new peer missing from VPS script")
	}
	if recorder := call(http.MethodPut, "airsim-agent/relay", `{"host":"1.2.3.4","subnet":"10.9.0.0/24"}`); recorder.Code != http.StatusConflict {
		t.Fatalf("subnet change with peers: %d", recorder.Code)
	}

	status = decode(call(http.MethodDelete, "airsim-agent/relay/peers/"+status.Peers[0].ID, ""))
	if len(status.Peers) != 0 {
		t.Fatal("peer not removed")
	}
	status = decode(call(http.MethodDelete, "airsim-agent/relay", ""))
	if status.Configured || runner.up[wireguard.RelayInterface] {
		t.Fatalf("relay not torn down: %+v", status)
	}
}
