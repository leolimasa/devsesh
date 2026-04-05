package config

import (
	"os"
	"testing"
	"time"
)

func TestLoadFromEnvDefaults(t *testing.T) {
	// Clear all env vars to test defaults
	envVars := []string{
		"DEVSESH_DB_PATH", "DEVSESH_JWT_SECRET", "DEVSESH_JWT_EXPIRY",
		"DEVSESH_JWT_PAIR_EXPIRY", "DEVSESH_PAIRING_CODE_EXPIRY",
		"DEVSESH_ALLOW_USER_CREATION", "DEVSESH_PORT", "DEVSESH_MAINTENANCE_INTERVAL",
	}
	for _, k := range envVars {
		os.Unsetenv(k)
	}

	cfg := LoadFromEnv()

	if cfg.DBPath != "devsesh.db" {
		t.Errorf("expected DBPath 'devsesh.db', got '%s'", cfg.DBPath)
	}
	if cfg.JWTSecret != "" {
		t.Errorf("expected empty JWTSecret, got '%s'", cfg.JWTSecret)
	}
	if cfg.JWTExpiry != 24*time.Hour {
		t.Errorf("expected JWTExpiry 24h, got %v", cfg.JWTExpiry)
	}
	if cfg.JWTPairExpiry != 720*time.Hour {
		t.Errorf("expected JWTPairExpiry 720h, got %v", cfg.JWTPairExpiry)
	}
	if cfg.PairingCodeExpiry != 5*time.Minute {
		t.Errorf("expected PairingCodeExpiry 5m, got %v", cfg.PairingCodeExpiry)
	}
	if cfg.AllowUserCreation {
		t.Error("expected AllowUserCreation false")
	}
	if cfg.Port != 8080 {
		t.Errorf("expected Port 8080, got %d", cfg.Port)
	}
	if cfg.MaintenanceInterval != 1*time.Hour {
		t.Errorf("expected MaintenanceInterval 1h, got %v", cfg.MaintenanceInterval)
	}
}

func TestLoadFromEnvOverrides(t *testing.T) {
	os.Setenv("DEVSESH_DB_PATH", "/tmp/test.db")
	os.Setenv("DEVSESH_JWT_SECRET", "mysecret")
	os.Setenv("DEVSESH_JWT_EXPIRY", "48h")
	os.Setenv("DEVSESH_JWT_PAIR_EXPIRY", "720h")
	os.Setenv("DEVSESH_PAIRING_CODE_EXPIRY", "10m")
	os.Setenv("DEVSESH_ALLOW_USER_CREATION", "true")
	os.Setenv("DEVSESH_PORT", "9090")
	os.Setenv("DEVSESH_MAINTENANCE_INTERVAL", "30m")

	cfg := LoadFromEnv()

	if cfg.DBPath != "/tmp/test.db" {
		t.Errorf("expected DBPath '/tmp/test.db', got '%s'", cfg.DBPath)
	}
	if cfg.JWTSecret != "mysecret" {
		t.Errorf("expected JWTSecret 'mysecret', got '%s'", cfg.JWTSecret)
	}
	if cfg.JWTExpiry != 48*time.Hour {
		t.Errorf("expected JWTExpiry 48h, got %v", cfg.JWTExpiry)
	}
	if cfg.JWTPairExpiry != 720*time.Hour {
		t.Errorf("expected JWTPairExpiry 720h, got %v", cfg.JWTPairExpiry)
	}
	if cfg.PairingCodeExpiry != 10*time.Minute {
		t.Errorf("expected PairingCodeExpiry 10m, got %v", cfg.PairingCodeExpiry)
	}
	if !cfg.AllowUserCreation {
		t.Error("expected AllowUserCreation true")
	}
	if cfg.Port != 9090 {
		t.Errorf("expected Port 9090, got %d", cfg.Port)
	}
	if cfg.MaintenanceInterval != 30*time.Minute {
		t.Errorf("expected MaintenanceInterval 30m, got %v", cfg.MaintenanceInterval)
	}

	// Cleanup
	for _, k := range []string{
		"DEVSESH_DB_PATH", "DEVSESH_JWT_SECRET", "DEVSESH_JWT_EXPIRY",
		"DEVSESH_JWT_PAIR_EXPIRY", "DEVSESH_PAIRING_CODE_EXPIRY",
		"DEVSESH_ALLOW_USER_CREATION", "DEVSESH_PORT", "DEVSESH_MAINTENANCE_INTERVAL",
	} {
		os.Unsetenv(k)
	}
}
