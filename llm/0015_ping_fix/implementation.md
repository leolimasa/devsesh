# Implementation: Ping / Activity overhaul

This document describes how the requirements in `requirements.md` will be
implemented. The core idea is to split the single existing "ping-on-output"
signal into two independent signals:

- **ping** — a fixed 5s heartbeat proving the `devsesh start` process is alive
  (drives `last_ping_at`, liveness / stale-session cleanup).
- **activity** — a terminal-buffer-change signal, debounced to at most 1/sec but
  never silently dropped (drives `last_activity_at`, the "active" indicator).

Currently the client only pings, and it does so from the terminal output
monitor (debounced 500ms). That single path is being replaced: the output
monitor now emits `activity`, and a new timer emits `ping`.

---

## Data structures

### Database

**Modified table `sessions`** — new migration `sql/00019_add_last_activity_at_to_sessions.sql` (created).
Adds a nullable column so existing rows are unaffected:

```sql
ALTER TABLE sessions ADD COLUMN last_activity_at DATETIME;
```

`last_ping_at` is retained with its current meaning (liveness). [req.lgmngh]

### Go structs

**Modified `db.Session`** (`internal/db/queries.go`) — add field:

```go
LastActivityAt *time.Time `json:"last_activity_at"`
```

**Modified `sessions.SessionUpdate`** (`internal/sessions/websocket.go`) — no
struct change needed; the existing `Event string` field simply gains two valid
values (`"ping"` already exists, `"activity"` is new). [req.dwt6ud]

**New `util.Throttle`** (`internal/util/debounce.go`, added alongside
the existing `Debouncer`) — a leading+trailing throttle implemented as a
polling actor (single goroutine with an `atomic.Bool` flag, polled at
`interval/10`). This guarantees at most one callback invocation per
interval while never silently dropping a mid-window change: pending
activity is detected on the next poll and fired at the interval
boundary. [req.ugzh7u] [req.quoywx]

### TypeScript

**Modified `Session`** (`web/src/types/api.ts`) — add `last_activity_at: string | null`.

**Modified `SessionUpdate`** (`web/src/types/api.ts`) — extend event union to
`"start" | "ping" | "activity" | "end" | "meta"`. [req.t2od0w]

---

## Backend

### `internal/util/debounce.go` (modified — new `Throttle` added)

A polling-based leading+trailing throttle so the client can throttle `activity`
messages to 1/sec without ever dropping a change that happened mid-window.
Added next to the existing `Debouncer` (whose reset-on-every-call semantics are
kept for the file watcher); the new type is what the output monitor
uses. [req.ugzh7u] [req.quoywx]

- `NewThrottle(interval time.Duration, fn func()) *Throttle` —
  starts a polling actor goroutine and returns the handle.
- `Call()` — non-blocking; sets an `atomic.Bool` flag that the actor
  polls every `interval/10` (min 5ms).
- `Stop()` — flushes any pending call and shuts the actor down.

Actor behavior (single goroutine polls the pending flag):
- On each poll tick, if `now - lastFired >= interval` and the pending
  flag is set, invoke `fn` immediately (leading edge), clear the flag,
  and set `lastFired = now`.
- If the flag is still set at a subsequent poll tick (because
  `Call()` was invoked during the interval), invoke `fn` at the first
  poll after the interval boundary (trailing edge). This guarantees a
  change that occurred between two edges of the window still produces
  exactly one trailing message. [req.quoywx]

The polling design avoids the non-deterministic message dropping of Go's
`select { case ch <- msg: default: }` pattern (which can randomly choose
the default branch even when the channel has room) and keeps the actor
simple. The tradeoff is a bounded idle wakeup rate (at most
`1/(interval/10)` Hz) and a leading-edge delay of at most `interval/10`.

### `internal/client/tmux.go` (modified)

- `OutputMonitor` — swap `util.Debouncer` for `util.Throttle` with a 1s
  interval. The `Write` method still detects any terminal output (used as the
  screen-buffer-change signal) and calls `throttle.Call()`; the throttle emits
  the `onActivity` callback at most once per second. [req.ugzh7u]
