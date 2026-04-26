package auth

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/db"
)

func makeEnrollmentUpgrader(cfg config.Config) websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			// Allow empty origin (same-origin requests) or matching configured origin
			return origin == "" || origin == cfg.RPOrigin
		},
	}
}

type enrollmentClient struct {
	conn       *websocket.Conn
	send       chan []byte
	code       string
	isMachineA bool
	userID     *int64
}

type enrollmentPair struct {
	machineA *enrollmentClient
	machineB *enrollmentClient
}

type EnrollmentHub struct {
	enrollments map[string]*enrollmentPair
	mu          sync.RWMutex
}

func NewEnrollmentHub() *EnrollmentHub {
	return &EnrollmentHub{
		enrollments: make(map[string]*enrollmentPair),
	}
}

func (h *EnrollmentHub) getOrCreatePair(code string) *enrollmentPair {
	h.mu.Lock()
	defer h.mu.Unlock()

	pair, ok := h.enrollments[code]
	if !ok {
		pair = &enrollmentPair{}
		h.enrollments[code] = pair
	}
	return pair
}

func (h *EnrollmentHub) removeClient(code string, isMachineA bool) {
	h.mu.Lock()
	defer h.mu.Unlock()

	pair, ok := h.enrollments[code]
	if !ok {
		return
	}

	if isMachineA {
		if pair.machineA != nil {
			pair.machineA.conn.Close()
			pair.machineA = nil
		}
	} else {
		if pair.machineB != nil {
			pair.machineB.conn.Close()
			pair.machineB = nil
		}
	}

	if pair.machineA == nil && pair.machineB == nil {
		delete(h.enrollments, code)
	}
}

func (h *EnrollmentHub) getPair(code string) *enrollmentPair {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.enrollments[code]
}

type wsMessage struct {
	Type       string `json:"type"`
	Message    string `json:"message"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

func EnrollmentWebSocketHandler(database *sql.DB, hub *EnrollmentHub, cfg config.Config) http.HandlerFunc {
	upgrader := makeEnrollmentUpgrader(cfg)
	return func(w http.ResponseWriter, r *http.Request) {
		code := r.PathValue("code")
		if code == "" {
			http.Error(w, "code required", http.StatusBadRequest)
			return
		}

		token := r.URL.Query().Get("token")

		enrollment, err := db.GetPasskeyEnrollment(database, code)
		if err != nil {
			slog.Error("failed to get passkey enrollment", "error", err, "code", code)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if enrollment == nil {
			http.Error(w, "enrollment not found", http.StatusNotFound)
			return
		}
		if time.Now().After(enrollment.ExpiresAt) {
			http.Error(w, "enrollment expired", http.StatusGone)
			return
		}
		if enrollment.Completed {
			http.Error(w, "enrollment already completed", http.StatusBadRequest)
			return
		}

		pair := hub.getOrCreatePair(code)

		var isMachineA bool
		var userID *int64

		if token == "" {
			if pair.machineB != nil {
				http.Error(w, "machine B already connected", http.StatusConflict)
				return
			}
			isMachineA = false
		} else {
			if pair.machineA != nil {
				http.Error(w, "machine A already connected", http.StatusConflict)
				return
			}
			if pair.machineB == nil {
				http.Error(w, "machine B must connect first", http.StatusBadRequest)
				return
			}

			claims, err := ValidateToken(token, cfg.JWTSecret)
			if err != nil {
				slog.Error("failed to validate token", "error", err)
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}

			userID = &claims.UserID
			isMachineA = true

			if err := db.LinkEnrollmentToUser(database, code, claims.UserID); err != nil {
				slog.Error("failed to link enrollment to user", "error", err)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Error("failed to upgrade websocket", "error", err)
			return
		}

		client := &enrollmentClient{
			conn:       conn,
			send:       make(chan []byte, 256),
			code:       code,
			isMachineA: isMachineA,
			userID:     userID,
		}

		if isMachineA {
			pair.machineA = client
		} else {
			pair.machineB = client
		}

		go client.writePump()
		go client.readPump(database, hub, isMachineA, pair)
	}
}

func (c *enrollmentClient) readPump(database *sql.DB, hub *EnrollmentHub, isMachineA bool, pair *enrollmentPair) {
	defer func() {
		hub.removeClient(c.code, isMachineA)
		c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}

		var wsMsg wsMessage
		if err := json.Unmarshal(message, &wsMsg); err != nil {
			slog.Error("failed to parse websocket message", "error", err)
			continue
		}

		var target *enrollmentClient
		if isMachineA {
			target = pair.machineB
		} else {
			target = pair.machineA
		}

		if target == nil {
			continue
		}

		select {
		case target.send <- message:
		default:
		}
	}
}

func (c *enrollmentClient) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}