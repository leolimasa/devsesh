package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"
)

type APIClient struct {
	serverURL string
	jwtToken  string
	httpClient *http.Client
}

type PairingResponse struct {
	Code string `json:"code"`
}

type JWTResponse struct {
	Token string `json:"token"`
}

type SessionStartRequest struct {
	SessionID string    `json:"session_id"`
	Name      string    `json:"name"`
	StartTime time.Time `json:"start_time"`
	Hostname  string    `json:"hostname"`
	Cwd       string    `json:"cwd"`
	Extra     map[string]string `json:"extra,omitempty"`
}

// ServerHost is the subset of a session's host record the CLI cares about.
type ServerHost struct {
	Label    string `json:"label"`
	Hostname string `json:"hostname"`
}

// ServerSession mirrors the server's session record (internal/db.Session) for
// the fields the CLI consumes: reuse (id, name, started_at, metadata) and the
// `list` view (ended/ping timestamps, host).
type ServerSession struct {
	ID             string      `json:"id"`
	Name           string      `json:"name"`
	StartedAt      time.Time   `json:"started_at"`
	LastPingAt     *time.Time  `json:"last_ping_at"`
	LastActivityAt *time.Time  `json:"last_activity_at"`
	EndedAt        *time.Time  `json:"ended_at"`
	Metadata       *string     `json:"metadata"`
	Host           *ServerHost `json:"host,omitempty"`
}

func NewAPIClient(serverURL, jwtToken string) *APIClient {
	return &APIClient{
		serverURL:  serverURL,
		jwtToken:   jwtToken,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *APIClient) RequestPairingCode() (string, error) {
	url := c.serverURL + "/api/v1/auth/pair/start"
	
	req, err := http.NewRequest("POST", url, nil)
	if err != nil {
		slog.Error("failed to create request", "error", err, "url", url)
		return "", err
	}
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		slog.Error("failed to execute request", "error", err, "url", url)
		return "", err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		err := fmt.Errorf("server returned status %d: %s", resp.StatusCode, string(body))
		slog.Error("request failed", "error", err, "status", resp.StatusCode)
		return "", err
	}
	
	var pairingResp PairingResponse
	if err := json.NewDecoder(resp.Body).Decode(&pairingResp); err != nil {
		slog.Error("failed to decode pairing response", "error", err)
		return "", err
	}
	
	return pairingResp.Code, nil
}

func (c *APIClient) PollForJWT(code string, timeout time.Duration) (string, error) {
	pollURL := c.serverURL + "/api/v1/auth/pair/complete"
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	
	timeoutCh := time.After(timeout)
	
	token, err := c.pollJWTOnce(pollURL, code)
	if err == nil {
		return token, nil
	}
	
	for {
		select {
		case <-timeoutCh:
			return "", fmt.Errorf("timeout waiting for JWT")
		case <-ticker.C:
			token, err := c.pollJWTOnce(pollURL, code)
			if err == nil {
				return token, nil
			}
		}
	}
}

func (c *APIClient) pollJWTOnce(url, code string) (string, error) {
	body, _ := json.Marshal(map[string]string{"code": code})
	
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(body))
	if err != nil {
		slog.Error("failed to create JWT poll request", "error", err, "url", url)
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		slog.Error("failed to execute JWT poll request", "error", err, "url", url)
		return "", err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		// Don't log - 400 is expected while waiting for code approval
		return "", fmt.Errorf("server returned status %d", resp.StatusCode)
	}
	
	var jwtResp JWTResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwtResp); err != nil {
		slog.Error("failed to decode JWT response", "error", err)
		return "", err
	}
	
	return jwtResp.Token, nil
}

func (c *APIClient) doRequest(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	var bodyBuf io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			slog.Error("failed to marshal request body", "error", err, "path", path)
			return nil, err
		}
		bodyBuf = bytes.NewBuffer(data)
	}
	
	req, err := http.NewRequestWithContext(ctx, method, c.serverURL+path, bodyBuf)
	if err != nil {
		slog.Error("failed to create request", "error", err, "method", method, "path", path)
		return nil, err
	}
	
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	
	if c.jwtToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.jwtToken)
	}
	
	return c.httpClient.Do(req)
}

func (c *APIClient) NotifySessionStart(sessionID string, sessionData SessionFile) error {
	ctx := context.Background()
	
	reqBody := SessionStartRequest{
		SessionID: sessionData.SessionID,
		Name:      sessionData.Name,
		StartTime: sessionData.StartTime,
		Hostname:  sessionData.Hostname,
		Cwd:       sessionData.Cwd,
		Extra:     sessionData.Extra,
	}
	
	resp, err := c.doRequest(ctx, "POST", "/api/v1/sessions/"+sessionID+"/start", reqBody)
	if err != nil {
		slog.Error("failed to send session start notification", "error", err, "session_id", sessionID)
		return err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		err := fmt.Errorf("server returned status %d: %s", resp.StatusCode, string(body))
		slog.Error("session start notification failed", "error", err, "session_id", sessionID, "status", resp.StatusCode)
		return err
	}

	return nil
}

