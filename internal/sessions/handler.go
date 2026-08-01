package sessions

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/leolimasa/devsesh/internal/auth"
	"github.com/leolimasa/devsesh/internal/ctxutil"
	"github.com/leolimasa/devsesh/internal/db"
)

// UserIDFromContext extracts user ID from context using ctxutil.
func UserIDFromContext(ctx context.Context) (int64, bool) {
	return ctxutil.UserIDFromContext(ctx)
}

// HostIDFromContext extracts host ID from context using ctxutil.
func HostIDFromContext(ctx context.Context) (int64, bool) {
	return ctxutil.HostIDFromContext(ctx)
}

// SessionFromContext extracts session from context using ctxutil.
func SessionFromContext(ctx context.Context) (*db.Session, bool) {
	return ctxutil.SessionFromContext(ctx)
}

func validateJWT(secret, tokenStr string) (*auth.Claims, error) {
	return auth.ValidateToken(secret, tokenStr)
}

func makeUpgrader(rpOrigin string) websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			// Allow empty origin (same-origin requests) or matching configured origin
			return origin == "" || origin == rpOrigin
		},
	}
}

func StartHandler(database *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		hostID, ok := HostIDFromContext(r.Context())
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

		now := time.Now()
		s := db.Session{
			ID:             sessionID,
			UserID:         userID,
			HostID:         hostID,
			Name:           name,
			StartedAt:      startTime,
			LastPingAt:     &now,
			LastActivityAt: &now,
			Metadata:       &metaStr,
		}

		if err := db.CreateSession(database, s); err != nil {
			slog.Error("failed to create session", "error", err)
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
			slog.Error("failed to update session ping", "error", err)
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

func ActivityHandler(database *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, ok := SessionFromContext(r.Context())
		if !ok {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}

		now := time.Now()
		if err := db.UpdateSessionActivity(database, session.ID, now); err != nil {
			slog.Error("failed to update session activity", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		session.LastActivityAt = &now
		hub.Broadcast(session.UserID, SessionUpdate{
			Event:     "activity",
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
			slog.Error("failed to end session", "error", err)
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
			slog.Error("failed to update session meta", "error", err)
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

		sessions, err := db.GetSessionsWithHostByUserID(database, userID)
		if err != nil {
			slog.Error("failed to get sessions by user id", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		if sessions == nil {
			sessions = []db.Session{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sessions)
	}
}

func GetSessionHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		sessionID := r.PathValue("session_id")

		session, err := db.GetSession(database, sessionID)
		if err != nil {
			slog.Error("failed to get session", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if session == nil {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}
		if session.UserID != userID {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(session)
	}
}

// ReorderHandler persists a new session display order. Body: {"session_ids":
// [...]} in the desired order. Scoped to the authenticated user.
func ReorderHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req struct {
			SessionIDs []string `json:"session_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		if err := db.ReorderSessions(database, userID, req.SessionIDs); err != nil {
			slog.Error("failed to reorder sessions", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func DeleteStaleHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := UserIDFromContext(r.Context()); !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		deleted, err := db.DeleteStaleSessions(database)
		if err != nil {
			slog.Error("failed to delete stale sessions", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int64{"deleted": deleted})
	}
}

func DeleteSessionHandler(database *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, ok := SessionFromContext(r.Context())
		if !ok {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}

		userID, _ := UserIDFromContext(r.Context())
		if err := db.DeleteSession(database, session.ID); err != nil {
			slog.Error("failed to delete session", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		hub.Broadcast(userID, SessionUpdate{
			Event:     "delete",
			SessionID: session.ID,
			Session:   *session,
		})

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"deleted": session.ID})
	}
}

func UpdatesHandler(database *sql.DB, hub *Hub, jwtSecret string, rpOrigin string) http.HandlerFunc {
	upgrader := makeUpgrader(rpOrigin)
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}

		// Read the first message as the JWT token
		_, msg, err := conn.ReadMessage()
		if err != nil {
			conn.WriteJSON(map[string]string{"error": "authentication required"})
			conn.Close()
			return
		}

		// Parse and validate the token
		tokenStr := string(msg)
		claims, err := validateJWT(jwtSecret, tokenStr)
		if err != nil {
			conn.WriteJSON(map[string]string{"error": "invalid token"})
			conn.Close()
			return
		}

		c := &client{
			conn:   conn,
			send:   make(chan []byte, 64),
			userID: claims.UserID,
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
