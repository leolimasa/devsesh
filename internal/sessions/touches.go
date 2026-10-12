package sessions

import (
	"context"
	"database/sql"
	"log/slog"
	"sync"
	"time"

	"github.com/leolimasa/devsesh/internal/db"
)

// DefaultTouchFlushInterval is how often pending pings and activity are written.
// Every consumer of these times uses a window of 5 seconds or more (activity dot
// 5s, liveness 30s, stale cleanup 1h), so a stored value that is up to this old
// is invisible. Live dashboards get the fresh time from the broadcast instead.
const DefaultTouchFlushInterval = 2 * time.Second

// Touches batches session ping and activity times. Handlers call Ping/Activity,
// which only record the newest time per session in memory. A background loop
// writes everything pending in one transaction per interval, so the write rate
// no longer grows with the number of sessions or how busy they are (each write
// would otherwise cost its own fsyncs).
type Touches struct {
	database *sql.DB

	mu      sync.Mutex
	pending map[string]*db.SessionTouch
}

func NewTouches(database *sql.DB) *Touches {
	return &Touches{database: database, pending: make(map[string]*db.SessionTouch)}
}

func (t *Touches) entry(id string) *db.SessionTouch {
	e := t.pending[id]
	if e == nil {
		e = &db.SessionTouch{ID: id}
		t.pending[id] = e
	}
	return e
}

// Ping records a ping for the session. It never touches the database.
func (t *Touches) Ping(id string, at time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.entry(id).Ping = &at
}

// Activity records terminal activity for the session. It never touches the database.
func (t *Touches) Activity(id string, at time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.entry(id).Activity = &at
}

// Flush writes everything pending in one transaction. On failure the entries are
// put back (without replacing newer times recorded meanwhile), so the next flush
// retries them.
func (t *Touches) Flush() error {
	t.mu.Lock()
	batch := make([]db.SessionTouch, 0, len(t.pending))
	for _, e := range t.pending {
		batch = append(batch, *e)
	}
	t.pending = make(map[string]*db.SessionTouch)
	t.mu.Unlock()

	if len(batch) == 0 {
		return nil
	}
	if err := db.TouchSessions(t.database, batch); err != nil {
		t.mu.Lock()
		for _, b := range batch {
			e := t.entry(b.ID)
			if e.Ping == nil {
				e.Ping = b.Ping
			}
			if e.Activity == nil {
				e.Activity = b.Activity
			}
		}
		t.mu.Unlock()
		return err
	}
	return nil
}

// Run flushes every interval until ctx is cancelled, then flushes once more so
// nothing recorded before shutdown is lost. It returns after that final flush.
func (t *Touches) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err := t.Flush(); err != nil {
				slog.Error("failed to flush session touches", "error", err)
			}
		case <-ctx.Done():
			if err := t.Flush(); err != nil {
				slog.Error("failed to flush session touches on shutdown", "error", err)
			}
			return
		}
	}
}
