package server

import (
	"context"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

// Admin API for Halo-as-AirSIM-agent: /api/airsim-agent.
//
//	GET     status, ports, paired iPhones, the open pairing window
//	PUT     {enabled, name, pair_port, control_port, pcm_port, device_ids, tls_cert, tls_key, cloud}
//	POST    /pair                 open a two-minute pairing window
//	DELETE  /clients/{id}          forget one iPhone
//	*       /relay...              VPS relay (airsim_relay.go)
func (s *Server) routeAirSIMAgentAPI(w http.ResponseWriter, r *http.Request, cleanPath string) bool {
	if cleanPath != "airsim-agent" && !strings.HasPrefix(cleanPath, "airsim-agent/") {
		return false
	}
	if relayTail, ok := strings.CutPrefix(cleanPath, "airsim-agent/relay"); ok && (relayTail == "" || strings.HasPrefix(relayTail, "/")) {
		s.routeRelayAPI(w, r, strings.TrimPrefix(relayTail, "/"))
		return true
	}
	agent := s.airsimAgent
	if agent == nil {
		writeError(w, http.StatusServiceUnavailable, "airsim_agent_unavailable", "AirSIM agent is not running")
		return true
	}
	tail := strings.TrimPrefix(strings.TrimPrefix(cleanPath, "airsim-agent"), "/")
	switch {
	case tail == "":
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, map[string]any{"data": agent.status(r.Context())})
		case http.MethodPut:
			s.updateAirSIMAgent(w, r, agent)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		}
	case tail == "pair":
		if !requireMethod(w, r, http.MethodPost) {
			return true
		}
		if !agent.config().Enabled {
			writeError(w, http.StatusConflict, "airsim_agent_disabled", "先开启 iPhone 连接")
			return true
		}
		if _, err := agent.openWindow(); err != nil {
			writeError(w, http.StatusInternalServerError, "pairing_failed", err.Error())
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": agent.status(r.Context())})
	case strings.HasPrefix(tail, "clients/"):
		if !requireMethod(w, r, http.MethodDelete) {
			return true
		}
		id := strings.TrimPrefix(tail, "clients/")
		_, err := agent.update(r.Context(), func(cfg *airsimAgentConfig) {
			kept := cfg.Clients[:0]
			for _, client := range cfg.Clients {
				if client.ID != id {
					kept = append(kept, client)
				}
			}
			cfg.Clients = kept
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "save_failed", err.Error())
			return true
		}
		s.recordAudit(r.Context(), "admin", "airsim_agent.unpair", "airsim", id, "success", "")
		writeJSON(w, http.StatusOK, map[string]any{"data": agent.status(r.Context())})
	default:
		writeError(w, http.StatusNotFound, "not_found", "endpoint not found")
	}
	return true
}

