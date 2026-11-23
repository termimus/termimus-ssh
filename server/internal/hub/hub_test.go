package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// Regression for #63: events queued before WritePump drains them must each
// arrive as their own WebSocket message containing exactly one JSON object.
func TestWritePumpSendsOneEventPerMessage(t *testing.T) {
	events := []EventMessage{
		{Type: "SYNC_UPDATED", Version: 1, DeviceID: "a", DeviceName: "laptop"},
		{Type: "SYNC_UPDATED", Version: 2, DeviceID: "b", DeviceName: "desk}{top"},
		{Type: "SYNC_UPDATED", Version: 3, DeviceID: "c", DeviceName: "phone"},
	}

	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		client := &Client{conn: conn, send: make(chan []byte, len(events))}
		// Queue everything before the pump starts so it sees a backlog.
		for _, ev := range events {
			data, _ := json.Marshal(ev)
			client.send <- data
		}
		go client.WritePump()
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	for i, want := range events {
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("message %d: read: %v", i, err)
		}
		var got EventMessage
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatalf("message %d is not a single JSON object: %q (%v)", i, raw, err)
		}
		if got != want {
			t.Fatalf("message %d: got %+v, want %+v", i, got, want)
		}
	}
}
