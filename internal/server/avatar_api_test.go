package server

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A 1×1 PNG.
const tinyPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

func avatarRequest(t *testing.T, server *Server, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, "/api/settings/avatar", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	server.handleAvatar(recorder, request)
	return recorder
}

func TestAvatarRoundTrip(t *testing.T) {
	server := newAirSIMTestServer(t)
	if got := avatarRequest(t, server, http.MethodGet, ""); got.Code != 200 || !strings.Contains(got.Body.String(), `"image":""`) {
		t.Fatalf("empty = %d %s", got.Code, got.Body)
	}
	// The declared type is replaced by what the bytes are.
	put := avatarRequest(t, server, http.MethodPut, `{"image":"data:image/jpeg;base64,`+tinyPNG+`"}`)
	if put.Code != 200 || !strings.Contains(put.Body.String(), "data:image/png;base64,") {
		t.Fatalf("put = %d %s", put.Code, put.Body)
	}
	if got := avatarRequest(t, server, http.MethodGet, ""); !strings.Contains(got.Body.String(), tinyPNG) {
		t.Fatalf("get = %s", got.Body)
	}
	for range 2 {
		if got := avatarRequest(t, server, http.MethodDelete, ""); got.Code != 200 {
			t.Fatalf("delete = %d %s", got.Code, got.Body)
		}
	}
}

func TestAvatarRejectsScriptsAndBlobs(t *testing.T) {
	server := newAirSIMTestServer(t)
	svg := base64.StdEncoding.EncodeToString([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`))
	for name, body := range map[string]string{
		"svg":      `{"image":"data:image/svg+xml;base64,` + svg + `"}`,
		"not data": `{"image":"https://example.com/a.png"}`,
		"too big":  `{"image":"data:image/png;base64,` + strings.Repeat("A", 300<<10) + `"}`,
	} {
		if got := avatarRequest(t, server, http.MethodPut, body); got.Code != http.StatusBadRequest {
			t.Errorf("%s = %d %s", name, got.Code, got.Body)
		}
	}
}
