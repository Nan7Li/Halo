package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"vocat/internal/airsim"
	"vocat/internal/developer"
	"vocat/internal/device"
	"vocat/internal/store"
	"vocat/internal/vowifi"
)

// airsimDeviceID tags the paired Android phone's texts and calls in Halo's
// stores. It is not a row in the devices table: the phone is driven over
// AirSIM's VoWLAN protocol, not through a modem.
const airsimDeviceID = "airsim"

const airsimPairingKey = "airsim.pairing"

type airsimStorage struct{ store *store.Store }

func (s airsimStorage) LoadPairing(ctx context.Context) (airsim.Pairing, bool, error) {
	setting, err := s.store.AppSetting(ctx, airsimPairingKey)
	if errors.Is(err, store.ErrNotFound) {
		return airsim.Pairing{}, false, nil
	}
	if err != nil {
		return airsim.Pairing{}, false, err
	}
	var pairing airsim.Pairing
	if err := json.Unmarshal(setting.Value, &pairing); err != nil {
		return airsim.Pairing{}, false, err
	}
	return pairing, true, nil
}

func (s airsimStorage) SavePairing(ctx context.Context, pairing airsim.Pairing) error {
	value, err := json.Marshal(pairing)
	if err != nil {
		return err
	}
	return s.store.UpsertAppSetting(ctx, store.AppSetting{Key: airsimPairingKey, Value: value, Sensitive: true})
}

func (s airsimStorage) DeletePairing(ctx context.Context) error {
	err := s.store.DeleteAppSetting(ctx, airsimPairingKey)
	if errors.Is(err, store.ErrNotFound) {
		return nil
	}
	return err
}

// StartAirSIM reconnects to the paired phone and raises Halo's incoming-call
// notification when it rings.
func (s *Server) StartAirSIM(ctx context.Context) {
	if s.airsim == nil {
		return
	}
	s.airsim.Start(ctx)
	go s.watchAirSIMCalls(ctx)
}

func (s *Server) watchAirSIMCalls(ctx context.Context) {
	announced := ""
	for {
		changed := s.airsim.Changed()
		status := s.airsim.Status()
		if call := status.Call; call != nil && call.State == "incoming" && call.ID != announced {
			announced = call.ID
			label := firstNonEmpty(status.DeviceName, status.Model, "安卓手机")
			s.NotifyIncomingCall(ctx, IncomingCallNotification{
				DeviceID:    airsimDeviceID,
				DeviceName:  label,
				DeviceLabel: label,
				Caller:      call.Number,
				Called:      status.PhoneNumber,
				Time:        time.Now().UTC(),
				Environment: "airsim",
			})
		}
		select {
		case <-ctx.Done():
			return
		case <-changed:
		}
	}
}

// saveAirSIMSMS stores a text received by the phone in Halo's SMS history,
// where the Messages page, notifications and bots pick it up.
func (s *Server) saveAirSIMSMS(ctx context.Context, pairing airsim.Pairing, message airsim.SMS) error {
	timestamp, err := time.Parse(time.RFC3339Nano, message.Timestamp)
	if err != nil {
		if millis, parseErr := strconv.ParseInt(message.Timestamp, 10, 64); parseErr == nil {
			timestamp = time.UnixMilli(millis)
		} else {
			timestamp = time.Now()
		}
	}
	extra, _ := json.Marshal(map[string]any{"airsim_agent": pairing.AgentID, "sim_slot": message.SIMSlot})
	result, err := s.store.SaveSMSMessageWithResult(ctx, store.SMSMessage{
		MessageID: "airsim:" + message.DeliveryID,
		DeviceID:  airsimDeviceID,
		Peer:      message.Sender,
		Direction: "inbound",
		Body:      message.Content,
		Timestamp: timestamp.UTC(),
		Status:    "received",
		Source:    "airsim",
		Extra:     extra,
	})
	if err == nil && result.Inserted {
		s.logger.Info("AirSIM SMS received", "category", "sms", "event", "sms.received",
			"sms_id", result.Message.ID, "device_id", airsimDeviceID, "peer", message.Sender, "transport", "airsim")
	}
	return err
}

