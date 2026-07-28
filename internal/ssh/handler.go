package ssh

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/leolimasa/devsesh/internal/auth"
	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/db"
	"github.com/gorilla/websocket"
)

func makeUpgrader(rpOrigin string) websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			// Allow empty origin (same-origin requests) or matching configured origin
			return origin == "" || origin == rpOrigin
		},
	}
}

type AuthMessage struct {
	Type  string `json:"type"`
	Token string `json:"token,omitempty"`
}

func ProxyHandler(database *sql.DB, cfg config.Config, connMgr *ConnectionManager) http.HandlerFunc {
	upgrader := makeUpgrader(cfg.RPOrigin)
	return func(w http.ResponseWriter, r *http.Request) {
		slog.Info("SSH WebSocket connection attempt", "path", r.URL.Path)

		hostID, err := strconv.ParseInt(r.PathValue("host_id"), 10, 64)
		if err != nil {
			slog.Error("invalid host id", "error", err)
			http.Error(w, "invalid host id", http.StatusBadRequest)
			return
		}

		host, err := db.GetHostByID(database, hostID)
		if err != nil {
			slog.Error("failed to get host", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		if host == nil {
			http.Error(w, "host not found", http.StatusNotFound)
			return
		}

		wsConn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Error("failed to upgrade WebSocket", "error", err)
			return
		}
		defer wsConn.Close()

		wsConn.SetReadDeadline(time.Now().Add(10 * time.Second))
		_, reader, err := wsConn.NextReader()
		if err != nil {
			slog.Error("failed to read first message", "error", err)
			wsConn.WriteMessage(websocket.TextMessage, []byte(`{"type": "error", "message": "authentication required"}`))
			return
		}

		var authMsg AuthMessage
		if err := json.NewDecoder(reader).Decode(&authMsg); err != nil {
			slog.Error("failed to decode auth message", "error", err)
			wsConn.WriteMessage(websocket.TextMessage, []byte(`{"type": "error", "message": "invalid auth message"}`))
			return
		}

		if authMsg.Type != "auth" || authMsg.Token == "" {
			wsConn.WriteMessage(websocket.TextMessage, []byte(`{"type": "error", "message": "first message must be auth with token"}`))
			return
		}

		claims, err := auth.ValidateToken(cfg.JWTSecret, authMsg.Token)
		if err != nil {
			slog.Error("failed to validate token", "error", err)
			wsConn.WriteMessage(websocket.TextMessage, []byte(`{"type": "error", "message": "invalid token"}`))
			return
		}

		userID := claims.UserID

		if host.UserID != userID {
			LogConnectionAttempt(userID, hostID, false)
			http.Error(w, "host not found", http.StatusNotFound)
			return
		}

		if !connMgr.CanConnect(userID) {
			LogConnectionAttempt(userID, hostID, false)
			http.Error(w, "too many connections", http.StatusTooManyRequests)
			return
		}

		connMgr.AddConnection(userID)
		defer connMgr.RemoveConnection(userID)

		sshPort := host.SSHPort
		if sshPort == 0 {
			sshPort = 22
		}

		addr := net.JoinHostPort(host.Hostname, strconv.Itoa(sshPort))

		connectCtx, connectCancel := context.WithTimeout(r.Context(), cfg.SSHTimeout)
		defer connectCancel()

		dialer := &net.Dialer{Timeout: cfg.SSHTimeout}
		tcpConn, err := dialer.DialContext(connectCtx, "tcp", addr)
		if err != nil {
			slog.Error("failed to dial TCP", "error", err, "addr", addr)
			wsConn.WriteMessage(websocket.TextMessage, []byte(`{"type": "error", "message": "failed to connect to host"}`))
			wsConn.Close()
			LogConnectionAttempt(userID, hostID, false)
			return
		}
		defer tcpConn.Close()

		err = wsConn.WriteMessage(websocket.TextMessage, []byte(`{"type": "connected", "host": "`+host.Hostname+`", "port": `+strconv.Itoa(sshPort)+`}`))
		if err != nil {
			slog.Error("failed to send connected message", "error", err)
			LogConnectionAttempt(userID, hostID, false)
			return
		}

		LogConnectionAttempt(userID, hostID, true)

		proxy := NewTCPProxy(wsConn, tcpConn)
		err = proxy.Run()
		if err != nil {
			slog.Error("proxy error", "error", err)
		}

		// Serialize this final write through the proxy's write mutex; the ping and
		// TCP->WS goroutines may still be draining, and gorilla panics on a
		// concurrent write to the same connection.
		if err := proxy.sendControlMessage(ControlMessage{Type: "closed"}); err != nil {
			slog.Debug("failed to send closed message", "error", err)
		}
	}
}

func sendError(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ControlMessage{Type: "error", Message: message})
}

func RegisterRoutes(mux *http.ServeMux, database *sql.DB, _ func(http.Handler) http.Handler, cfg config.Config) {
	connMgr := NewConnectionManager(cfg)
	mux.Handle("GET /api/v1/hosts/{host_id}/ssh", http.HandlerFunc(ProxyHandler(database, cfg, connMgr)))
}