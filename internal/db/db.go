package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"

	"github.com/leobeosab/devsesh/internal/config"
	_ "modernc.org/sqlite"
)

func Open(cfg config.Config) (*sql.DB, error) {
	db, err := sql.Open("sqlite", cfg.DBPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return db, nil
}

func ResolveJWTSecret(db *sql.DB, envSecret string) (string, error) {
	if envSecret != "" {
		return envSecret, nil
	}

	secret, err := GetConfigValue(db, "jwt_secret")
	if err == nil {
		return secret, nil
	}

	secret, err = generateRandomSecret()
	if err != nil {
		return "", fmt.Errorf("generate jwt secret: %w", err)
	}

	if err := SetConfigValue(db, "jwt_secret", secret); err != nil {
		return "", fmt.Errorf("persist jwt secret: %w", err)
	}

	return secret, nil
}

func generateRandomSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
