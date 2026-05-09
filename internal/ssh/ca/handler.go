package ca

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/ctxutil"
	"github.com/leolimasa/devsesh/internal/db"
	"github.com/leolimasa/devsesh/internal/util"
	"golang.org/x/crypto/ssh"
)

type wsMessage struct {
	Type    string `json:"type"` // "request_cert", "round1", "round2"
	HostID  int64  `json:"host_id,omitempty"`
	Session string `json:"session,omitempty"` // Session ID from server
	Payload string `json:"payload,omitempty"` // Base64-encoded payload
}

type wsResponse struct {
	Type      string `json:"type"`       // "session", "commitment", "certificate", "error"
	Session   string `json:"session"`    // Session ID from server
	Payload   string `json:"payload"`    // Base64-encoded payload
	ExpiresIn int64  `json:"expires_in"` // Seconds until expiry
	Error     string `json:"error,omitempty"`
}

type signingClient struct {
	conn   *websocket.Conn
	userID int64
	send   chan []byte
	state  signingState
	mu     sync.Mutex
}

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

type Handler struct {
	db             *sql.DB
	sessionManager *SessionManager
	rateLimiter    *util.RateLimiter
	cfg            config.SSHCAConfig
	allowedOrigins []string
}

func NewHandler(db *sql.DB, cfg config.SSHCAConfig, rpOrigin string) *Handler {
	origins := []string{rpOrigin}
	if rpOrigin != "http://localhost:8080" && rpOrigin != "http://localhost:5173" {
		origins = append(origins, "http://localhost:8080", "http://localhost:5173")
	}
	return &Handler{
		db:             db,
		sessionManager: NewSessionManager(),
		rateLimiter:    util.NewRateLimiter(cfg.RateLimitPerMin, time.Minute),
		cfg:            cfg,
		allowedOrigins: origins,
	}
}

func (h *Handler) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	for _, allowed := range h.allowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

// PublicKeyHandler returns the CA public key for the authenticated user.
// GET /api/v1/sshca/public-key
func (h *Handler) PublicKeyHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		ca, err := db.GetSSHCA(h.db, userID)
		if err != nil {
			slog.Error("failed to get SSH CA", "error", err, "user_id", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if ca == nil {
			http.Error(w, "SSH CA not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{
			"public_key": base64.StdEncoding.EncodeToString(ca.PublicKey),
		}); err != nil {
			slog.Error("failed to encode public key response", "error", err)
		}
	}
}

// ClientShareHandler returns the encrypted client share for the authenticated user.
// GET /api/v1/sshca/client-share
func (h *Handler) ClientShareHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		encryptedShare, err := db.GetClientShare(h.db, userID)
		if err != nil {
			slog.Error("failed to get client share", "error", err, "user_id", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if encryptedShare == nil {
			http.Error(w, "client share not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{
			"encrypted_share": base64.StdEncoding.EncodeToString(encryptedShare),
		}); err != nil {
			slog.Error("failed to encode client share response", "error", err)
		}
	}
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
		c.sendError(fmt.Sprintf("unknown message type: %s", msg.Type))
	}
}

