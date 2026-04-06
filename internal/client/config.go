package client

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type ClientConfig struct {
	ServerURL   string
	JWTToken    string
	SessionsDir string
}

func ConfigPath() string {
	if path := os.Getenv("DEVSESH_CONFIG_FILE"); path != "" {
		return path
	}
	homeDir, _ := os.UserHomeDir()
	if homeDir == "" {
		return ".devsesh/config.yml"
	}
	return filepath.Join(homeDir, ".devsesh", "config.yml")
}

func LoadConfig() (*ClientConfig, error) {
	configPath := ConfigPath()

	cfg := &ClientConfig{
		SessionsDir: defaultSessionsDir(),
	}

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return cfg, nil
	}

	info, err := os.Stat(configPath)
	if err != nil {
		slog.Error("failed to stat config file", "error", err, "path", configPath)
		return nil, err
	}

	if info.Mode().Perm()&0077 != 0 {
		err := fmt.Errorf("config file has insecure permissions, expected 0600")
		slog.Error("insecure config permissions", "error", err, "path", configPath, "permissions", info.Mode().Perm())
		return nil, err
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		slog.Error("failed to read config file", "error", err, "path", configPath)
		return nil, err
	}

	var fileCfg struct {
		ServerURL   string `yaml:"server_url"`
		JWTToken    string `yaml:"jwt_token"`
		SessionsDir string `yaml:"sessions_dir"`
	}
	if err := yaml.Unmarshal(data, &fileCfg); err != nil {
		slog.Error("failed to parse config file", "error", err, "path", configPath)
		return nil, err
	}

	cfg.ServerURL = fileCfg.ServerURL
	cfg.JWTToken = fileCfg.JWTToken
	if fileCfg.SessionsDir != "" {
		cfg.SessionsDir = fileCfg.SessionsDir
	}

	if url := os.Getenv("DEVSESH_SERVER_URL"); url != "" {
		cfg.ServerURL = url
	}
	if token := os.Getenv("DEVSESH_JWT_TOKEN"); token != "" {
		cfg.JWTToken = token
	}
	if dir := os.Getenv("DEVSESH_SESSIONS_DIR"); dir != "" {
		cfg.SessionsDir = dir
	}

	return cfg, nil
}

func defaultSessionsDir() string {
	homeDir, _ := os.UserHomeDir()
	if homeDir == "" {
		return ".devsesh/sessions"
	}
	return filepath.Join(homeDir, ".devsesh", "sessions")
}

func SaveConfig(cfg ClientConfig) error {
	configPath := ConfigPath()
	dir := filepath.Dir(configPath)

	if err := os.MkdirAll(dir, 0700); err != nil {
		slog.Error("failed to create config directory", "error", err, "dir", dir)
		return err
	}

	data, err := yaml.Marshal(struct {
		ServerURL   string `yaml:"server_url"`
		JWTToken    string `yaml:"jwt_token"`
		SessionsDir string `yaml:"sessions_dir"`
	}{
		ServerURL:   cfg.ServerURL,
		JWTToken:    cfg.JWTToken,
		SessionsDir: cfg.SessionsDir,
	})
	if err != nil {
		slog.Error("failed to marshal config", "error", err)
		return err
	}

	if err := os.WriteFile(configPath, data, 0600); err != nil {
		slog.Error("failed to write config file", "error", err, "path", configPath)
		return err
	}

	return nil
}

func DeleteConfig() error {
	configPath := ConfigPath()
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return nil
	}
	if err := os.Remove(configPath); err != nil {
		slog.Error("failed to delete config file", "error", err, "path", configPath)
		return err
	}
	return nil
}
