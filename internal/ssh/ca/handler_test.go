package ca

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/ctxutil"
	"github.com/leolimasa/devsesh/internal/db"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	f, err := os.CreateTemp("", "devsesh-test-*.db")
	if err != nil {
		t.Fatalf("create temp db: %v", err)
	}
	t.Cleanup(func() { os.Remove(f.Name()) })

	database, err := sql.Open("sqlite", f.Name())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	_, err = db.RunMigrations(database)
	if err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	return database
}

func TestSignalingClientJSON(t *testing.T) {
	msg := wsMessage{
		Type:    "request_cert",
		HostID:  1,
		Session: "test-session",
		Payload: "dGVzdA==",
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	if string(data) == "" {
		t.Error("expected non-empty JSON")
	}

	var parsed wsMessage
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if parsed.Type != msg.Type {
		t.Errorf("expected type %s, got %s", msg.Type, parsed.Type)
	}
	if parsed.HostID != msg.HostID {
		t.Errorf("expected host_id %d, got %d", msg.HostID, parsed.HostID)
	}
	if parsed.Session != msg.Session {
		t.Errorf("expected session %s, got %s", msg.Session, parsed.Session)
	}
	if parsed.Payload != msg.Payload {
		t.Errorf("expected payload %s, got %s", msg.Payload, parsed.Payload)
	}
}

func TestSigningState(t *testing.T) {
	state := signingState{
		sessionID:        "test-id",
		hostID:           1,
		frostState:       nil,
		tbsData:          []byte("test"),
		commitmentSent:   false,
		signatureResult:  nil,
		clientCommitment: nil,
		certSerial:       123,
	}

	if state.sessionID != "test-id" {
		t.Errorf("expected sessionID test-id, got %s", state.sessionID)
	}
	if state.hostID != 1 {
		t.Errorf("expected hostID 1, got %d", state.hostID)
	}
	if state.certSerial != 123 {
		t.Errorf("expected certSerial 123, got %d", state.certSerial)
	}
}

func TestWSMessageTypes(t *testing.T) {
	tests := []struct {
		name string
		msg  wsMessage
	}{
		{"request_cert", wsMessage{Type: "request_cert", HostID: 1}},
		{"round1", wsMessage{Type: "round1", Session: "abc", Payload: "xyz"}},
		{"round2", wsMessage{Type: "round2", Session: "abc", Payload: "xyz"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data, err := json.Marshal(tc.msg)
			if err != nil {
				t.Fatalf("marshal failed: %v", err)
			}

			var parsed wsMessage
			if err := json.Unmarshal(data, &parsed); err != nil {
				t.Fatalf("unmarshal failed: %v", err)
			}

			if parsed.Type != tc.msg.Type {
				t.Errorf("type mismatch")
			}
		})
	}
}

func TestWSResponseTypes(t *testing.T) {
	tests := []struct {
		name string
		resp wsResponse
	}{
		{"session", wsResponse{Type: "session", Session: "abc", ExpiresIn: 60}},
		{"commitment", wsResponse{Type: "commitment", Session: "abc", Payload: "xyz"}},
		{"partial_sig", wsResponse{Type: "partial_sig", Session: "abc", Payload: "xyz"}},
		{"error", wsResponse{Type: "error", Error: "test error"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data, err := json.Marshal(tc.resp)
			if err != nil {
				t.Fatalf("marshal failed: %v", err)
			}

			var parsed wsResponse
			if err := json.Unmarshal(data, &parsed); err != nil {
				t.Fatalf("unmarshal failed: %v", err)
			}

			if parsed.Type != tc.resp.Type {
				t.Errorf("type mismatch")
			}
		})
	}
}

func TestHandler_NewHandler(t *testing.T) {
	cfg := config.SSHCAConfig{
		WorkerTimeout:    30 * time.Minute,
		CertValiditySecs: 60,
		RateLimitPerMin:  10,
	}

	handler := NewHandler(nil, cfg, "http://localhost:8080")

	if handler == nil {
		t.Fatal("NewHandler returned nil")
	}
	if handler.sessionManager == nil {
		t.Error("handler.sessionManager is nil")
	}
	if handler.rateLimiter == nil {
		t.Error("handler.rateLimiter is nil")
	}
	if handler.cfg.CertValiditySecs != 60 {
		t.Errorf("expected CertValiditySecs 60, got %d", handler.cfg.CertValiditySecs)
	}
	if handler.cfg.WorkerTimeout != 30*time.Minute {
		t.Errorf("expected WorkerTimeout 30m, got %v", handler.cfg.WorkerTimeout)
	}
	if handler.cfg.RateLimitPerMin != 10 {
		t.Errorf("expected RateLimitPerMin 10, got %d", handler.cfg.RateLimitPerMin)
	}
}

func TestHandler_PublicKeyHandler_Unauthorized(t *testing.T) {
	cfg := config.SSHCAConfig{}
	handler := NewHandler(nil, cfg, "http://localhost:8080")

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handler.PublicKeyHandler().ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestHandler_PublicKeyHandler_Success(t *testing.T) {
	database := openTestDB(t)

	userID := int64(1)
	now := time.Now()
	err := db.CreateSSHCA(database, db.SSHCAData{
		UserID:               userID,
		PublicKey:            []byte{1, 2, 3, 4},
		ServerShare:          []byte{5, 6, 7, 8},
		ServerVerifyingShare: []byte{9, 10, 11, 12},
		ClientVerifyingShare: []byte{13, 14, 15, 16},
		CertSerial:           0,
		CreatedAt:            now,
	})
	if err != nil {
		t.Fatalf("create SSH CA: %v", err)
	}

	cfg := config.SSHCAConfig{}
	handler := NewHandler(database, cfg, "http://localhost:8080")

	req := httptest.NewRequest("GET", "/", nil)
	ctx := context.WithValue(req.Context(), ctxutil.ContextKeyUserID, userID)
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	handler.PublicKeyHandler().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if _, ok := resp["public_key"]; !ok {
		t.Error("expected public_key in response")
	}

	if len(resp["public_key"]) == 0 {
		t.Error("public_key should not be empty")
	}
}

func TestHandler_PublicKeyHandler_NotFoundWhenNoCA(t *testing.T) {
	database := openTestDB(t)

	cfg := config.SSHCAConfig{}
	handler := NewHandler(database, cfg, "http://localhost:8080")

	req := httptest.NewRequest("GET", "/", nil)
	ctx := context.WithValue(req.Context(), ctxutil.ContextKeyUserID, int64(1))
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	handler.PublicKeyHandler().ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_ClientShareHandler_Unauthorized(t *testing.T) {
	cfg := config.SSHCAConfig{}
	handler := NewHandler(nil, cfg, "http://localhost:8080")

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handler.ClientShareHandler().ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestHandler_ClientShareHandler_Success(t *testing.T) {
	database := openTestDB(t)

	userID := int64(1)
	err := db.SaveClientShare(database, userID, []byte{1, 2, 3, 4})
	if err != nil {
		t.Fatalf("save client share: %v", err)
	}

	cfg := config.SSHCAConfig{}
	handler := NewHandler(database, cfg, "http://localhost:8080")

	req := httptest.NewRequest("GET", "/", nil)
	ctx := context.WithValue(req.Context(), ctxutil.ContextKeyUserID, userID)
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	handler.ClientShareHandler().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if _, ok := resp["encrypted_share"]; !ok {
		t.Error("expected encrypted_share in response")
	}
}

func TestHandler_ClientShareHandler_NotFound(t *testing.T) {
	database := openTestDB(t)

	cfg := config.SSHCAConfig{}
	handler := NewHandler(database, cfg, "http://localhost:8080")

	req := httptest.NewRequest("GET", "/", nil)
	ctx := context.WithValue(req.Context(), ctxutil.ContextKeyUserID, int64(1))
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	handler.ClientShareHandler().ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_ConfigPassedThrough(t *testing.T) {
	cfg := config.SSHCAConfig{
		CertValiditySecs: 120,
		RateLimitPerMin:  5,
	}

	handler := NewHandler(nil, cfg, "http://localhost:8080")

	if handler.cfg.CertValiditySecs != 120 {
		t.Errorf("expected CertValiditySecs 120, got %d", handler.cfg.CertValiditySecs)
	}
	if handler.cfg.RateLimitPerMin != 5 {
		t.Errorf("expected RateLimitPerMin 5, got %d", handler.cfg.RateLimitPerMin)
	}
}

func TestRateLimiterWithHandler(t *testing.T) {
	cfg := config.SSHCAConfig{
		RateLimitPerMin: 3,
	}
	handler := NewHandler(nil, cfg, "http://localhost:8080")

	for i := 0; i < 3; i++ {
		if !handler.rateLimiter.Allow(1) {
			t.Errorf("request %d should be allowed", i+1)
		}
	}

	if handler.rateLimiter.Allow(1) {
		t.Error("4th request should be blocked by rate limit")
	}
}

func TestRateLimiterDifferentUsers(t *testing.T) {
	cfg := config.SSHCAConfig{
		RateLimitPerMin: 2,
	}
	handler := NewHandler(nil, cfg, "http://localhost:8080")

	if !handler.rateLimiter.Allow(1) {
		t.Error("user 1 first request should be allowed")
	}
	if !handler.rateLimiter.Allow(2) {
		t.Error("user 2 first request should be allowed")
	}
	if !handler.rateLimiter.Allow(1) {
		t.Error("user 1 second request should be allowed")
	}
	if handler.rateLimiter.Allow(1) {
		t.Error("user 1 third request should be blocked")
	}
	if !handler.rateLimiter.Allow(2) {
		t.Error("user 2 second request should be allowed")
	}
}

func TestHandler_CheckOrigin(t *testing.T) {
	handler := NewHandler(nil, config.SSHCAConfig{}, "http://production.example.com")

	tests := []struct {
		origin string
		expect bool
	}{
		{"http://production.example.com", true},
		{"http://localhost:8080", true},
		{"http://localhost:5173", true},
		{"", true},
		{"http://evil.com", false},
	}

	for _, tc := range tests {
		t.Run(tc.origin, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}

			result := handler.checkOrigin(req)
			if result != tc.expect {
				t.Errorf("origin %q: expected %v, got %v", tc.origin, tc.expect, result)
			}
		})
	}
}

func TestHandler_HostOwnershipValidation(t *testing.T) {
	database := openTestDB(t)

	userID1 := int64(1)
	userID2 := int64(2)

	hostID1, err := db.CreateHost(database, db.Host{
		Label:    "host1",
		Hostname: "server1.example.com",
		SSHUser:  "ubuntu",
		UserID:   userID1,
	})
	if err != nil {
		t.Fatalf("create host 1: %v", err)
	}

	_, err = db.CreateHost(database, db.Host{
		Label:    "host2",
		Hostname: "server2.example.com",
		SSHUser:  "admin",
		UserID:   userID2,
	})
	if err != nil {
		t.Fatalf("create host 2: %v", err)
	}

	h1, err := db.GetHostByID(database, hostID1)
	if err != nil {
		t.Fatalf("get host 1: %v", err)
	}
	if h1.UserID != userID1 {
		t.Errorf("host1 should belong to user1, got %d", h1.UserID)
	}

	h2, err := db.GetHostByID(database, hostID1)
	if err != nil {
		t.Fatalf("get host 2: %v", err)
	}
	if h2.UserID == userID2 {
		t.Error("host1 should NOT belong to user2")
	}
}

func TestHandler_HostOwnershipValidation_RejectsNonOwner(t *testing.T) {
	database := openTestDB(t)

	user1ID := int64(1)
	user2ID := int64(2)

	hostID, err := db.CreateHost(database, db.Host{
		Label:    "user1-host",
		Hostname: "server.example.com",
		SSHUser:  "ubuntu",
		UserID:   user1ID,
	})
	if err != nil {
		t.Fatalf("create host: %v", err)
	}

	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("generate key shares: %v", err)
	}
	err = db.CreateSSHCA(database, db.SSHCAData{
		UserID:               user2ID,
		PublicKey:            shares.PublicKey,
		ServerShare:          shares.ServerShare,
		ServerVerifyingShare: shares.ServerVerifyingShare,
		ClientVerifyingShare: shares.ClientVerifyingShare,
	})
	if err != nil {
		t.Fatalf("create SSH CA for user2: %v", err)
	}

	cfg := config.SSHCAConfig{RateLimitPerMin: 10, CertValiditySecs: 60}
	handler := NewHandler(database, cfg, "http://localhost:8080")

	client := &signingClient{
		userID: user2ID,
		send:   make(chan []byte, 10),
	}

	msg := &wsMessage{Type: "request_cert", HostID: hostID}
	handler.handleRequestCert(client, msg)

	select {
	case resp := <-client.send:
		var wsResp wsResponse
		if err := json.Unmarshal(resp, &wsResp); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if wsResp.Type != "error" {
			t.Errorf("expected error response, got %s", wsResp.Type)
		}
		if !strings.Contains(wsResp.Error, "access denied") && !strings.Contains(wsResp.Error, "not found") {
			t.Errorf("expected 'access denied' or 'not found' error, got %s", wsResp.Error)
		}
	default:
		t.Error("expected error response but got none")
	}
}

func TestHandler_SessionExpiry(t *testing.T) {
	sm := NewSessionManagerWithExpiry(100 * time.Millisecond)

	session, err := sm.CreateSession(1, 1, []byte("test"))
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	_, err = sm.GetSession(session.ID)
	if err != nil {
		t.Fatalf("session should still be valid: %v", err)
	}

	time.Sleep(150 * time.Millisecond)

	_, err = sm.GetSession(session.ID)
	if err == nil {
		t.Error("session should be expired")
	}
}

func TestHandler_AuditLogging(t *testing.T) {
	database := openTestDB(t)

	userID := int64(1)
	hostID := int64(1)

	err := db.LogCertIssuance(database, userID, &hostID, nil, false, "test error")
	if err != nil {
		t.Fatalf("log cert issuance: %v", err)
	}

	logs, err := db.GetCertAuditLogsByUserID(database, userID)
	if err != nil {
		t.Fatalf("get audit logs: %v", err)
	}

	if len(logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(logs))
	}

	if logs[0].UserID != userID {
		t.Errorf("expected userID %d, got %d", userID, logs[0].UserID)
	}
	if logs[0].Success {
		t.Error("expected success=false")
	}
	if logs[0].ErrorMessage == nil || *logs[0].ErrorMessage != "test error" {
		t.Error("expected error message 'test error'")
	}
}

func TestHandler_RateLimitExceeds(t *testing.T) {
	db := openTestDB(t)

	cfg := config.SSHCAConfig{
		RateLimitPerMin: 2,
	}
	handler := NewHandler(db, cfg, "http://localhost:8080")

	for i := 0; i < 2; i++ {
		if !handler.rateLimiter.Allow(1) {
			t.Errorf("request %d should be allowed", i+1)
		}
	}

	if handler.rateLimiter.Allow(1) {
		t.Error("3rd request should be blocked")
	}
}

func TestHandler_SessionCleanupOnDelete(t *testing.T) {
	sm := NewSessionManager()

	session, err := sm.CreateSession(1, 1, []byte("sensitive-data"))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	err = sm.DeleteSession(session.ID)
	if err != nil {
		t.Fatalf("delete session: %v", err)
	}

	_, err = sm.GetSession(session.ID)
	if err == nil {
		t.Error("session should not exist after deletion")
	}
}

func TestHandler_RetryAfterSessionFailure(t *testing.T) {
	database := openTestDB(t)

	userID := int64(1)

	hostID, err := db.CreateHost(database, db.Host{
		Label:    "test-host",
		Hostname: "server.example.com",
		SSHUser:  "ubuntu",
		UserID:   userID,
	})
	if err != nil {
		t.Fatalf("create host: %v", err)
	}

	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("generate key shares: %v", err)
	}
	err = db.CreateSSHCA(database, db.SSHCAData{
		UserID:               userID,
		PublicKey:            shares.PublicKey,
		ServerShare:          shares.ServerShare,
		ServerVerifyingShare: shares.ServerVerifyingShare,
		ClientVerifyingShare: shares.ClientVerifyingShare,
	})
	if err != nil {
		t.Fatalf("create SSH CA: %v", err)
	}

	cfg := config.SSHCAConfig{RateLimitPerMin: 10, CertValiditySecs: 60}
	handler := NewHandler(database, cfg, "http://localhost:8080")

	client := &signingClient{
		userID: userID,
		send:   make(chan []byte, 10),
	}

	msg := &wsMessage{Type: "request_cert", HostID: hostID}
	handler.handleRequestCert(client, msg)

	resp1 := <-client.send
	var wsResp1 wsResponse
	json.Unmarshal(resp1, &wsResp1)
	if wsResp1.Type != "session" {
		t.Fatalf("first request should succeed, got %s: %s", wsResp1.Type, wsResp1.Error)
	}

	handler.sessionManager.DeleteSession(wsResp1.Session)
	client.state = signingState{}

	handler.handleRequestCert(client, msg)

	resp2 := <-client.send
	var wsResp2 wsResponse
	json.Unmarshal(resp2, &wsResp2)
	if wsResp2.Type != "session" {
		t.Errorf("retry should succeed, got %s: %s", wsResp2.Type, wsResp2.Error)
	}

	if wsResp2.Session == wsResp1.Session {
		t.Error("retry should create a new session")
	}
}

