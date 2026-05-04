package util

import (
	"time"
)

// rateLimitCmd represents a command sent to the RateLimiter actor.
type rateLimitCmd struct {
	userID int64
	respCh chan bool
}

// RateLimiter enforces per-user rate limits using the actor model.
// A single goroutine owns the timestamp map and processes commands
// sequentially via a channel.
type RateLimiter struct {
	cmdCh  chan rateLimitCmd
	limit  int
	window time.Duration
}

// NewRateLimiter creates a RateLimiter that allows up to `limit` requests
// per user within the specified `window` duration. It spawns an actor
// goroutine that owns the rate limit state and processes commands.
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		cmdCh:  make(chan rateLimitCmd, 100),
		limit:  limit,
		window: window,
	}
	go rl.actor()
	return rl
}

// actor is the main goroutine that owns the rate limit state.
// It tracks request timestamps per user and processes allow-check
// commands sequentially.
func (rl *RateLimiter) actor() {
	requests := make(map[int64][]time.Time)
	cleanupTicker := time.NewTicker(rl.window)
	defer cleanupTicker.Stop()

	for {
		select {
		case cmd := <-rl.cmdCh:
			now := time.Now()
			timestamps := requests[cmd.userID]

			// Filter out timestamps outside the current window
			validTimestamps := make([]time.Time, 0, len(timestamps))
			for _, ts := range timestamps {
				if now.Sub(ts) < rl.window {
					validTimestamps = append(validTimestamps, ts)
				}
			}

			// Check if user is within the rate limit
			allowed := len(validTimestamps) < rl.limit
			if allowed {
				validTimestamps = append(validTimestamps, now)
			}

			requests[cmd.userID] = validTimestamps
			cmd.respCh <- allowed

		case <-cleanupTicker.C:
			// Clean up old timestamps for all users
			now := time.Now()
			for userID, timestamps := range requests {
				validTimestamps := make([]time.Time, 0, len(timestamps))
				for _, ts := range timestamps {
					if now.Sub(ts) < rl.window {
						validTimestamps = append(validTimestamps, ts)
					}
				}
				if len(validTimestamps) == 0 {
					delete(requests, userID)
				} else {
					requests[userID] = validTimestamps
				}
			}
		}
	}
}

// Allow checks if a user is allowed to make another request.
// Returns true if the user is within the rate limit, false otherwise.
// This sends a check command to the actor and waits for the response.
func (rl *RateLimiter) Allow(userID int64) bool {
	respCh := make(chan bool, 1)
	rl.cmdCh <- rateLimitCmd{
		userID: userID,
		respCh: respCh,
	}
	return <-respCh
}
