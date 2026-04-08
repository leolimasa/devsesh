package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
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
	
	if resp.StatusCode != http.StatusOK {
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
