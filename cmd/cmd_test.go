package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/leolimasa/devsesh/internal/client"
)

func TestStartCmd_NestedSessionError(t *testing.T) {
	os.Setenv("DEVSESH_SESSION_ID", "existing-session")
	defer os.Unsetenv("DEVSESH_SESSION_ID")

	cmd := NewStartCmd()
	if err := cmd.RunE(cmd, []string{}); err == nil {
		t.Error("expected error for nested session")
	}
}

func TestStartCmd_NotLoggedIn(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yml")
	os.WriteFile(configPath, []byte(""), 0600)
	os.Setenv("DEVSESH_CONFIG_FILE", configPath)
	defer os.Unsetenv("DEVSESH_CONFIG_FILE")

	cmd := NewStartCmd()
	if err := cmd.RunE(cmd, []string{}); err == nil {
		t.Error("expected error when not logged in")
	}
}

func TestSetCmd_NotInSession(t *testing.T) {
	os.Unsetenv("DEVSESH_SESSION_ID")

	cmd := NewSetCmd()
	if err := cmd.RunE(cmd, []string{"key", "value"}); err == nil {
		t.Error("expected error when not in session")
	}
}

func TestSetCmd_UpdatesFile(t *testing.T) {
	tmpDir := t.TempDir()
	sessionFile := filepath.Join(tmpDir, "test-session.yml")
	
	sf := &client.SessionFile{
		SessionID: "test-id",
		Name:      "Test Session",
	}
	client.WriteSessionFile(sessionFile, sf)
	
	os.Setenv("DEVSESH_SESSION_ID", "test-id")
	os.Setenv("DEVSESH_SESSION_FILE", sessionFile)
	defer os.Unsetenv("DEVSESH_SESSION_ID")
	defer os.Unsetenv("DEVSESH_SESSION_FILE")

	cmd := NewSetCmd()
	if err := cmd.RunE(cmd, []string{"project", "myproject"}); err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	updated, err := client.ReadSessionFile(sessionFile)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if updated.Extra["project"] != "myproject" {
		t.Errorf("expected project=myproject, got %s", updated.Extra["project"])
	}
}

func TestStopCmd_KillsSession(t *testing.T) {
	t.Skip("requires tmux")
}

func TestLogoutCmd_DeletesConfig(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yml")
	os.WriteFile(configPath, []byte("server_url: http://test\njwt_token: test\n"), 0600)
	os.Setenv("DEVSESH_CONFIG_FILE", configPath)
	defer os.Unsetenv("DEVSESH_CONFIG_FILE")

	cmd := NewLogoutCmd()
	if err := cmd.RunE(cmd, []string{}); err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	if _, err := os.Stat(configPath); !os.IsNotExist(err) {
		t.Error("config file was not deleted")
	}
}

func TestDeleteCmd_RejectsActive(t *testing.T) {
	t.Skip("requires tmux")
}

func TestResumeCmd_RejectsActive(t *testing.T) {
	t.Skip("requires tmux")
}