// handleRequestCert processes a certificate request, validates host ownership,
// creates the TBS certificate data, and returns a session ID to the client.
func (h *Handler) handleRequestCert(client *signingClient, msg *wsMessage) {
	if msg.HostID == 0 {
		client.sendError("host_id is required")
		return
	}

	host, err := db.GetHostByID(h.db, msg.HostID)
	if err != nil {
		client.sendError("failed to get host")
		h.logCertIssuance(client.userID, msg.HostID, nil, false, "failed to get host")
		return
	}
	if host == nil || host.UserID != client.userID {
		client.sendError("host not found or access denied")
		h.logCertIssuance(client.userID, msg.HostID, nil, false, "host not found or access denied")
		return
	}

	ca, err := db.GetSSHCA(h.db, client.userID)
	if err != nil {
		client.sendError("failed to get CA")
		h.logCertIssuance(client.userID, msg.HostID, nil, false, "failed to get CA")
		return
	}
	if ca == nil {
		client.sendError("SSH CA not configured")
		h.logCertIssuance(client.userID, msg.HostID, nil, false, "SSH CA not configured")
		return
	}

	if !h.rateLimiter.Allow(client.userID) {
		client.sendError("rate limit exceeded")
		h.logCertIssuance(client.userID, msg.HostID, nil, false, "rate limit exceeded")
		return
	}

	validSeconds := h.cfg.CertValiditySecs
	if validSeconds <= 0 {
		validSeconds = 60
	}
	if validSeconds > 300 {
		validSeconds = 300
	}

	serial, err := db.IncrementCertSerial(h.db, client.userID)
	if err != nil {
		client.sendError("failed to get serial")
		h.logCertIssuance(client.userID, msg.HostID, nil, false, "failed to get serial")
		return
	}

	principal := host.SSHPrincipal
	if principal == "" {
		principal = host.SSHUser
	}
	if principal == "" {
		client.sendError("no principal configured for host")
		h.logCertIssuance(client.userID, msg.HostID, nil, false, "no principal configured for host")
		return
	}

	cert, err := CreateTBSCertificate(ca.PublicKey, principal, uint64(serial), validSeconds)
	if err != nil {
		client.sendError("failed to create certificate")
		logSerial := serial
		h.logCertIssuance(client.userID, msg.HostID, &logSerial, false, "failed to create certificate: "+err.Error())
		return
	}

	tbsData := cert.Marshal()

	client.state.cert = cert
	client.state.caPublicKey = ca.PublicKey

	session, err := h.sessionManager.CreateSession(client.userID, msg.HostID, tbsData)
	if err != nil {
		client.sendError("failed to create session")
		logSerial := serial
		h.logCertIssuance(client.userID, msg.HostID, &logSerial, false, "failed to create session")
		return
	}

	client.state.sessionID = session.ID
	client.state.hostID = msg.HostID
	client.state.tbsData = tbsData
	client.state.certSerial = serial
	client.state.cert = cert
	client.state.caPublicKey = ca.PublicKey

	resp := wsResponse{
		Type:      "session",
		Session:   session.ID,
		Payload:   base64.StdEncoding.EncodeToString(tbsData),
		ExpiresIn: int64(session.ExpiresAt.Sub(time.Now()).Seconds()),
	}
	client.sendResponse(resp)

	slog.Debug("certificate request processed", "user_id", client.userID, "host_id", msg.HostID, "serial", serial)
}

// handleRound1 processes FROST round 1: receives client's commitment,
// computes server's commitment, and returns it to the client.
func (h *Handler) handleRound1(client *signingClient, msg *wsMessage) {
	if client.state.sessionID == "" {
		client.sendError("no active session")
		return
	}

	if msg.Session != client.state.sessionID {
		client.sendError("session mismatch")
		return
	}

	clientCommitment, err := base64.StdEncoding.DecodeString(msg.Payload)
	if err != nil {
		client.sendError("invalid commitment payload")
		return
	}

	client.state.clientCommitment = clientCommitment

	ca, err := db.GetSSHCA(h.db, client.userID)
	if err != nil {
		client.sendError("failed to get CA")
		return
	}
	if ca == nil {
		client.sendError("SSH CA not configured")
		return
	}

	serverCommitment, frostState, err := ServerRound1(
		ca.ServerShare,
		ca.ServerVerifyingShare,
		ca.ClientVerifyingShare,
		ca.PublicKey,
		client.state.tbsData,
	)
	if err != nil {
		client.sendError("failed to perform round 1")
		h.sessionManager.DeleteSession(client.state.sessionID)
		logSerial := client.state.certSerial
		h.logCertIssuance(client.userID, client.state.hostID, &logSerial, false, "round 1 failed: "+err.Error())
		return
	}

	err = h.sessionManager.UpdateSession(client.state.sessionID, nil, serverCommitment)
	if err != nil {
		ZeroSigningState(frostState)
		client.sendError("failed to update session")
		h.sessionManager.DeleteSession(client.state.sessionID)
		logSerial := client.state.certSerial
		h.logCertIssuance(client.userID, client.state.hostID, &logSerial, false, "failed to update session")
		return
	}

	client.state.frostState = frostState

	resp := wsResponse{
		Type:    "commitment",
		Session: client.state.sessionID,
		Payload: base64.StdEncoding.EncodeToString(serverCommitment),
	}
	client.sendResponse(resp)

	slog.Debug("round 1 completed", "user_id", client.userID, "session", client.state.sessionID)
}