func (s *Server) routeAirSIMAPI(w http.ResponseWriter, r *http.Request, cleanPath string) bool {
	if cleanPath != "airsim" && !strings.HasPrefix(cleanPath, "airsim/") {
		return false
	}
	if s.airsim == nil {
		writeError(w, http.StatusServiceUnavailable, "airsim_unavailable", "AirSIM is unavailable")
		return true
	}
	switch strings.TrimPrefix(strings.TrimPrefix(cleanPath, "airsim"), "/") {
	case "":
		s.handleAirSIM(w, r)
	case "events":
		s.handleAirSIMEvents(w, r)
	case "pair":
		s.handleAirSIMPair(w, r)
	case "calls/dial":
		s.handleAirSIMDial(w, r)
	case "calls/answer", "calls/reject", "calls/hangup", "calls/dtmf":
		s.handleAirSIMCallAction(w, r, strings.TrimPrefix(cleanPath, "airsim/calls/"))
	case "calls/media":
		s.handleAirSIMMedia(w, r)
	default:
		writeError(w, http.StatusNotFound, "not_found", "AirSIM endpoint not found")
	}
	return true
}

func (s *Server) handleAirSIM(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"data": s.airsim.Status()})
	case http.MethodDelete:
		if err := s.airsim.Unpair(r.Context()); err != nil {
			s.logger.Error("AirSIM unpair failed", "error", err)
			writeError(w, http.StatusInternalServerError, "internal_error", "an internal error occurred")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": s.airsim.Status()})
	default:
		w.Header().Set("Allow", "GET, DELETE")
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

// handleAirSIMEvents long-polls: it answers when the status revision passes
// ?after=, or after 25 seconds with the unchanged status.
func (s *Server) handleAirSIMEvents(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	after, err := strconv.ParseUint(r.URL.Query().Get("after"), 10, 64)
	if err != nil || after == 0 {
		// No cursor yet: answer at once, whatever the revision.
		writeJSON(w, http.StatusOK, map[string]any{"data": s.airsim.Status()})
		return
	}
	timeout := time.NewTimer(25 * time.Second)
	defer timeout.Stop()
	for {
		changed := s.airsim.Changed()
		status := s.airsim.Status()
		if status.Revision > after {
			writeJSON(w, http.StatusOK, map[string]any{"data": status})
			return
		}
		select {
		case <-changed:
		case <-timeout.C:
			writeJSON(w, http.StatusOK, map[string]any{"data": status})
			return
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) handleAirSIMPair(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var request struct {
		Host string `json:"host"`
		Port int    `json:"port"`
		Code string `json:"code"`
	}
	if err := s.decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	status, err := s.airsim.Pair(ctx, request.Host, request.Port, request.Code)
	if err != nil {
		writeError(w, http.StatusBadRequest, "airsim_pair_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": status})
}

func (s *Server) airsimClient(w http.ResponseWriter) (*airsim.Client, bool) {
	client, err := s.airsim.Client()
	if err != nil {
		writeError(w, http.StatusConflict, "airsim_not_paired", err.Error())
		return nil, false
	}
	return client, true
}

func writeAirSIMError(w http.ResponseWriter, err error) {
	var apiErr *airsim.APIError
	if errors.As(err, &apiErr) {
		message := apiErr.Error()
		switch {
		case apiErr.Status == http.StatusUnauthorized:
			message = "安卓手机不认这次配对了，可能在手机上清除了配对，请重新配对"
		case apiErr.Code == "default_dialer_required" || strings.Contains(apiErr.Code, "dialer"):
			message = "安卓上的 AirSIM 还不是默认电话应用"
		}
		writeError(w, http.StatusBadGateway, "airsim_rejected", message)
		return
	}
	writeError(w, http.StatusBadGateway, "airsim_unreachable", "连不上安卓手机："+err.Error())
}

func (s *Server) handleAirSIMDial(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var request struct {
		Number     string `json:"number"`
		SIMAccount string `json:"sim_account"`
	}
	if err := s.decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	number := strings.TrimSpace(request.Number)
	if number == "" || len(number) > 40 {
		writeError(w, http.StatusBadRequest, "invalid_number", "请输入号码")
		return
	}
	client, ok := s.airsimClient(w)
	if !ok {
		return
	}
	release, err := s.admitCallMutation()
	if err != nil {
		writeError(w, http.StatusConflict, "update_in_progress", err.Error())
		return
	}
	defer release()
	if err := client.Dial(r.Context(), number, strings.TrimSpace(request.SIMAccount)); err != nil {
		writeAirSIMError(w, err)
		return
	}
	s.logger.Info("AirSIM call placed", "category", "call", "event", "call.dial", "device_id", airsimDeviceID, "number", number)
	s.airsim.Refresh(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"data": s.airsim.Status()})
}

func (s *Server) handleAirSIMCallAction(w http.ResponseWriter, r *http.Request, action string) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var request struct {
		CallID string `json:"call_id"`
		Digit  string `json:"digit"`
	}
	if err := s.decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	client, ok := s.airsimClient(w)
	if !ok {
		return
	}
	callID := strings.TrimSpace(request.CallID)
	if callID == "" {
		if call := s.airsim.Status().Call; call != nil {
			callID = call.ID
		}
	}
	if callID == "" {
		writeError(w, http.StatusConflict, "no_active_call", "安卓手机上没有通话")
		return
	}
	var err error
	switch action {
	case "answer":
		err = client.Answer(r.Context(), callID)
	case "reject":
		err = client.Reject(r.Context(), callID)
	case "hangup":
		err = client.Hangup(r.Context(), callID)
	case "dtmf":
		if len(request.Digit) != 1 || !strings.Contains("0123456789*#", request.Digit) {
			writeError(w, http.StatusBadRequest, "invalid_digit", "按键只能是 0-9、* 或 #")
			return
		}
		err = client.DTMF(r.Context(), callID, request.Digit)
	}
	if err != nil {
		writeAirSIMError(w, err)
		return
	}
	s.airsim.Refresh(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"data": s.airsim.Status()})
}

