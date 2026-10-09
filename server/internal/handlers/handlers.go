package handlers

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/termimus/termimus-server/internal/config"
	"github.com/termimus/termimus-server/internal/db"
	"github.com/termimus/termimus-server/internal/hub"
)

type Handler struct {
	cfg *config.Config
	db  *db.DB
	hub *hub.Hub
}

func New(cfg *config.Config, database *db.DB, eventHub *hub.Hub) *Handler {
	return &Handler{
		cfg: cfg,
		db:  database,
		hub: eventHub,
	}
}

// ── GET /health ─────────────────────────────────────────────────────────────
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"service": "termimus-sync-server",
		"version": "0.7.0",
	})
}

// ── GET /api/v1/sync/status ─────────────────────────────────────────────────
func (h *Handler) SyncStatus(w http.ResponseWriter, r *http.Request) {
	rev, err := h.db.GetLatestRevision()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to query sync revision: "+err.Error())
		return
	}

	if rev == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"has_data":       false,
			"latest_version": 0,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"has_data":       true,
		"latest_version": rev.Version,
		"device_id":      rev.DeviceID,
		"device_name":    rev.DeviceName,
		"updated_at":     rev.CreatedAt,
	})
}

// ── GET /api/v1/sync/bundle ─────────────────────────────────────────────────
func (h *Handler) GetBundle(w http.ResponseWriter, r *http.Request) {
	blob, version, err := h.db.GetLatestBlob()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to read sync bundle: "+err.Error())
		return
	}

	if version == 0 || blob == "" {
		writeError(w, http.StatusNotFound, "No sync bundle available on server yet")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"version":        version,
		"encrypted_blob": blob,
	})
}

type PushBundleRequest struct {
	DeviceID      string          `json:"device_id"`
	DeviceName    string          `json:"device_name"`
	EncryptedBlob json.RawMessage `json:"encrypted_blob"`
}

// ── POST /api/v1/sync/bundle ────────────────────────────────────────────────
func (h *Handler) PostBundle(w http.ResponseWriter, r *http.Request) {
	// Limit request body to 25MB to prevent memory exhaustion DoS
	r.Body = http.MaxBytesReader(w, r.Body, 25*1024*1024)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Failed to read request body or payload exceeds 25MB limit")
		return
	}
	defer r.Body.Close()

	var req PushBundleRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON payload: "+err.Error())
		return
	}

	trimmedBlob := strings.TrimSpace(string(req.EncryptedBlob))
	if trimmedBlob == "" || trimmedBlob == "null" {
		writeError(w, http.StatusBadRequest, "encrypted_blob is required")
		return
	}

	// Support both string-wrapped JSON and raw JSON object payloads
	var blobStr string
	if len(trimmedBlob) > 0 && trimmedBlob[0] == '"' {
		// It's a quoted JSON string literal — unescape it
		if err := json.Unmarshal(req.EncryptedBlob, &blobStr); err != nil {
			blobStr = trimmedBlob
		}
	} else {
		// It's a raw JSON object or array
		blobStr = trimmedBlob
	}

	if !json.Valid([]byte(blobStr)) {
		writeError(w, http.StatusBadRequest, "encrypted_blob must be valid JSON")
		return
	}

	// Enforce zero-knowledge E2EE policy: server accepts only version 2 encrypted bundles
	var envelope struct {
		Encrypted     bool `json:"encrypted"`
		FormatVersion int  `json:"format_version"`
	}
	if err := json.Unmarshal([]byte(blobStr), &envelope); err != nil || !envelope.Encrypted || envelope.FormatVersion != 2 {
		writeError(w, http.StatusBadRequest, "Server policy: only version 2 encrypted bundles (E2EE) are accepted to prevent plaintext leakage")
		return
	}

	if req.DeviceID == "" {
		req.DeviceID = "unknown-device"
	}
	if req.DeviceName == "" {
		req.DeviceName = "Termimus Client"
	}

	newVersion, err := h.db.SaveRevision(req.DeviceID, req.DeviceName, blobStr)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to save revision: "+err.Error())
		return
	}

	log.Printf("[Sync] Stored new revision %d from device %s (%s)", newVersion, req.DeviceName, req.DeviceID)

	// Broadcast update to all connected WebSocket peers
	h.hub.Broadcast(hub.EventMessage{
		Type:       "SYNC_UPDATED",
		Version:    newVersion,
		DeviceID:   req.DeviceID,
		DeviceName: req.DeviceName,
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"version": newVersion,
	})
}

// ── GET /api/v1/sync/devices ────────────────────────────────────────────────
func (h *Handler) GetDevices(w http.ResponseWriter, r *http.Request) {
	devices, err := h.db.GetDevices()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to query devices: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"devices": devices,
	})
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all desktop/browser origins
	},
}

// ── GET /api/v1/sync/ws ─────────────────────────────────────────────────────
func (h *Handler) WebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Upgrade failed: %v", err)
		return
	}

	client := h.hub.RegisterClient(conn)

	go client.WritePump()
	go client.ReadPump()
}

// ── Helpers ─────────────────────────────────────────────────────────────────
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{
		"error": message,
	})
}
