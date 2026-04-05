package ssh

import (
	"database/sql"
	"net/http"

	"github.com/leobeosab/devsesh/internal/db"
	"github.com/leobeosab/devsesh/internal/sessions"
)

func RegisterRoutes(mux *http.ServeMux, database *sql.DB, jwtMiddleware func(http.Handler) http.Handler) {
	mux.Handle("GET /api/v1/ssh/connect/{session_id}", jwtMiddleware(http.HandlerFunc(ConnectHandler(database))))
	mux.Handle("POST /api/v1/ssh/webauthn/begin", jwtMiddleware(http.HandlerFunc(SSHWebAuthnBeginHandler())))
	mux.Handle("POST /api/v1/ssh/webauthn/complete", jwtMiddleware(http.HandlerFunc(SSHWebAuthnCompleteHandler())))
}

func ConnectHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := sessions.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		sessionID := r.PathValue("session_id")

		session, err := db.GetSession(database, sessionID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if session == nil || session.UserID != userID {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","hostname":"` + session.Hostname + `"}`))
	}
}

func SSHWebAuthnBeginHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
	}
}

func SSHWebAuthnCompleteHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
	}
}
