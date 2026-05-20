package ca

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/leolimasa/devsesh/internal/ctxutil"
	"golang.org/x/crypto/ssh"
)

// wsMessage represents an incoming WebSocket message from the client.
type wsMessage struct {
	Type          string `json:"type"`                      // "request_cert", "round1", "round2"
	HostID        int64  `json:"host_id,omitempty"`         // Host ID for certificate request
	UserPublicKey string `json:"user_public_key,omitempty"` // Base64-encoded user ephemeral public key (32 bytes)
	Session       string `json:"session,omitempty"`         // Session ID from server
	Payload       string `json:"payload,omitempty"`         // Base64-encoded payload
}

// wsResponse represents an outgoing WebSocket message to the client.
type wsResponse struct {
	Type      string `json:"type"`       // "session", "commitment", "certificate", "error"
	Session   string `json:"session"`    // Session ID from server
	Payload   string `json:"payload"`    // Base64-encoded payload
	ExpiresIn int64  `json:"expires_in"` // Seconds until expiry
	Serial    int64  `json:"serial,omitempty"`
	Error     string `json:"error,omitempty"`
}

// signingClient represents a WebSocket client connection for FROST signing.
type signingClient struct {
	conn   *websocket.Conn
	userID int64
	send   chan []byte
	state  signingState
	mu     sync.Mutex
}

// signingState holds the state for an ongoing FROST signing session.
type signingState struct {
	sessionID        string
	hostID           int64
	frostState       *FROSTSigningState
	tbsData          []byte
	cert             *ssh.Certificate
	caPublicKey      []byte
	commitmentSent   bool
	signatureResult  []byte
	clientCommitment []byte
	certSerial       int64
}

// SigningWebSocketHandler handles the WebSocket connection for FROST signing.
// WS /api/v1/sshca/sign
func (h *Handler) SigningWebSocketHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		upgrader := websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     h.checkOrigin,
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Error("failed to upgrade websocket", "error", err)
			return
		}

		client := &signingClient{
			conn:   conn,
			userID: userID,
			send:   make(chan []byte, 256),
		}

		go client.writePump()
		go client.readPump(h)
	}
}

// readPump reads messages from the WebSocket connection.
func (c *signingClient) readPump(h *Handler) {
	defer func() {
		c.cleanup(h)
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
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Debug("websocket read error", "error", err)
			}
			break
		}

		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		var wsMsg wsMessage
		if err := json.Unmarshal(message, &wsMsg); err != nil {
			c.sendError("invalid message format")
			continue
		}

		c.handleMessage(h, &wsMsg)
	}
}

// handleMessage dispatches incoming messages to the appropriate handler.
func (c *signingClient) handleMessage(h *Handler, msg *wsMessage) {
	c.mu.Lock()
	defer c.mu.Unlock()

	switch msg.Type {
	case "request_cert":
		h.handleRequestCert(c, msg)
	case "round1":
		h.handleRound1(c, msg)
	case "round2":
		h.handleRound2(c, msg)
	default:
		c.sendError("unknown message type: " + msg.Type)
	}
}

// writePump sends messages to the WebSocket connection.
func (c *signingClient) writePump() {
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

// sendResponse sends a response message to the client.
func (c *signingClient) sendResponse(resp wsResponse) {
	data, err := json.Marshal(resp)
	if err != nil {
		slog.Error("failed to marshal response", "error", err)
		return
	}
	select {
	case c.send <- data:
	default:
		slog.Warn("failed to send response, channel full, closing connection")
		c.conn.Close()
	}
}

// sendError sends an error response to the client.
func (c *signingClient) sendError(errMsg string) {
	resp := wsResponse{
		Type:  "error",
		Error: errMsg,
	}
	c.sendResponse(resp)
}

// cleanup cleans up resources when the connection closes.
func (c *signingClient) cleanup(h *Handler) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.state.sessionID != "" {
		h.sessionManager.DeleteSession(c.state.sessionID)
	}
	if c.state.frostState != nil {
		ZeroSigningState(c.state.frostState)
	}
}
