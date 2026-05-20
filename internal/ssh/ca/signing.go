package ca

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"log/slog"
	"time"

	"github.com/leolimasa/devsesh/internal/db"
	"golang.org/x/crypto/ssh"
)

// handleRequestCert processes a certificate request, validates host ownership,
// creates the TBS certificate data, and returns a session ID to the client.
// The client must provide their ephemeral public key (user_public_key) that will
// be included in the certificate. The client holds the corresponding private key
// and uses it for SSH authentication after receiving the signed certificate.
func (h *Handler) handleRequestCert(client *signingClient, msg *wsMessage) {
	if msg.HostID == 0 {
		client.sendError("host_id is required")
		return
	}

	if msg.UserPublicKey == "" {
		client.sendError("user_public_key is required")
		return
	}

	// Decode the user's ephemeral public key
	userPubKey, err := base64.StdEncoding.DecodeString(msg.UserPublicKey)
	if err != nil {
		client.sendError("invalid user_public_key: must be base64 encoded")
		return
	}
	if len(userPubKey) != 32 {
		client.sendError("invalid user_public_key: must be 32 bytes (Ed25519)")
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

	// Create certificate with the user's ephemeral public key
	cert, err := CreateTBSCertificate(ca.PublicKey, userPubKey, principal, uint64(serial), validSeconds)
	if err != nil {
		client.sendError("failed to create certificate")
		logSerial := serial
		h.logCertIssuance(client.userID, msg.HostID, &logSerial, false, "failed to create certificate: "+err.Error())
		return
	}

	// Get the bytes for signing: certificate without signature, and WITHOUT the
	// trailing 4-byte signature length field. This matches Go's ssh.Certificate.bytesForSigning().
	certBytes := cert.Marshal()
	tbsData := certBytes[:len(certBytes)-4]

	client.state.cert = cert
	client.state.caPublicKey = ca.PublicKey

	slog.Info("Certificate TBS created",
		"user_id", client.userID,
		"host_id", msg.HostID,
		"serial", serial,
		"caPublicKey_hex", fmt.Sprintf("%x", ca.PublicKey),
		"caPublicKey_len", len(ca.PublicKey),
	)

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

	// Debug: verify the signature before building certificate
	if !ed25519.Verify(ed25519.PublicKey(client.state.caPublicKey), client.state.tbsData, finalSig) {
		slog.Error("FROST signature verification FAILED",
			"user_id", client.userID,
			"session", client.state.sessionID,
			"sig_len", len(finalSig),
			"tbs_len", len(client.state.tbsData),
			"pubkey_len", len(client.state.caPublicKey),
		)
		client.sendError("signature verification failed")
		h.sessionManager.DeleteSession(client.state.sessionID)
		logSerial := client.state.certSerial
		h.logCertIssuance(client.userID, client.state.hostID, &logSerial, false, "signature verification failed")
		return
	}
	slog.Info("FROST signature verified successfully",
		"user_id", client.userID,
		"session", client.state.sessionID,
		"serial", client.state.certSerial,
		"sig_first_8", fmt.Sprintf("%x", finalSig[:8]),
		"sig_last_8", fmt.Sprintf("%x", finalSig[56:]),
		"tbs_len", len(client.state.tbsData),
		"tbs_first_8", fmt.Sprintf("%x", client.state.tbsData[:8]),
	)

	certBytes, err := BuildSignedCertificate(client.state.cert, finalSig, client.state.caPublicKey)
	if err != nil {
		client.sendError("failed to build certificate")
		h.sessionManager.DeleteSession(client.state.sessionID)
		logSerial := client.state.certSerial
		h.logCertIssuance(client.userID, client.state.hostID, &logSerial, false, "certificate build failed: "+err.Error())
		return
	}

	// Debug: verify the built certificate can be parsed and signature matches
	parsedPub, parseErr := ssh.ParsePublicKey(certBytes)
	if parseErr != nil {
		slog.Error("Failed to parse built certificate", "error", parseErr)
	} else {
		if parsedCert, ok := parsedPub.(*ssh.Certificate); ok {
			slog.Info("Built certificate details",
				"cert_type", parsedCert.Type(),
				"serial", parsedCert.Serial,
				"principals", parsedCert.ValidPrincipals,
				"sig_format", parsedCert.Signature.Format,
				"sig_len", len(parsedCert.Signature.Blob),
				"sig_first_8", fmt.Sprintf("%x", parsedCert.Signature.Blob[:8]),
			)
		}
	}

	// Debug: log the exact base64 being sent
	certBase64 := base64.StdEncoding.EncodeToString(certBytes)
	slog.Info("Certificate being sent to client",
		"cert_bytes_len", len(certBytes),
		"cert_base64_len", len(certBase64),
		"cert_first_32", fmt.Sprintf("%x", certBytes[:32]),
		"cert_last_32", fmt.Sprintf("%x", certBytes[len(certBytes)-32:]),
	)

	resp := wsResponse{
		Type:    "certificate",
		Session: client.state.sessionID,
		Payload: base64.StdEncoding.EncodeToString(certBytes),
		Serial:  client.state.certSerial,
	}
	client.sendResponse(resp)

	logSerial := client.state.certSerial
	h.logCertIssuance(client.userID, client.state.hostID, &logSerial, true, "")

	slog.Debug("certificate issued", "user_id", client.userID, "session", client.state.sessionID)
}

// logCertIssuance logs a certificate issuance attempt to the audit log.
func (h *Handler) logCertIssuance(userID, hostID int64, serial *int64, success bool, errMsg string) {
	if err := db.LogCertIssuance(h.db, userID, &hostID, serial, success, errMsg); err != nil {
		slog.Error("failed to log cert issuance", "error", err)
	}
}
