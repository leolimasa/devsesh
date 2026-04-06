package client

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfig_DefaultPath(t *testing.T) {
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.SessionsDir == "" {
		t.Error("expected default sessions dir")
	}
}

func TestLoadConfig_EnvOverride(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yml")
	os.WriteFile(configPath, []byte("server_url: http://existing:8080\njwt_token: existing-token\n"), 0600)
	t.Setenv("DEVSESH_CONFIG_FILE", configPath)
	t.Setenv("DEVSESH_SERVER_URL", "http://test:8080")
	t.Setenv("DEVSESH_JWT_TOKEN", "test-token")
	t.Setenv("DEVSESH_SESSIONS_DIR", "/tmp/test-sessions")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.ServerURL != "http://test:8080" {
		t.Errorf("expected server URL to be overridden, got %s", cfg.ServerURL)
	}
	if cfg.JWTToken != "test-token" {
		t.Errorf("expected JWT token to be overridden, got %s", cfg.JWTToken)
	}
	if cfg.SessionsDir != "/tmp/test-sessions" {
		t.Errorf("expected sessions dir to be overridden, got %s", cfg.SessionsDir)
	}
}

func TestLoadConfig_InsecurePermissions(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yml")
	os.WriteFile(configPath, []byte("server_url: http://test\n"), 0644)
	t.Setenv("DEVSESH_CONFIG_FILE", configPath)

	_, err := LoadConfig()
	if err == nil {
		t.Error("expected error for insecure permissions")
	}
}

func TestLoadConfig_MissingFile(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "nonexistent.yml")
	t.Setenv("DEVSESH_CONFIG_FILE", configPath)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.SessionsDir == "" {
		t.Error("expected default sessions dir")
	}
}

func TestSaveConfig_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yml")
	t.Setenv("DEVSESH_CONFIG_FILE", configPath)

	cfg := ClientConfig{
		ServerURL:   "http://test:8080",
		JWTToken:    "test-token",
		SessionsDir: "/tmp/sessions",
	}

	if err := SaveConfig(cfg); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		t.Error("config file was not created")
	}
}

func TestSaveConfig_Permissions(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yml")
	t.Setenv("DEVSESH_CONFIG_FILE", configPath)

	cfg := ClientConfig{
		ServerURL: "http://test:8080",
		JWTToken:  "test-token",
	}

	SaveConfig(cfg)

	info, err := os.Stat(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Errorf("expected 0600 permissions, got %o", info.Mode().Perm())
	}
}

func TestDeleteConfig(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yml")
	t.Setenv("DEVSESH_CONFIG_FILE", configPath)

	os.WriteFile(configPath, []byte("server_url: test\n"), 0600)

	if err := DeleteConfig(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(configPath); !os.IsNotExist(err) {
		t.Error("config file was not deleted")
	}
}
