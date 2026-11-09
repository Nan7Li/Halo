package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"vocat/internal/store"
	"vocat/internal/wireguard"
)

// VPS relay for reaching Halo without a public IP: Halo keeps a WireGuard
// tunnel open to a VPS, and the iPhone reaches Halo's tunnel address through
// the VPS (a proxy node on the VPS, or a WireGuard peer).
//
//	GET     /api/airsim-agent/relay                    status
//	PUT     /api/airsim-agent/relay                    {host, port, subnet}: save, start the tunnel
//	DELETE  /api/airsim-agent/relay                    stop and forget
//	GET     /api/airsim-agent/relay/script             VPS setup script (text)
//	POST    /api/airsim-agent/relay/peers              {name}: add a device
//	GET     /api/airsim-agent/relay/peers/{id}/config  device WireGuard file (text)
//	DELETE  /api/airsim-agent/relay/peers/{id}

const airsimRelayKey = "airsim.relay"

var relayMu sync.Mutex

type relayPeerStatus struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Address   string `json:"address"`
	CreatedAt string `json:"created_at"`
}

type relayStatus struct {
	Configured      bool              `json:"configured"`
	Available       bool              `json:"available"`
	Host            string            `json:"host,omitempty"`
	Port            int               `json:"port"`
	Subnet          string            `json:"subnet"`
	NASAddress      string            `json:"nas_address,omitempty"`
	VPSAddress      string            `json:"vps_address,omitempty"`
	VPSPublicKey    string            `json:"vps_public_key,omitempty"`
	Running         bool              `json:"running"`
	Connected       bool              `json:"connected"`
	LatestHandshake string            `json:"latest_handshake,omitempty"`
	TransferRX      int64             `json:"transfer_rx"`
	TransferTX      int64             `json:"transfer_tx"`
	Error           string            `json:"error,omitempty"`
	Peers           []relayPeerStatus `json:"peers"`
}

func (s *Server) loadRelay(ctx context.Context) (wireguard.Relay, bool, error) {
	setting, err := s.store.AppSetting(ctx, airsimRelayKey)
	if errors.Is(err, store.ErrNotFound) {
		return wireguard.Relay{}, false, nil
	}
	if err != nil {
		return wireguard.Relay{}, false, err
	}
	var relay wireguard.Relay
	if err := json.Unmarshal(setting.Value, &relay); err != nil {
		return wireguard.Relay{}, false, err
	}
	return relay, relay.Host != "", nil
}

func (s *Server) saveRelay(ctx context.Context, relay wireguard.Relay) error {
	value, err := json.Marshal(relay)
	if err != nil {
		return err
	}
	return s.store.UpsertAppSetting(ctx, store.AppSetting{Key: airsimRelayKey, Value: value, Sensitive: true})
}

func (s *Server) relayStatus(ctx context.Context) relayStatus {
	out := relayStatus{Port: wireguard.RelayDefaultPort, Subnet: wireguard.RelayDefaultNet, Peers: []relayPeerStatus{}}
	if s.wireguard != nil {
		out.Available = s.wireguard.Available()
	}
	relay, ok, err := s.loadRelay(ctx)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	if !ok {
		return out
	}
	out.Configured = true
	out.Host = relay.Host
	out.Port = relay.Port
	out.Subnet = relay.Subnet
	out.NASAddress = relay.NASAddress().String()
	out.VPSAddress = relay.VPSAddress().String()
	out.VPSPublicKey = relay.VPSPublicKey()
	for _, peer := range relay.Peers {
		out.Peers = append(out.Peers, relayPeerStatus{ID: peer.ID, Name: peer.Name, Address: peer.Address, CreatedAt: peer.CreatedAt})
	}
	if s.wireguard == nil || relay.TunnelID == "" {
		return out
	}
	tunnel, err := s.wireguard.Get(ctx, relay.TunnelID)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	out.Running = tunnel.Running
	out.LatestHandshake = tunnel.LatestHandshake
	out.TransferRX = tunnel.TransferRX
	out.TransferTX = tunnel.TransferTX
	if tunnel.Error != "" {
		out.Error = tunnel.Error
	}
	// WireGuard re-handshakes every two minutes while traffic flows; the
	// keepalive guarantees traffic.
	if at, err := time.Parse(time.RFC3339, tunnel.LatestHandshake); err == nil && time.Since(at) < 3*time.Minute {
		out.Connected = tunnel.Running
	}
	return out
}

