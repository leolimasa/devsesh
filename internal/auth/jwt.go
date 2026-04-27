package auth

import (
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID int64 `json:"sub"`
	HostID int64 `json:"host_id"`
	jwt.RegisteredClaims
}

func GenerateToken(secret string, userID int64, hostID int64, expiry time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID: userID,
		HostID: hostID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func ValidateToken(secret, tokenStr string) (*Claims, error) {
	parts := strings.Split(tokenStr, ".")
	slog.Info("ValidateToken entry", "input_len", len(tokenStr), "parts_count", len(parts))
	if len(parts) != 3 {
		slog.Error("Token parts validation", "got", len(parts), "parts", parts)
		return nil, fmt.Errorf("token must have 3 parts, got %d", len(parts))
	}

	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return claims, nil
}

func MustValidateToken(secret, tokenStr string) *Claims {
	claims, err := ValidateToken(secret, tokenStr)
	if err != nil {
		panic(err)
	}
	return claims
}
