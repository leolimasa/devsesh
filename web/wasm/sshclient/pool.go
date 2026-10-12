package main

import (
	"sort"
	"time"
)

// The browser keeps one SSH connection per host so switching back to a host's
// session needs no new handshake or unlock. Left alone, that pool only grows,
// and every pooled connection is one of the user's (limited) WebSocket slots on
// the server. Past the server's per-user limit a new host is refused and the
// terminal cycles Connecting/Error. So the pool is bounded:
//
//   - at most maxPooledConns connections are kept, and it is kept BELOW the
//     server's default limit (DEVSESH_SSH_MAX_CONNECTIONS, 5) so a second tab or
//     device still has room;
//   - a connection that has not been the active one for idleReleaseAfter is let go.
//
// Releasing a connection only drops the SSH link. The tmux session keeps running
// on the host, and coming back reconnects and re-attaches.
const (
	maxPooledConns   = 3
	idleReleaseAfter = 10 * time.Minute
)

// poolEvictions returns the keys of pooled connections to release. It never
// returns the active connection or a handshake that is genuinely in flight.
// Everything else goes if it is dead (torn down, not connecting) or has been idle
// for idleAfter; then, if the pool is still over max, the least recently active
// connections go until it fits. Pure (no locking, no js) so it can be unit-tested.
func poolEvictions(conns map[string]*hostConn, active string, now time.Time, max int, idleAfter time.Duration) []string {
	var evict []string
	type idle struct {
		key string
		at  time.Time
	}
	var keep []idle
	protected := 0 // the active connection and in-flight handshakes always stay

	for key, c := range conns {
		switch {
		case key == active:
			protected++
		case c.connecting && now.Sub(c.connectingSince) < connectStaleAfter:
			protected++
		case !c.connected:
			evict = append(evict, key)
		case now.Sub(c.lastActive) >= idleAfter:
			evict = append(evict, key)
		default:
			keep = append(keep, idle{key, c.lastActive})
		}
	}

	if over := protected + len(keep) - max; over > 0 {
		// Oldest first; the key breaks ties so the result is deterministic.
		sort.Slice(keep, func(i, j int) bool {
			if !keep[i].at.Equal(keep[j].at) {
				return keep[i].at.Before(keep[j].at)
			}
			return keep[i].key < keep[j].key
		})
		if over > len(keep) {
			over = len(keep)
		}
		for _, k := range keep[:over] {
			evict = append(evict, k.key)
		}
	}

	sort.Strings(evict)
	return evict
}

// poolPending returns the keys of connections that are still being set up. Pure
// so it can be unit-tested.
func poolPending(conns map[string]*hostConn) []string {
	var keys []string
	for key, c := range conns {
		if c.connecting && !c.connected {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys
}