func (c *APIClient) PingSession(sessionID string) error {
	ctx := context.Background()
	
	resp, err := c.doRequest(ctx, "POST", "/api/v1/sessions/"+sessionID+"/ping", nil)
	if err != nil {
		slog.Error("failed to send ping", "error", err, "session_id", sessionID)
		return err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		err := fmt.Errorf("server returned status %d: %s", resp.StatusCode, string(body))
		slog.Error("ping failed", "error", err, "session_id", sessionID, "status", resp.StatusCode)
		return err
	}
	
	return nil
}

func (c *APIClient) SendActivity(sessionID string) error {
	ctx := context.Background()

	resp, err := c.doRequest(ctx, "POST", "/api/v1/sessions/"+sessionID+"/activity", nil)
	if err != nil {
		slog.Error("failed to send activity", "error", err, "session_id", sessionID)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		err := fmt.Errorf("server returned status %d: %s", resp.StatusCode, string(body))
		slog.Error("activity failed", "error", err, "session_id", sessionID, "status", resp.StatusCode)
		return err
	}

	return nil
}

func (c *APIClient) NotifySessionEnd(sessionID string) error {
	ctx := context.Background()
	
	resp, err := c.doRequest(ctx, "POST", "/api/v1/sessions/"+sessionID+"/end", nil)
	if err != nil {
		slog.Error("failed to send session end notification", "error", err, "session_id", sessionID)
		return err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		err := fmt.Errorf("server returned status %d: %s", resp.StatusCode, string(body))
		slog.Error("session end notification failed", "error", err, "session_id", sessionID, "status", resp.StatusCode)
		return err
	}
	
	return nil
}

func (c *APIClient) UpdateSessionMeta(sessionID string, meta map[string]any) error {
	ctx := context.Background()
	
	resp, err := c.doRequest(ctx, "POST", "/api/v1/sessions/"+sessionID+"/meta", meta)
	if err != nil {
		slog.Error("failed to update session meta", "error", err, "session_id", sessionID)
		return err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		err := fmt.Errorf("server returned status %d: %s", resp.StatusCode, string(body))
		slog.Error("session meta update failed", "error", err, "session_id", sessionID, "status", resp.StatusCode)
		return err
	}
	
	return nil
}

// ListSessions returns all of the authenticated user's sessions as the server
// knows them (across every host). Used by `devsesh list`.
func (c *APIClient) ListSessions() ([]ServerSession, error) {
	resp, err := c.doRequest(context.Background(), "GET", "/api/v1/sessions", nil)
	if err != nil {
		slog.Error("failed to list sessions", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server returned status %d: %s", resp.StatusCode, string(body))
	}

	var sessions []ServerSession
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		slog.Error("failed to decode sessions", "error", err)
		return nil, err
	}
	return sessions, nil
}

// GetSessionByName looks up an existing session for this (name, host) pair --
// host is inferred server-side from the caller's credentials. Returns nil (no
// error) when none exists, so `devsesh start` can fall through to creating a
// fresh session.
func (c *APIClient) GetSessionByName(name string) (*ServerSession, error) {
	path := "/api/v1/sessions/by-name?name=" + url.QueryEscape(name)
	resp, err := c.doRequest(context.Background(), "GET", path, nil)
	if err != nil {
		slog.Error("failed to look up session by name", "error", err, "name", name)
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server returned status %d: %s", resp.StatusCode, string(body))
	}

	var s ServerSession
	if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
		slog.Error("failed to decode session", "error", err)
		return nil, err
	}
	return &s, nil
}

// SendClipboard pushes raw clipboard text (the stdin of `devsesh copy`) to the
// server for a session, which broadcasts it to the user's browsers. The body is
// sent as raw UTF-8 text (not JSON) -- the server bounds the size and rejects
// non-text. A non-204 response surfaces the server's message (e.g. 413/400).
func (c *APIClient) SendClipboard(sessionID string, content []byte) error {
	url := c.serverURL + "/api/v1/sessions/" + sessionID + "/clipboard"

	req, err := http.NewRequest("POST", url, bytes.NewReader(content))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "text/plain; charset=utf-8")
	if c.jwtToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.jwtToken)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("clipboard push failed (%s): %s", resp.Status, body)
	}
	return nil
}