// applyRelay writes Halo's side of the tunnel and starts it.
func (s *Server) applyRelay(ctx context.Context, relay *wireguard.Relay) error {
	if s.wireguard == nil {
		return errors.New("WireGuard support is not configured")
	}
	request := wireguard.SaveRequest{
		Name:      "VPS 中继",
		Interface: wireguard.RelayInterface,
		Config:    relay.NASConfig(),
		Autostart: true,
	}
	var tunnelID string
	if relay.TunnelID != "" {
		updated, err := s.wireguard.Update(ctx, relay.TunnelID, request)
		if err == nil {
			tunnelID = updated.ID
		} else if !errors.Is(err, wireguard.ErrNotFound) {
			return err
		}
	}
	if tunnelID == "" {
		created, err := s.wireguard.Create(ctx, request)
		if err != nil {
			return err
		}
		tunnelID = created.ID
	}
	relay.TunnelID = tunnelID
	if !s.wireguard.Available() {
		return nil
	}
	_, err := s.wireguard.Up(ctx, tunnelID)
	return err
}

func (s *Server) routeRelayAPI(w http.ResponseWriter, r *http.Request, tail string) {
	ctx := r.Context()
	respond := func(extra string) {
		status := s.relayStatus(ctx)
		if extra != "" && status.Error == "" {
			status.Error = extra
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": status})
	}
	relayMu.Lock()
	defer relayMu.Unlock()
	switch {
	case tail == "":
		switch r.Method {
		case http.MethodGet:
			respond("")
		case http.MethodPut:
			s.updateRelay(w, r, respond)
		case http.MethodDelete:
			relay, ok, err := s.loadRelay(ctx)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "load_failed", err.Error())
				return
			}
			if ok && relay.TunnelID != "" && s.wireguard != nil {
				if err := s.wireguard.Delete(ctx, relay.TunnelID); err != nil && !errors.Is(err, wireguard.ErrNotFound) {
					writeError(w, http.StatusBadGateway, "wireguard_error", err.Error())
					return
				}
			}
			if err := s.store.DeleteAppSetting(ctx, airsimRelayKey); err != nil && !errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusInternalServerError, "save_failed", err.Error())
				return
			}
			s.recordAudit(ctx, "admin", "airsim_relay.delete", "airsim", "relay", "success", "")
			respond("")
		default:
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		}
	case tail == "script":
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		relay, ok, err := s.loadRelay(ctx)
		if err != nil || !ok {
			writeError(w, http.StatusNotFound, "relay_not_configured", "还没有设置 VPS")
			return
		}
		writeText(w, relay.VPSScript())
	case tail == "peers":
		if !requireMethod(w, r, http.MethodPost) {
			return
		}
		var request struct {
			Name string `json:"name"`
		}
		if err := s.decodeJSON(w, r, &request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		relay, ok, err := s.loadRelay(ctx)
		if err != nil || !ok {
			writeError(w, http.StatusConflict, "relay_not_configured", "先设置 VPS")
			return
		}
		address, err := relay.NextPeerAddress()
		if err != nil {
			writeError(w, http.StatusConflict, "relay_full", err.Error())
			return
		}
		private, _, err := wireguard.GenerateKey()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "keygen_failed", err.Error())
			return
		}
		name := strings.TrimSpace(request.Name)
		if name == "" {
			name = "iPhone"
		}
		if len([]rune(name)) > 40 {
			name = string([]rune(name)[:40])
		}
		relay.Peers = append(relay.Peers, wireguard.RelayPeer{
			ID:         newRelayPeerID(),
			Name:       name,
			PrivateKey: private,
			Address:    address.String(),
			CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		})
		if err := s.saveRelay(ctx, relay); err != nil {
			writeError(w, http.StatusInternalServerError, "save_failed", err.Error())
			return
		}
		s.recordAudit(ctx, "admin", "airsim_relay.peer_add", "airsim", address.String(), "success", name)
		respond("")
	case strings.HasPrefix(tail, "peers/"):
		parts := strings.Split(strings.TrimPrefix(tail, "peers/"), "/")
		relay, ok, err := s.loadRelay(ctx)
		if err != nil || !ok {
			writeError(w, http.StatusNotFound, "relay_not_configured", "还没有设置 VPS")
			return
		}
		index := -1
		for i, peer := range relay.Peers {
			if peer.ID == parts[0] {
				index = i
			}
		}
		if index < 0 {
			writeError(w, http.StatusNotFound, "peer_not_found", "找不到这台设备")
			return
		}
		switch {
		case len(parts) == 2 && parts[1] == "config" && r.Method == http.MethodGet:
			writeText(w, relay.PeerConfig(relay.Peers[index]))
		case len(parts) == 1 && r.Method == http.MethodDelete:
			removed := relay.Peers[index]
			relay.Peers = append(relay.Peers[:index], relay.Peers[index+1:]...)
			if err := s.saveRelay(ctx, relay); err != nil {
				writeError(w, http.StatusInternalServerError, "save_failed", err.Error())
				return
			}
			s.recordAudit(ctx, "admin", "airsim_relay.peer_remove", "airsim", removed.Address, "success", removed.Name)
			respond("")
		default:
			writeError(w, http.StatusNotFound, "not_found", "endpoint not found")
		}
	default:
		writeError(w, http.StatusNotFound, "not_found", "endpoint not found")
	}
}

