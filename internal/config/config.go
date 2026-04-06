package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	DBPath              string
	JWTSecret           string
	JWTExpiry           time.Duration
	JWTPairExpiry       time.Duration
	PairingCodeExpiry   time.Duration
	AllowUserCreation   bool
	Host                string
	Port                int
	MaintenanceInterval time.Duration
	RPID                string
	RPOrigin            string
}

func LoadFromEnv() Config {
	homeDir, _ := os.UserHomeDir()
	defaultDBPath := "devsesh.db"
	if homeDir != "" {
		defaultDBPath = homeDir + "/.devsesh/devsesh.db"
	}

	cfg := Config{
		DBPath:              getEnv("DEVSESH_DB_PATH", defaultDBPath),
		JWTSecret:           os.Getenv("DEVSESH_JWT_SECRET"),
		JWTExpiry:           parseDuration("DEVSESH_JWT_EXPIRY", 24*30*time.Hour),
		JWTPairExpiry:       parseDuration("DEVSESH_JWT_PAIR_EXPIRY", 720*time.Hour),
		PairingCodeExpiry:   parseDuration("DEVSESH_PAIRING_CODE_EXPIRY", 5*time.Minute),
		AllowUserCreation:   parseBool("DEVSESH_ALLOW_USER_CREATION", false),
		Host:                getEnv("DEVSESH_HOST", "localhost"),
		Port:                parseInt("DEVSESH_PORT", 8080),
		MaintenanceInterval: parseDuration("DEVSESH_MAINTENANCE_INTERVAL", 1*time.Hour),
		RPID:                getEnv("DEVSESH_RP_ID", "localhost"),
		RPOrigin:            getEnv("DEVSESH_RP_ORIGIN", fmt.Sprintf("http://localhost:%d", parseInt("DEVSESH_PORT", 8080))),
	}
	return cfg
}

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func parseDuration(key string, defaultVal time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return defaultVal
}

func parseBool(key string, defaultVal bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return defaultVal
}

func parseInt(key string, defaultVal int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return defaultVal
}
