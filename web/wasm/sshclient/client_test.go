package main

import (
	"testing"
	"time"
)

// TestCanReuse reproduces the "stuck on connecting" bug at the pool-reuse
// decision level. The old condition reused any entry with connecting==true, so
// a handshake wedged by an iOS background freeze was reused forever — the
// terminal never re-handshaked, never re-authenticated, and never prompted to
// unlock the master key again. canReuse must treat a stale "connecting" entry
// as NOT reusable so Connect tears it down and starts a fresh handshake.
func TestCanReuse(t *testing.T) {
	now := time.Now()

	cases := []struct {
		name string
		c    *hostConn
		want bool
	}{
		{"connected is reusable", &hostConn{connected: true}, true},
		{
			"fresh in-flight connecting is reusable",
			&hostConn{connecting: true, connectingSince: now},
			true,
		},
		{
			"connecting still within the stale cushion is reusable",
			&hostConn{connecting: true, connectingSince: now.Add(-30 * time.Second)},
			true,
		},
		{
			// The bug: a wedged connecting entry (frozen mid-handshake) used to
			// be reused indefinitely, pinning the UI at "connecting".
			"stale wedged connecting is NOT reusable",
			&hostConn{connecting: true, connectingSince: now.Add(-connectStaleAfter - time.Second)},
			false,
		},
		{"dead entry is NOT reusable", &hostConn{}, false},
	}

	for _, tc := range cases {
		if got := canReuse(tc.c, now); got != tc.want {
			t.Errorf("%s: canReuse = %v, want %v", tc.name, got, tc.want)
		}
	}
}