func (s *Server) updateRelay(w http.ResponseWriter, r *http.Request, respond func(string)) {
	ctx := r.Context()
	var request struct {
		Host   string `json:"host"`
		Port   int    `json:"port"`
		Subnet string `json:"subnet"`
	}
	if err := s.decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	host, err := wireguard.NormalizeRelayHost(request.Host)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_host", err.Error())
		return
	}
	if request.Port == 0 {
		request.Port = wireguard.RelayDefaultPort
	}
	if request.Port < 1 || request.Port > 65535 {
		writeError(w, http.StatusBadRequest, "invalid_port", "端口需在 1–65535 之间")
		return
	}
	if strings.TrimSpace(request.Subnet) == "" {
		request.Subnet = wireguard.RelayDefaultNet
	}
	subnet, err := wireguard.ParseRelaySubnet(request.Subnet)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_subnet", err.Error())
		return
	}
	relay, _, err := s.loadRelay(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "load_failed", err.Error())
		return
	}
	if relay.Subnet != "" && relay.Subnet != subnet.String() && len(relay.Peers) > 0 {
		writeError(w, http.StatusConflict, "subnet_in_use", "已添加的设备使用旧网段，先删除它们再改网段")
		return
	}
	relay.Host, relay.Port, relay.Subnet = host, request.Port, subnet.String()
	for _, key := range []*string{&relay.VPSPrivateKey, &relay.NASPrivateKey} {
		if *key == "" {
			if *key, _, err = wireguard.GenerateKey(); err != nil {
				writeError(w, http.StatusInternalServerError, "keygen_failed", err.Error())
				return
			}
		}
	}
	applyErr := s.applyRelay(ctx, &relay)
	if err := s.saveRelay(ctx, relay); err != nil {
		writeError(w, http.StatusInternalServerError, "save_failed", err.Error())
		return
	}
	extra := ""
	result := "success"
	if applyErr != nil {
		extra = applyErr.Error()
		result = "failure"
	}
	s.recordAudit(ctx, "admin", "airsim_relay.update", "airsim", host, result, extra)
	respond(extra)
}

func newRelayPeerID() string {
	value := make([]byte, 6)
	_, _ = rand.Read(value)
	return hex.EncodeToString(value)
}

func writeText(w http.ResponseWriter, text string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(text))
}
