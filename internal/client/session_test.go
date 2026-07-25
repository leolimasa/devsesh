package client

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestNewSessionFile(t *testing.T) {
	sf, err := NewSessionFile("test-id", "Test Session")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sf.SessionID != "test-id" {
		t.Errorf("expected session ID 'test-id', got %s", sf.SessionID)
	}
	if sf.Name != "Test Session" {
		t.Errorf("expected name 'Test Session', got %s", sf.Name)
	}
	if sf.StartTime.IsZero() {
		t.Error("expected start time to be set")
	}
	if sf.Hostname == "" {
		t.Error("expected hostname to be set")
	}
	if sf.Cwd == "" {
		t.Error("expected cwd to be set")
	}
}

func TestWriteSessionFile(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "session.yml")

	sf := &SessionFile{
		SessionID: "test-id",
		Name:      "Test Session",
		StartTime: time.Now(),
		Hostname:  "testhost",
		Cwd:       "/tmp",
		Extra:     map[string]string{"key1": "value1"},
	}

	if err := WriteSessionFile(path, sf); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(data) == 0 {
		t.Error("expected non-empty file")
	}
}

func TestReadSessionFile(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "session.yml")

	sf := &SessionFile{
		SessionID: "test-id",
		Name:      "Test Session",
		StartTime: time.Now(),
		Hostname:  "testhost",
		Cwd:       "/tmp",
	}
	WriteSessionFile(path, sf)

	readSf, err := ReadSessionFile(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if readSf.SessionID != "test-id" {
		t.Errorf("expected session ID 'test-id', got %s", readSf.SessionID)
	}
	if readSf.Name != "Test Session" {
		t.Errorf("expected name 'Test Session', got %s", readSf.Name)
	}
}

func TestReadSessionFile_ExtraFields(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "session.yml")

	os.WriteFile(path, []byte(`session_id: test-id
name: Test Session
start_time: "2024-01-01T00:00:00Z"
hostname: testhost
cwd: /tmp
project: myproject
branch: main
`), 0600)

	readSf, err := ReadSessionFile(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if readSf.Extra["project"] != "myproject" {
		t.Errorf("expected extra field 'project', got %s", readSf.Extra["project"])
	}
	if readSf.Extra["branch"] != "main" {
		t.Errorf("expected extra field 'branch', got %s", readSf.Extra["branch"])
	}
}

func TestUpdateSessionFile(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "session.yml")

	sf := &SessionFile{
		SessionID: "test-id",
		Name:      "Test Session",
		StartTime: time.Now(),
		Hostname:  "testhost",
		Cwd:       "/tmp",
	}
	WriteSessionFile(path, sf)

	if err := UpdateSessionFile(path, "project", "myproject"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	readSf, err := ReadSessionFile(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if readSf.Extra["project"] != "myproject" {
		t.Errorf("expected extra field 'project', got %s", readSf.Extra["project"])
	}
}

func TestWatchSessionFile_DetectsChanges(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "session.yml")

	sf := &SessionFile{
		SessionID: "test-id",
		Name:      "Test Session",
		StartTime: time.Now(),
		Hostname:  "testhost",
		Cwd:       "/tmp",
	}
	if err := WriteSessionFile(path, sf); err != nil {
		t.Fatalf("failed to write session file: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	wg := &sync.WaitGroup{}

	changed := make(chan SessionFile, 1)
	if err := WatchSessionFile(ctx, wg, path, 50*time.Millisecond, func(s SessionFile) {
		select {
		case changed <- s:
		default:
		}
	}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Let the watcher goroutine start before modifying the file.
	time.Sleep(100 * time.Millisecond)

	if err := UpdateSessionFile(path, "foo", "bar"); err != nil {
		t.Fatalf("failed to update session file: %v", err)
	}

	select {
	case s := <-changed:
		if s.Extra["foo"] != "bar" {
			t.Errorf("expected extra foo=bar, got %v", s.Extra)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("watcher did not detect the file change within 3s")
	}

	cancel()
	wg.Wait()
}

func TestWatchSessionFile_Debounce(t *testing.T) {
	t.Skip("fsnotify test flaky - skipping for now")
}

func TestWatchSessionFile_ContextCancel(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "session.yml")

	sf := &SessionFile{
		SessionID: "test-id",
		Name:      "Test Session",
		StartTime: time.Now(),
		Hostname:  "testhost",
		Cwd:       "/tmp",
	}
	WriteSessionFile(path, sf)

	ctx, cancel := context.WithCancel(context.Background())
	wg := &sync.WaitGroup{}

	err := WatchSessionFile(ctx, wg, path, 50*time.Millisecond, func(s SessionFile) {})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	time.Sleep(50 * time.Millisecond)

	cancel()
	wg.Wait()
}