// handleAirSIMMedia bridges the browser to the phone's call audio, in the
// same WebSocket format as Halo's other calls.
func (s *Server) handleAirSIMMedia(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	client, ok := s.airsimClient(w)
	if !ok {
		return
	}
	call := s.airsim.Status().Call
	callID := strings.TrimSpace(r.URL.Query().Get("call_id"))
	if call == nil || (callID != "" && callID != call.ID) {
		writeError(w, http.StatusConflict, "no_active_call", "安卓手机上没有这通电话")
		return
	}
	s.serveBrowserPCM(w, r, store.Device{ID: airsimDeviceID}, call.ID,
		func(ctx context.Context) (vowifi.CallMedia, func(), error) {
			media, err := client.OpenMedia(ctx)
			if err != nil {
				return nil, nil, err
			}
			return media, func() { media.Close() }, nil
		})
}

func (s *Server) sendAirSIMSMS(w http.ResponseWriter, r *http.Request, phone, message, simAccount string) {
	phone = strings.TrimSpace(phone)
	if blocked, reason := device.BlockedSMSDestination(phone); blocked {
		writeError(w, http.StatusBadRequest, "blocked_destination", reason)
		return
	}
	if phone == "" || strings.TrimSpace(message) == "" || len(message) > 2000 {
		writeError(w, http.StatusBadRequest, "invalid_request", "号码和内容都不能为空")
		return
	}
	client, ok := s.airsimClient(w)
	if !ok {
		return
	}
	limit := developer.SMSHourlyLimit(r.Context(), s.store)
	reservation, err := s.store.ReserveSMSSend(r.Context(), airsimDeviceID, limit, time.Now().UTC())
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	if !reservation.Allowed {
		writeError(w, http.StatusTooManyRequests, "sms_rate_limited",
			fmt.Sprintf("Global SMS limit reached: at most %d messages may be submitted in a rolling one-hour window.", reservation.Limit))
		return
	}
	if err := client.SendSMS(r.Context(), phone, message, strings.TrimSpace(simAccount)); err != nil {
		writeAirSIMError(w, err)
		return
	}
	now := time.Now().UTC()
	saved, err := s.store.SaveSMSMessage(r.Context(), store.SMSMessage{
		MessageID: fmt.Sprintf("airsim-out:%d", now.UnixNano()),
		DeviceID:  airsimDeviceID,
		Peer:      phone,
		Direction: "outbound",
		Body:      message,
		Timestamp: now,
		Status:    "sent",
		Source:    "airsim",
		Read:      true,
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"message_id": saved.MessageID, "id": saved.ID}})
}