func (s *Server) updateAirSIMAgent(w http.ResponseWriter, r *http.Request, agent *airsimAgent) {
	var request struct {
		Enabled     *bool     `json:"enabled"`
		Name        *string   `json:"name"`
		PairPort    *int      `json:"pair_port"`
		ControlPort *int      `json:"control_port"`
		PCMPort     *int      `json:"pcm_port"`
		DeviceIDs   *[]string `json:"device_ids"`
		TLSCert     *string   `json:"tls_cert"`
		TLSKey      *string   `json:"tls_key"`
		Cloud       *bool     `json:"cloud"`
	}
	if err := s.decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	current := agent.config()
	ports := []*int{request.PairPort, request.ControlPort, request.PCMPort}
	chosen := []int{current.PairPort, current.ControlPort, current.PCMPort}
	for index, port := range ports {
		if port != nil {
			if *port < 1024 || *port > 65535 {
				writeError(w, http.StatusBadRequest, "invalid_port", "端口需在 1024–65535 之间")
				return
			}
			chosen[index] = *port
		}
	}
	if chosen[0] == chosen[1] || chosen[1] == chosen[2] || chosen[0] == chosen[2] {
		writeError(w, http.StatusBadRequest, "invalid_port", "三个端口不能相同")
		return
	}
	for _, path := range []*string{request.TLSCert, request.TLSKey} {
		if path != nil && strings.TrimSpace(*path) != "" {
			if _, err := os.Stat(strings.TrimSpace(*path)); err != nil {
				writeError(w, http.StatusBadRequest, "tls_file_missing", "找不到证书文件："+strings.TrimSpace(*path))
				return
			}
		}
	}
	cfg, err := agent.update(r.Context(), func(cfg *airsimAgentConfig) {
		if request.Enabled != nil {
			cfg.Enabled = *request.Enabled
		}
		if request.Name != nil {
			cfg.Name = strings.TrimSpace(*request.Name)
		}
		cfg.PairPort, cfg.ControlPort, cfg.PCMPort = chosen[0], chosen[1], chosen[2]
		if request.DeviceIDs != nil {
			cfg.DeviceIDs = *request.DeviceIDs
		}
		if request.TLSCert != nil {
			cfg.TLSCert = strings.TrimSpace(*request.TLSCert)
		}
		if request.TLSKey != nil {
			cfg.TLSKey = strings.TrimSpace(*request.TLSKey)
		}
		if request.Cloud != nil {
			cfg.Cloud = *request.Cloud
		}
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "save_failed", err.Error())
		return
	}
	agent.restart(context.WithoutCancel(r.Context()))
	s.recordAudit(r.Context(), "admin", "airsim_agent.update", "airsim", "agent", "success", boolText(cfg.Enabled))
	writeJSON(w, http.StatusOK, map[string]any{"data": agent.status(r.Context())})
}

func boolText(value bool) string {
	if value {
		return "enabled"
	}
	return "disabled"
}

func (a *airsimAgent) status(ctx context.Context) map[string]any {
	cfg := a.config()
	clients := make([]map[string]any, 0, len(cfg.Clients))
	for _, client := range cfg.Clients {
		entry := map[string]any{"id": client.ID, "created_at": client.CreatedAt, "local_mode": client.LocalMode, "cloud_enabled": client.CloudEnabled}
		if !client.LastSeen.IsZero() {
			entry["last_seen"] = client.LastSeen
		}
		clients = append(clients, entry)
	}
	lines := make([]map[string]any, 0)
	for _, slot := range a.simSlots(ctx) {
		lines = append(lines, map[string]any{"id": slot["id"], "label": slot["label"], "number": slot["number"]})
	}
	result := map[string]any{
		"enabled": cfg.Enabled, "agent_id": cfg.AgentID, "name": cfg.Name,
		"pair_port": cfg.PairPort, "control_port": cfg.ControlPort, "pcm_port": cfg.PCMPort,
		"device_ids": cfg.DeviceIDs, "tls_cert": cfg.TLSCert, "tls_key": cfg.TLSKey,
		"clients": clients, "lines": lines, "addresses": localAddresses(),
		"cloud": cfg.Cloud, "cloud_status": a.cloud.status(),
	}
	a.mu.Lock()
	if a.runErr != "" {
		result["error"] = a.runErr
	}
	window := a.window
	a.mu.Unlock()
	if window != nil && window.Open(time.Now()) {
		result["pairing"] = map[string]any{"code": window.Code, "expires_at": window.ExpiresAt}
	}
	if cfg.TLSCert != "" {
		if _, err := a.certificate(nil); err != nil {
			result["tls_error"] = err.Error()
		}
	}
	a.callsMu.Lock()
	if a.active != nil {
		result["active_call"] = map[string]any{"number": a.active.Number, "state": a.active.State, "direction": a.active.Direction}
	}
	a.callsMu.Unlock()
	return result
}

// localAddresses lists the NAS's private IPv4 addresses for the iPhone's
// manual pairing form.
func localAddresses() []string {
	var values []string
	interfaces, err := net.Interfaces()
	if err != nil {
		return values
	}
	for _, item := range interfaces {
		if item.Flags&net.FlagUp == 0 || item.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, _ := item.Addrs()
		for _, address := range addresses {
			prefix, ok := address.(*net.IPNet)
			if !ok || prefix.IP.To4() == nil {
				continue
			}
			if privatePeer(&net.TCPAddr{IP: prefix.IP}) {
				values = append(values, prefix.IP.String())
			}
		}
	}
	return values
}
