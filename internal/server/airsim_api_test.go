package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"vocat/internal/airsim"
	"vocat/internal/store"
)

func newAirSIMTestServer(t *testing.T) *Server {
	t.Helper()
	database, err := store.Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	server := &Server{store: database, logger: logger, maxRequestBodyBytes: 1 << 20}
	server.airsim = airsim.NewManager(airsimStorage{store: database}, server.saveAirSIMSMS, logger)
	return server
}

func TestAirSIMSMSLandsInHaloHistory(t *testing.T) {
	server := newAirSIMTestServer(t)
	ctx := context.Background()
	message := airsim.SMS{DeliveryID: "d-1", Sender: "+886900000000", Content: "驗證碼 123456", Timestamp: "2026-11-08T10:00:00Z"}
	for range 2 { // a re-delivery after a lost ack must not duplicate it
		if err := server.saveAirSIMSMS(ctx, airsim.Pairing{AgentID: "agent"}, message); err != nil {
			t.Fatal(err)
		}
	}
	messages, err := server.store.ListSMSMessages(ctx, store.SMSFilter{DeviceID: airsimDeviceID, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].Body != "驗證碼 123456" || messages[0].Direction != "inbound" || messages[0].Read {
		t.Fatalf("messages = %+v", messages)
	}
}

func TestAirSIMAPIBeforePairing(t *testing.T) {
	server := newAirSIMTestServer(t)
	status := httptest.NewRecorder()
	if !server.routeAirSIMAPI(status, httptest.NewRequest(http.MethodGet, "/api/airsim", nil), "airsim") {
		t.Fatal("route missed")
	}
	var body struct {
		Data airsim.Status `json:"data"`
	}
	if err := json.Unmarshal(status.Body.Bytes(), &body); err != nil || body.Data.Paired || body.Data.State != "unpaired" {
		t.Fatalf("status = %s", status.Body)
	}

	dial := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/airsim/calls/dial", strings.NewReader(`{"number":"10086"}`))
	request.Header.Set("Content-Type", "application/json")
	server.routeAirSIMAPI(dial, request, "airsim/calls/dial")
	if dial.Code != http.StatusConflict || !strings.Contains(dial.Body.String(), "airsim_not_paired") {
		t.Fatalf("dial before pairing = %d %s", dial.Code, dial.Body)
	}

	send := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/sms/send", strings.NewReader(`{"device_id":"airsim","phone":"10086","message":"hi"}`))
	request.Header.Set("Content-Type", "application/json")
	server.handleSMSSend(send, request)
	if send.Code != http.StatusConflict || !strings.Contains(send.Body.String(), "airsim_not_paired") {
		t.Fatalf("SMS before pairing = %d %s", send.Code, send.Body)
	}

	pair := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/airsim/pair", strings.NewReader(`{"host":"8.8.8.8","port":40000,"code":"123456"}`))
	request.Header.Set("Content-Type", "application/json")
	server.routeAirSIMAPI(pair, request, "airsim/pair")
	if pair.Code != http.StatusBadRequest || !strings.Contains(pair.Body.String(), "公网") {
		t.Fatalf("public pairing target = %d %s", pair.Code, pair.Body)
	}
}

func TestAirSIMPairingIsStoredAsSensitiveSetting(t *testing.T) {
	server := newAirSIMTestServer(t)
	ctx := context.Background()
	storage := airsimStorage{store: server.store}
	pairing := airsim.Pairing{Host: "192.168.1.50", ControlPort: 7592, PCMPort: 7593, AgentID: "agent", Secret: "c2VjcmV0"}
	if err := storage.SavePairing(ctx, pairing); err != nil {
		t.Fatal(err)
	}
	setting, err := server.store.AppSetting(ctx, airsimPairingKey)
	if err != nil || !setting.Sensitive {
		t.Fatalf("setting = %+v, %v", setting, err)
	}
	loaded, ok, err := storage.LoadPairing(ctx)
	if err != nil || !ok || loaded.Host != pairing.Host || loaded.Secret != pairing.Secret {
		t.Fatalf("loaded = %+v %v %v", loaded, ok, err)
	}
	if err := storage.DeletePairing(ctx); err != nil {
		t.Fatal(err)
	}
	if err := storage.DeletePairing(ctx); err != nil {
		t.Fatal("deleting twice must be fine:", err)
	}
}
