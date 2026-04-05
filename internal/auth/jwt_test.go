package auth

import (
	"testing"
	"time"
)

func TestGenerateAndValidateToken(t *testing.T) {
	secret := "test-secret-key"
	userID := int64(42)
	expiry := time.Hour

	token, err := GenerateToken(secret, userID, expiry)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}

	claims, err := ValidateToken(secret, token)
	if err != nil {
		t.Fatalf("validate token: %v", err)
	}
	if claims.UserID != userID {
		t.Errorf("expected userID %d, got %d", userID, claims.UserID)
	}
}

func TestValidateTokenWrongSecret(t *testing.T) {
	token, _ := GenerateToken("secret1", 1, time.Hour)
	_, err := ValidateToken("secret2", token)
	if err == nil {
		t.Error("expected error for wrong secret")
	}
}

func TestValidateTokenExpired(t *testing.T) {
	token, _ := GenerateToken("secret", 1, -time.Hour)
	_, err := ValidateToken("secret", token)
	if err == nil {
		t.Error("expected error for expired token")
	}
}

func TestChallengeStore(t *testing.T) {
	cs := NewChallengeStore(100 * time.Millisecond)
	defer func() {
		cs.mu.Lock()
		for k := range cs.entries {
			delete(cs.entries, k)
		}
		cs.mu.Unlock()
	}()

	_, ok := cs.Get("test@example.com")
	if ok {
		t.Error("expected not found")
	}

	cs.Set("test@example.com", nil)

	_, ok = cs.Get("test@example.com")
	if !ok {
		t.Error("expected found after set")
	}

	cs.Delete("test@example.com")

	_, ok = cs.Get("test@example.com")
	if ok {
		t.Error("expected not found after delete")
	}
}

func TestChallengeStoreExpiry(t *testing.T) {
	cs := NewChallengeStore(50 * time.Millisecond)
	defer func() {
		cs.mu.Lock()
		for k := range cs.entries {
			delete(cs.entries, k)
		}
		cs.mu.Unlock()
	}()

	cs.Set("expire@example.com", nil)

	_, ok := cs.Get("expire@example.com")
	if !ok {
		t.Error("expected found immediately after set")
	}

	time.Sleep(150 * time.Millisecond)

	_, ok = cs.Get("expire@example.com")
	if ok {
		t.Error("expected not found after expiry")
	}
}

func TestResolveJWTSecretIntegration(t *testing.T) {
	// Integration test covered by internal/db tests
}
