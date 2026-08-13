package client

import (
	"testing"
	"time"
)

func strptr(s string) *string { return &s }

// Metadata as POSTed by `devsesh set` meta updates: core fields flattened
// alongside extra keys (e.g. status).
func TestSessionFileFromServerFlattenedMeta(t *testing.T) {
	start := time.Now().Add(-time.Hour).Truncate(time.Second)
	s := ServerSession{
		ID:        "abc-123",
		Name:      "work",
		StartedAt: start,
		Metadata:  strptr(`{"name":"work","hostname":"devbox","cwd":"/home/leo/proj","status":"editing"}`),
	}

	sf := SessionFileFromServer(s)

	if sf.SessionID != "abc-123" {
		t.Errorf("SessionID = %q, want abc-123", sf.SessionID)
	}
	if sf.Name != "work" {
		t.Errorf("Name = %q, want work", sf.Name)
	}
	if !sf.StartTime.Equal(start) {
		t.Errorf("StartTime = %v, want %v", sf.StartTime, start)
	}
	if sf.Hostname != "devbox" {
		t.Errorf("Hostname = %q, want devbox", sf.Hostname)
	}
	if sf.Cwd != "/home/leo/proj" {
		t.Errorf("Cwd = %q, want /home/leo/proj", sf.Cwd)
	}
	if sf.Extra["status"] != "editing" {
		t.Errorf("Extra[status] = %q, want editing", sf.Extra["status"])
	}
}

// Metadata as POSTed at session start: extra keys nested under "extra".
func TestSessionFileFromServerNestedExtra(t *testing.T) {
	s := ServerSession{
		ID:        "def-456",
		Name:      "svc",
		StartedAt: time.Now(),
		Metadata:  strptr(`{"session_id":"def-456","name":"svc","hostname":"box","cwd":"/srv","extra":{"status":"waiting","role":"agent"}}`),
	}

	sf := SessionFileFromServer(s)

	if sf.Extra["status"] != "waiting" {
		t.Errorf("Extra[status] = %q, want waiting", sf.Extra["status"])
	}
	if sf.Extra["role"] != "agent" {
		t.Errorf("Extra[role] = %q, want agent", sf.Extra["role"])
	}
	// session_id in metadata must not leak into Extra; id stays authoritative.
	if _, ok := sf.Extra["session_id"]; ok {
		t.Error("Extra should not contain session_id")
	}
	if sf.SessionID != "def-456" {
		t.Errorf("SessionID = %q, want def-456", sf.SessionID)
	}
}

// Missing/empty metadata falls back to this host's values rather than erroring.
func TestSessionFileFromServerNoMetadata(t *testing.T) {
	s := ServerSession{
		ID:        "ghi-789",
		Name:      "bare",
		StartedAt: time.Now(),
		Metadata:  nil,
	}

	sf := SessionFileFromServer(s)

	if sf.SessionID != "ghi-789" || sf.Name != "bare" {
		t.Errorf("unexpected id/name: %q/%q", sf.SessionID, sf.Name)
	}
	if sf.Hostname == "" {
		t.Error("expected Hostname to fall back to this host")
	}
	if sf.Extra == nil {
		t.Error("expected Extra to be initialized")
	}
}
