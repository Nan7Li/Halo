package server

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"vocat/internal/store"
)

const (
	avatarSettingKey = "ui.avatar"
	// The browser crops and scales the photo to 256×256 before uploading,
	// which lands well under this; the cap keeps a hand-made request from
	// parking a large blob in app_settings.
	maxAvatarBytes = 192 << 10
)

var avatarTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/webp": true,
	"image/gif":  true,
}

// handleAvatar stores the administrator's profile photo as a data URL.
func (s *Server) handleAvatar(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		image := ""
		setting, err := s.store.AppSetting(r.Context(), avatarSettingKey)
		switch {
		case errors.Is(err, store.ErrNotFound):
		case err != nil:
			s.writeStoreError(w, err)
			return
		default:
			var document struct {
				Image string `json:"image"`
			}
			if json.Unmarshal(setting.Value, &document) == nil {
				image = document.Image
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]string{"image": image}})
	case http.MethodPut:
		var request struct {
			Image string `json:"image"`
		}
		if err := s.decodeJSON(w, r, &request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		image, err := normalizeAvatar(request.Image)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_avatar", err.Error())
			return
		}
		raw, err := json.Marshal(map[string]string{"image": image})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "an internal error occurred")
			return
		}
		if err := s.store.UpsertAppSetting(r.Context(), store.AppSetting{Key: avatarSettingKey, Value: raw}); err != nil {
			s.writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]string{"image": image}})
	case http.MethodDelete:
		if err := s.store.DeleteAppSetting(r.Context(), avatarSettingKey); err != nil && !errors.Is(err, store.ErrNotFound) {
			s.writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]string{"image": ""}})
	default:
		w.Header().Set("Allow", "GET, PUT, DELETE")
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

// normalizeAvatar accepts a base64 data URL of a small raster image and
// returns it with the media type the bytes actually have, so an SVG (which
// can carry script) or anything else never comes back as an image.
func normalizeAvatar(value string) (string, error) {
	value = strings.TrimSpace(value)
	header, payload, ok := strings.Cut(value, ",")
	if !ok || !strings.HasPrefix(header, "data:") || !strings.HasSuffix(header, ";base64") {
		return "", errors.New("头像必须是 base64 图片")
	}
	if base64.StdEncoding.DecodedLen(len(payload)) > maxAvatarBytes+3 {
		return "", errors.New("头像图片太大")
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", errors.New("头像图片无法解码")
	}
	if len(data) == 0 || len(data) > maxAvatarBytes {
		return "", errors.New("头像图片太大")
	}
	kind := http.DetectContentType(data)
	if !avatarTypes[kind] {
		return "", errors.New("头像只支持 PNG、JPEG、WebP 或 GIF")
	}
	return "data:" + kind + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}
