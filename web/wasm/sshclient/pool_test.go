package main

import (
	"reflect"
	"testing"
	"time"
)

func TestPoolEvictions(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	ago := func(d time.Duration) time.Time { return now.Add(-d) }
	live := func(lastActive time.Time) *hostConn { return &hostConn{connected: true, lastActive: lastActive} }

	cases := []struct {
		name   string
		conns  map[string]*hostConn
		active string
		max    int
		want   []string
	}{
		{
			name:   "nothing to release when the pool is small and recent",
			conns:  map[string]*hostConn{"a": live(ago(time.Minute)), "b": live(ago(2 * time.Minute))},
			active: "a", max: 3,
			want: nil,
		},
		{
			name: "releases connections idle past the limit",
			conns: map[string]*hostConn{
				"a": live(now),
				"b": live(ago(11 * time.Minute)),
				"c": live(ago(5 * time.Minute)),
			},
			active: "a", max: 3,
			want: []string{"b"},
		},
		{
			name: "over the cap, the least recently active go first",
			conns: map[string]*hostConn{
				"a": live(now),
				"b": live(ago(4 * time.Minute)),
				"c": live(ago(1 * time.Minute)),
				"d": live(ago(3 * time.Minute)),
				"e": live(ago(2 * time.Minute)),
			},
			active: "a", max: 3,
			// 5 pooled, max 3: drop 2 oldest non-active (b at 4m, d at 3m).
			want: []string{"b", "d"},
		},
		{
			name: "the active connection counts toward the cap but is never released",
			conns: map[string]*hostConn{
				"a": live(ago(time.Hour)), // active, and very old
				"b": live(ago(1 * time.Minute)),
				"c": live(ago(2 * time.Minute)),
			},
			active: "a", max: 2,
			want: []string{"c"},
		},
		{
			name: "a handshake in flight is never cut off and counts toward the cap",
			conns: map[string]*hostConn{
				"a": live(now),
				"b": {connecting: true, connectingSince: ago(5 * time.Second)},
				"c": live(ago(1 * time.Minute)),
				"d": live(ago(2 * time.Minute)),
			},
			active: "a", max: 3,
			want: []string{"d"},
		},
		{
			name: "a wedged handshake and torn-down leftovers are released",
			conns: map[string]*hostConn{
				"a": live(now),
				"b": {connecting: true, connectingSince: ago(10 * time.Minute)},
				"c": {}, // dead: neither connected nor connecting
			},
			active: "a", max: 3,
			want: []string{"b", "c"},
		},
		{
			name: "an empty pool, or no active host, is fine",
			conns: map[string]*hostConn{
				"a": live(ago(time.Minute)),
				"b": live(ago(2 * time.Minute)),
			},
			active: "", max: 1,
			want: []string{"b"},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := poolEvictions(c.conns, c.active, now, c.max, idleReleaseAfter)
			if len(got) == 0 && len(c.want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

// The cap has to stay under the server's default per-user limit (5), or a second
// tab or device could never connect.
func TestPoolCapIsBelowTheServerDefault(t *testing.T) {
	const serverDefaultLimit = 5
	if maxPooledConns >= serverDefaultLimit {
		t.Fatalf("maxPooledConns=%d must stay below the server default limit %d", maxPooledConns, serverDefaultLimit)
	}
	if maxPooledConns < 2 {
		t.Fatalf("maxPooledConns=%d: the pool needs room for the active host and one to switch back to", maxPooledConns)
	}
}

func TestPoolPending(t *testing.T) {
	conns := map[string]*hostConn{
		"live":    {connected: true},
		"waiting": {connecting: true},
		"dead":    {},
		"other":   {connecting: true},
	}
	got := poolPending(conns)
	want := []string{"other", "waiting"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// closeConn must abort a handshake that is still waiting: it closes the cancel
// channel (once; a second close would panic) so the connect lock is released.
func TestCloseConnCancelsAPendingHandshake(t *testing.T) {
	c := &hostConn{connecting: true, cancel: make(chan struct{})}
	closeConn(c)
	select {
	case <-c.cancel:
	default:
		t.Fatal("cancel channel was not closed")
	}
	closeConn(c) // idempotent: must not panic on the second call
	if c.connecting {
		t.Fatal("connection still marked as connecting")
	}
}

// A connect waiting for its turn on the global handshake lock must be cancellable;
// with a plain mutex one stuck handshake blocked every other host.
func TestConnectSemaphoreWaitIsCancellable(t *testing.T) {
	connectSem <- struct{}{} // another handshake holds the lock
	defer func() { <-connectSem }()

	cancel := make(chan struct{})
	got := make(chan string, 1)
	go func() {
		select {
		case connectSem <- struct{}{}:
			<-connectSem
			got <- "acquired"
		case <-cancel:
			got <- "cancelled"
		}
	}()
	close(cancel)
	if r := <-got; r != "cancelled" {
		t.Fatalf("waiter result = %s, want cancelled", r)
	}
}
