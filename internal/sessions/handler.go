package sessions

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/leobeosab/devsesh/internal/db"
)

type contextKey string

const (
	ContextKeyUserID  contextKey = "userID"
	ContextKeySession contextKey = "session"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func StartHandler(database *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		sessionID := r.PathValue("session_id")

		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		name, _ := body["name"].(string)
		hostname, _ := body["hostname"].(string)
		startTimeStr, _ := body["start_time"].(string)

		var startTime time.Time
		if startTimeStr != "" {
			startTime, _ = time.Parse(time.RFC3339, startTimeStr)
		}
		if startTime.IsZero() {
			startTime = time.Now()
		}

		metaJSON, _ := json.Marshal(body)
		metaStr := string(metaJSON)

		s := db.Session{
			ID:        sessionID,
			UserID:    userID,
			Name:      name,
			Hostname:  hostname,
			StartedAt: startTime,
			Metadata:  &metaStr,
		}

		if err := db.CreateSession(database, s); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		hub.Broadcast(userID, SessionUpdate{
			Event:     "start",
			SessionID: sessionID,
			Session:   s,
		})

		w.WriteHeader(http.StatusCreated)
	}
}

func PingHandler(database *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, ok := SessionFromContext(r.Context())
		if !ok {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}

		now := time.Now()
		if err := db.UpdateSessionPing(database, session.ID, now); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		session.LastPingAt = &now
		hub.Broadcast(session.UserID, SessionUpdate{
			Event:     "ping",
			SessionID: session.ID,
			Session:   *session,
		})

		w.WriteHeader(http.StatusOK)
	}
}

func EndHandler(database *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, ok := SessionFromContext(r.Context())
		if !ok {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}

		now := time.Now()
		if err := db.EndSession(database, session.ID, now); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		session.EndedAt = &now
		hub.Broadcast(session.UserID, SessionUpdate{
			Event:     "end",
			SessionID: session.ID,
			Session:   *session,
		})

		w.WriteHeader(http.StatusOK)
	}
}

func MetaHandler(database *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, ok := SessionFromContext(r.Context())
		if !ok {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}

		var meta map[string]any
		if err := json.NewDecoder(r.Body).Decode(&meta); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		metaJSON, _ := json.Marshal(meta)
		metaStr := string(metaJSON)

		if err := db.UpdateSessionMeta(database, session.ID, metaStr); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		session.Metadata = &metaStr
		hub.Broadcast(session.UserID, SessionUpdate{
			Event:     "meta",
			SessionID: session.ID,
			Session:   *session,
		})

		w.WriteHeader(http.StatusOK)
	}
}

func ListHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		sessions, err := db.GetSessionsByUserID(database, userID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sessions)
	}
}

func UpdatesHandler(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}

		c := &client{
			conn:   conn,
			send:   make(chan []byte, 64),
			userID: userID,
		}

		hub.Register(c)
		go writePump(c)

		defer func() {
			hub.Unregister(c)
			conn.Close()
		}()

		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}
}

func UserIDFromContext(ctx context.Context) (int64, bool) {
	userID, ok := ctx.Value(ContextKeyUserID).(int64)
	return userID, ok
}

func SessionFromContext(ctx context.Context) (*db.Session, bool) {
	session, ok := ctx.Value(ContextKeySession).(*db.Session)
	return session, ok
}