- Rename the `onOutput` field/param to `onActivity` for clarity.
- Remove the dead `lastWrite` field (never read).
- `StartSession(..., onActivity func())` — signature parameter renamed; wiring
  otherwise unchanged (stdout/stderr still tee'd through the monitor).

### `cmd/start.go` (modified)

Decouple the two signals:

- Replace the current `onOutput` (which pinged) with `onActivity`, which calls a
  new `apiClient.SendActivity(sessionID)`. This fires on terminal buffer change
  (throttled by the monitor). [req.ugzh7u]
- Add a **ping heartbeat goroutine**: a `time.Ticker(5 * time.Second)` running
  under `signalCtx` (tracked by the existing `wg`) that calls
  `apiClient.PingSession(sessionID)` every 5s for as long as the tmux process
  (and thus `devsesh start`) is alive. It stops on `signalCtx.Done()`
  (i.e. when `tmuxCmd.Wait()` returns and `cancelSignal()` is called). [req.1a7c0q]

### `internal/client/api.go` (modified)

- **New** `func (c *APIClient) SendActivity(sessionID string) error` — POSTs to
  `/api/v1/sessions/{id}/activity`, mirroring the existing `PingSession`
  (same error handling / logging). [req.ugzh7u]
- `PingSession` — unchanged (still POSTs to `/ping`). [req.1a7c0q]

### `internal/db/queries.go` (modified)

- Add `LastActivityAt` scanning to every session read query:
  `GetSessionsByUserID`, `GetSession`, `GetSessionsWithHostByUserID` (add
  `last_activity_at` to each `SELECT`, scan into a `sql.NullString`, parse into
  `s.LastActivityAt`).
- `CreateSession` — include `last_activity_at` in the INSERT (nullable; seeded
  the same way `last_ping_at` is on start, so a brand-new session reads as
  freshly active).
- **New** `func UpdateSessionActivity(db *sql.DB, id string, t time.Time) error`
  — `UPDATE sessions SET last_activity_at = ? WHERE id = ?`, modeled on
  `UpdateSessionPing`. [req.lgmngh]
- `UpdateSessionPing` — unchanged. [req.2s2rj8]
- `DeleteStaleSessions` — unchanged (still keyed on `last_ping_at`, which
  remains the liveness field).

### `internal/sessions/handler.go` (modified)

- `PingHandler` — unchanged: updates `last_ping_at` and broadcasts a `ping`
  event. [req.2s2rj8] [req.dwt6ud]
- **New** `ActivityHandler(database *sql.DB, hub *Hub) http.HandlerFunc` —
  mirrors `PingHandler`: loads the session from context, calls
  `db.UpdateSessionActivity`, sets `session.LastActivityAt`, and broadcasts a
  `SessionUpdate{Event: "activity", ...}`. [req.lgmngh] [req.dwt6ud]

### `internal/server/server.go` (modified)

- **New route**: `POST /api/v1/sessions/{session_id}/activity` wired through the
  same `jwtMiddleware` + `RequireSessionOwner` chain as `/ping`, calling
  `sessions.ActivityHandler(database, hub)`. [req.lgmngh]

---

## Frontend

### `web/src/lib/session.ts` (modified) [req.qi06bf]

Redefine "active" to mean recent **activity** rather than recent ping:

- `isActive(session)` returns `false` if `ended_at` is set.
- Otherwise returns `true` when `last_activity_at` is within the last **5
  seconds** (`Date.now() - new Date(last_activity_at) < 5000`).
- If `last_activity_at` is null, treat as inactive (a session with no observed
  activity is not "active"). The freshly-started grace now comes from
  `CreateSession` seeding `last_activity_at`, so the badge lights up on start
  and decays after 5s of no output.

### `web/src/pages/DashboardPage.tsx` (modified) [req.t2od0w]

- `handleUpdate` already replaces the stored session for any non-end event, so
  incoming `ping` and `activity` updates (each carrying the full session object)
  update the model with no branching change required; verify `activity`/`ping`
  flow through and keep the `end`/`delete` removal branch.
- Rely on WebSocket messages to trigger re-renders (ping arrives every 5s,
  activity on terminal output). The badge may be at most 5s stale between pings,
  which is acceptable. No additional interval tick is needed.
- Surface activity where useful (e.g. show/relabel last-activity alongside
  last-ping) without removing the ping display.

### `web/src/pages/SessionDetailPage.tsx` (modified) [req.t2od0w]

- `handleUpdate` already applies any update whose `session_id` matches; `ping`
  and `activity` events update the session state as-is, which triggers
  re-computation of the active/inactive badge.
  No interval tick is needed.

### `web/src/components/SessionTopBar.tsx` (modified, if it renders status)

If the top bar derives active/status from the session, ensure it consumes the
updated `isActive` semantics (no logic of its own duplicating the 5-minute rule).

---

## Documentation [req.x6sv41]

- `README.md` — update any description of the ping/active behavior to reflect
  the ping (liveness, 5s) vs activity (5s "active" window) split.
- `doc/` — update the relevant design/architecture note describing session
  status, adding the `activity` message, the `/activity` endpoint, and the
  `last_activity_at` field.
- `doc/SERVER_ENDPOINTS.md` — add a new **Update Session Activity** section
  documenting `POST /api/v1/sessions/{session_id}/activity` (mirrors the Ping
  Session section). Update the WebSocket **Message Format** event union from
  `"start|ping|end|meta"` to `"start|ping|activity|end|meta"`.

---

## Tests [req.garhw0] [req.i6hso6]

### Go unit tests (modified / created)

- `internal/util/debounce_test.go` (modified) — cover `Throttle`:
  leading call fires immediately; a burst within one window yields exactly one
  leading + one trailing call (proving mid-window changes are not discarded
  [req.quoywx]); spacing never exceeds 1/interval.
- `internal/db/db_test.go` (modified) — cover `UpdateSessionActivity` and that
  session reads round-trip `last_activity_at`.
- `internal/sessions/handler_test.go` (modified) — add `TestActivityHandler`
  (updates `last_activity_at`, broadcasts `activity`), mirroring the existing
  `TestPingHandler`.
- `internal/client/api_test.go` (modified) — add `TestSendActivity_Success`
  hitting `/api/v1/sessions/{id}/activity`, mirroring `TestPingSession_Success`.

### Web unit tests (modified)

- `web/src/lib/utils.test.ts` / a `session.test.ts` — test the new `isActive`
  5-second-activity semantics (active within 5s, inactive after, ended → false,
  null activity → inactive).

### Integration tests (modified) — `integration_tests/tests/session.spec.ts`

- Keep/adjust the existing `last_ping_at` test — assert the 5s heartbeat sets
  `last_ping_at`. [req.1a7c0q] [req.2s2rj8]
- Add an activity test: send input to the tmux session, assert `last_activity_at`
  is set/recent and the session shows **Active** on dashboard and detail; then
  assert it decays to **Inactive** after ~5s of no output. [req.qi06bf] [req.lgmngh]
- Assert both `ping` and `activity` arrive over the updates websocket. [req.dwt6ud] [req.t2od0w]

All Go unit tests (`./test.sh`) and the full Playwright integration suite
(`./integration_tests/integration_tests.sh`) must pass before completion.
[req.garhw0] [req.i6hso6]
