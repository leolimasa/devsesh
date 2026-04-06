package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRequestPairingCode_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(PairingResponse{Code: "ABC123"})
	}))
	defer server.Close()

	client := NewAPIClient(server.URL, "")
	code, err := client.RequestPairingCode()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != "ABC123" {
		t.Errorf("expected code ABC123, got %s", code)
	}
}

func TestRequestPairingCode_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := NewAPIClient(server.URL, "")
	_, err := client.RequestPairingCode()
	if err == nil {
		t.Error("expected error, got nil")
	}
}

func TestPollForJWT_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(JWTResponse{Token: "jwt-token-123"})
	}))
	defer server.Close()

	client := NewAPIClient(server.URL, "")
	token, err := client.PollForJWT("ABC123", 100*time.Millisecond)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token != "jwt-token-123" {
		t.Errorf("expected token jwt-token-123, got %s", token)
	}
}

func TestPollForJWT_Timeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewAPIClient(server.URL, "")
	_, err := client.PollForJWT("ABC123", 200*time.Millisecond)
	if err == nil {
		t.Error("expected error, got nil")
	}
}

func TestNotifySessionStart_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/sessions/test-id/start" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewAPIClient(server.URL, "test-token")
	sf := SessionFile{
		SessionID: "test-id",
		Name:      "Test Session",
		StartTime: time.Now(),
		Hostname:  "testhost",
		Cwd:       "/tmp",
	}
	err := client.NotifySessionStart("test-id", sf)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPingSession_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/sessions/test-id/ping" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewAPIClient(server.URL, "test-token")
	err := client.PingSession("test-id")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNotifySessionEnd_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/sessions/test-id/end" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewAPIClient(server.URL, "test-token")
	err := client.NotifySessionEnd("test-id")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUpdateSessionMeta_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/sessions/test-id/meta" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewAPIClient(server.URL, "test-token")
	meta := map[string]any{"project": "myproject"}
	err := client.UpdateSessionMeta("test-id", meta)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