// handleRound2 processes FROST round 2: receives client's partial signature,
// computes server's partial, aggregates signatures, and returns the final certificate.
func (h *Handler) handleRound2(client *signingClient, msg *wsMessage) {
	if client.state.sessionID == "" {
		client.sendError("no active session")
		return
	}

	if msg.Session != client.state.sessionID {
		client.sendError("session mismatch")
		return
	}

	if client.state.clientCommitment == nil {
		client.sendError("client commitment not received in round 1")
		return
	}

	if client.state.frostState == nil {
		client.sendError("signing state not initialized")
		return
	}

	_, err := h.sessionManager.GetSession(client.state.sessionID)
	if err != nil {
		client.sendError("session expired or not found")
		logSerial := client.state.certSerial
		h.logCertIssuance(client.userID, client.state.hostID, &logSerial, false, "session expired")
		return
	}

	clientPartial, err := base64.StdEncoding.DecodeString(msg.Payload)
	if err != nil {
		client.sendError("invalid partial signature payload")
		return
	}

	serverPartial, err := ServerRound2(
		client.state.frostState,
		client.state.clientCommitment,
		client.state.tbsData,
	)
	if err != nil {
		client.sendError("failed to compute server partial signature")
		h.sessionManager.DeleteSession(client.state.sessionID)
		logSerial := client.state.certSerial
		h.logCertIssuance(client.userID, client.state.hostID, &logSerial, false, "round 2 failed: "+err.Error())
		return
	}

	finalSig, err := AggregateSignatures(
		client.state.frostState,
		serverPartial,
		clientPartial,
		client.state.clientCommitment,
		client.state.tbsData,
	)
	if err != nil {
		client.sendError("failed to aggregate signatures")
		h.sessionManager.DeleteSession(client.state.sessionID)
		logSerial := client.state.certSerial
		h.logCertIssuance(client.userID, client.state.hostID, &logSerial, false, "aggregation failed: "+err.Error())
		return
	}

	certBytes, err := BuildSignedCertificate(client.state.cert, finalSig, client.state.caPublicKey)
	if err != nil {
		client.sendError("failed to build certificate")
		h.sessionManager.DeleteSession(client.state.sessionID)
		logSerial := client.state.certSerial
		h.logCertIssuance(client.userID, client.state.hostID, &logSerial, false, "certificate build failed: "+err.Error())
		return
	}

	resp := wsResponse{
		Type:    "certificate",
		Session: client.state.sessionID,
		Payload: base64.StdEncoding.EncodeToString(certBytes),
	}
	client.sendResponse(resp)

	logSerial := client.state.certSerial
	h.logCertIssuance(client.userID, client.state.hostID, &logSerial, true, "")

	slog.Debug("certificate issued", "user_id", client.userID, "session", client.state.sessionID)
}

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

func (c *signingClient) sendError(errMsg string) {
	resp := wsResponse{
		Type:  "error",
		Error: errMsg,
	}
	c.sendResponse(resp)
}

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

func (h *Handler) logCertIssuance(userID, hostID int64, serial *int64, success bool, errMsg string) {
	if err := db.LogCertIssuance(h.db, userID, &hostID, serial, success, errMsg); err != nil {
		slog.Error("failed to log cert issuance", "error", err)
	}
}
