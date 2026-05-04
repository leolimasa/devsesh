package util

import (
	"sync"
	"testing"
	"time"
)

func TestRateLimiterAllowsUpToLimit(t *testing.T) {
	rl := NewRateLimiter(5, 1*time.Second)

	for i := 0; i < 5; i++ {
		if !rl.Allow(1) {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}

	// 6th request should be denied
	if rl.Allow(1) {
		t.Fatal("6th request should be denied")
	}
}

func TestRateLimiterDifferentUsersIndependent(t *testing.T) {
	rl := NewRateLimiter(2, 1*time.Second)

	// User 1 uses up their limit
	rl.Allow(1)
	rl.Allow(1)

	// User 2 should still be allowed
	if !rl.Allow(2) {
		t.Fatal("user 2 should be allowed even though user 1 is rate limited")
	}
}

func TestRateLimiterWindowReset(t *testing.T) {
	rl := NewRateLimiter(2, 200*time.Millisecond)

	// Use up the limit
	rl.Allow(1)
	rl.Allow(1)

	// Should be denied
	if rl.Allow(1) {
		t.Fatal("should be denied after limit")
	}

	// Wait for window to pass
	time.Sleep(250 * time.Millisecond)

	// Should be allowed again
	if !rl.Allow(1) {
		t.Fatal("should be allowed after window expires")
	}
}

func TestRateLimiterConcurrentAccess(t *testing.T) {
	rl := NewRateLimiter(100, 1*time.Second)

	var wg sync.WaitGroup
	allowedCount := 0
	var mu sync.Mutex

	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if rl.Allow(1) {
				mu.Lock()
				allowedCount++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if allowedCount != 100 {
		t.Errorf("expected exactly 100 allowed requests, got %d", allowedCount)
	}
}