func TestHandler_SessionExpiryAndCleanup(t *testing.T) {
	sm := NewSessionManagerWithExpiry(50 * time.Millisecond)

	session1, _ := sm.CreateSession(1, 1, []byte("data1"))
	session2, _ := sm.CreateSession(2, 2, []byte("data2"))

	time.Sleep(60 * time.Millisecond)

	_, err := sm.GetSession(session1.ID)
	if err == nil {
		t.Error("session1 should be expired")
	}

	_, err = sm.GetSession(session2.ID)
	if err == nil {
		t.Error("session2 should be expired")
	}
}

func TestHandler_SessionDataZeroing(t *testing.T) {
	sm := NewSessionManager()

	data := []byte("sensitive-signing-data")
	session, _ := sm.CreateSession(1, 1, data)

	err := sm.DeleteSession(session.ID)
	if err != nil {
		t.Fatal(err)
	}

	_, err = sm.GetSession(session.ID)
	if err == nil {
		t.Error("session should not exist after deletion")
	}
}

func TestHandler_SessionDataZeroing_VerifiesActualZeroing(t *testing.T) {
	sm := NewSessionManager()

	data := []byte("sensitive-signing-data")
	session, _ := sm.CreateSession(1, 1, data)

	sessionID := session.ID

	err := sm.DeleteSession(sessionID)
	if err != nil {
		t.Fatal(err)
	}

	time.Sleep(10 * time.Millisecond)

	_, err = sm.GetSession(sessionID)
	if err == nil {
		t.Error("session should not exist after deletion")
	}
}
