# Todo: Ping / Activity Overhaul

## Project Status

- 🟢 **Phase 1:** Foundation — Utils + Database
- 🟢 **Phase 2:** Server handlers + routes
- 🟢 **Phase 3:** Client library
- 🟢 **Phase 4:** CLI integration
- 🟢 **Phase 5:** Frontend
- 🟢 **Phase 6:** Documentation
- 🟢 **Phase 7:** Integration tests
- 🟢 **Phase 8:** Final verification

## Phase dependency plan

```
Phase 1 (Utils + DB)
  ├── Phase 2 (Server handlers)
  │     └── Phase 5 (Frontend)
  └── Phase 3 (Client library)
        └── Phase 4 (CLI integration)
              └── Phase 7 (Integration tests)
                    └── Phase 8 (Final verification)
Phase 6 (Docs) — independent, done last
```

- **Phase 1** — no dependencies. Must be done first.
- **Phase 2** and **Phase 3** can run in parallel (both depend only on Phase 1).
- **Phase 4** depends on Phase 3.
- **Phase 5** depends on Phase 2 (needs server emitting `activity` events).
- **Phase 6** (docs) — independent, can be done anytime after Phase 1.
- **Phase 7** depends on Phase 4 + Phase 5 (both CLI and frontend must work).
- **Phase 8** depends on Phase 7.

---

## Phase 1: Foundation — Utils + Database

### `internal/util/debounce.go` — add `Throttle` type

- [ ] Add `Throttle` struct with actor model (goroutine owning state via channels, no mutex) alongside the existing `Debouncer`. [req.ugzh7u] [req.quoywx]
- [ ] Implement `NewThrottle(interval time.Duration, fn func()) *Throttle` — starts actor goroutine, returns handle.
- [ ] Implement `Call()` — non-blocking; signals actor that a change occurred.
- [ ] Implement `Stop()` — flushes any pending trailing call and shuts actor down.
- [ ] Actor behavior: leading edge fires immediately if `now - lastFired >= interval`; calls inside window set `pending = true` and arm timer for `lastFired + interval`; timer fires with `pending` invokes `fn` and resets. [req.quoywx]

### `internal/util/debounce_test.go` — `Throttle` tests

- [ ] Test: leading call fires immediately.
- [ ] Test: burst within one window yields exactly one leading + one trailing call (proves mid-window changes are not discarded). [req.quoywx]
- [ ] Test: spacing never exceeds interval.
- [ ] Verify: `./test.sh` passes.

### SQL migration

- [ ] Create `sql/00019_add_last_activity_at_to_sessions.sql`:
  ```sql
  ALTER TABLE sessions ADD COLUMN last_activity_at DATETIME;
  ```

### `internal/db/queries.go` — struct + query changes

- [ ] Add `LastActivityAt *time.Time \`json:"last_activity_at"\`` to `Session` struct.
- [ ] Add `last_activity_at` to SELECT and scan in `GetSessionsByUserID`.
- [ ] Add `last_activity_at` to SELECT and scan in `GetSession`.
- [ ] Add `last_activity_at` to SELECT and scan in `GetSessionsWithHostByUserID`.
- [ ] `CreateSession` — include `last_activity_at` in INSERT (nullable, seeded same way as `last_ping_at` on start). [req.lgmngh]
- [ ] Add `func UpdateSessionActivity(db *sql.DB, id string, t time.Time) error` — `UPDATE sessions SET last_activity_at = ? WHERE id = ?`, modeled on `UpdateSessionPing`. [req.lgmngh]

### `internal/db/db_test.go` — DB changes tests

- [ ] Test: `UpdateSessionActivity` sets `last_activity_at` correctly.
- [ ] Test: session reads round-trip `last_activity_at`.
- [ ] Verify: `./test.sh` passes.

---

## Phase 2: Server handlers + routes

### `internal/sessions/handler.go` — add `ActivityHandler`

- [ ] Add `ActivityHandler(database *sql.DB, hub *Hub) http.HandlerFunc` — loads session from context, calls `db.UpdateSessionActivity`, sets `session.LastActivityAt`, broadcasts `SessionUpdate{Event: "activity", ...}`. [req.lgmngh] [req.dwt6ud]
- [ ] `PingHandler` — unchanged (already updates `last_ping_at` and broadcasts `ping`). [req.2s2rj8] [req.dwt6ud]

### `internal/server/server.go` — add route

- [ ] Add `POST /api/v1/sessions/{session_id}/activity` route, wired through `jwtMiddleware` + `RequireSessionOwner`, calling `sessions.ActivityHandler(database, hub)`. [req.lgmngh]

### `internal/sessions/handler_test.go` — handler tests

- [ ] Add `TestActivityHandler` — verifies `last_activity_at` is updated and `activity` event is broadcast. Mirrors existing `TestPingHandler`.
- [ ] Verify: `./test.sh` passes.

---

## Phase 3: Client library

### `internal/client/api.go` — add `SendActivity`

- [ ] Add `func (c *APIClient) SendActivity(sessionID string) error` — POSTs to `/api/v1/sessions/{id}/activity`, mirrors existing `PingSession`. [req.ugzh7u]

### `internal/client/api_test.go` — API client tests

- [ ] Add `TestSendActivity_Success` hitting `/api/v1/sessions/{id}/activity`. Mirrors `TestPingSession_Success`.
- [ ] Verify: `./test.sh` passes.

### `internal/client/tmux.go` — modify `OutputMonitor`

- [ ] Swap `util.Debouncer` for `util.Throttle` with a 1s interval in `OutputMonitor`. [req.ugzh7u]
- [ ] Rename `onOutput` field/param to `onActivity` for clarity.
- [ ] Remove dead `lastWrite` field (never read).
- [ ] Update `StartSession` signature: rename `onOutput` param to `onActivity`.
- [ ] `Write` method calls `throttle.Call()` on any terminal output.

### Verify client library compilation

- [ ] Run `./build.sh` to verify client library compiles.

---

## Phase 4: CLI integration

### `cmd/start.go` — decouple ping from activity

- [ ] Replace `onOutput` closure with `onActivity` that calls `apiClient.SendActivity(sessionID)`. Pass it to `StartSession`. [req.ugzh7u]
- [ ] Remove the old ping call from the output callback (ping is now driven independently).
- [ ] Add ping heartbeat goroutine: `time.Ticker(5 * time.Second)` under `signalCtx` (tracked by `wg`) calling `apiClient.PingSession(sessionID)`. Stops on `signalCtx.Done()`. [req.1a7c0q]
- [ ] Verify: `./build.sh` passes (compilation succeeds).

---

## Phase 5: Frontend

### TypeScript types

- [ ] `web/src/types/api.ts` — add `last_activity_at: string | null` to `Session` type.
- [ ] `web/src/types/api.ts` — extend `SessionUpdate` event union to `"start" | "ping" | "activity" | "end" | "meta"`. [req.t2od0w]

### `web/src/lib/session.ts` — redefine `isActive` [req.qi06bf]

- [ ] Return `false` if `session.ended_at` is set.
- [ ] Return `true` if `last_activity_at` is within last 5 seconds (`Date.now() - new Date(last_activity_at) < 5000`).
- [ ] Return `false` if `last_activity_at` is null (treat as inactive — fresh sessions are seeded with `last_activity_at` on creation).

### `web/src/pages/DashboardPage.tsx` [req.t2od0w]

- [ ] Verify `activity` and `ping` events flow through `handleUpdate` (already handles non-end events by replacing stored session — no branching change needed).
- [ ] Ensure `end`/`delete` removal branch is preserved.
- [ ] Surface last-activity alongside last-ping where useful.
- [ ] No interval tick — rely on WebSocket messages for re-renders.

### `web/src/pages/SessionDetailPage.tsx` [req.t2od0w]

- [ ] Verify `activity` and `ping` events update session state via `handleUpdate` (already matches on `session_id` — no branching change needed).
- [ ] No interval tick — rely on WebSocket messages for re-renders.

### `web/src/components/SessionTopBar.tsx`

- [ ] Verify it does not independently derive active/status. If it does, consume updated `isActive` semantics (no duplicated 5-minute rule).

### Web unit tests

- [ ] `web/src/lib/session.test.ts` (create if missing, or add to `utils.test.ts`) — test `isActive`:
  - [ ] Active within 5s of `last_activity_at`.
  - [ ] Inactive after 5s of no activity.
  - [ ] Ended session → inactive.
  - [ ] Null `last_activity_at` → inactive.
- [ ] Verify: `cd web && npm test` passes (or equivalent).

---

## Phase 6: Documentation [req.x6sv41]

- [ ] `README.md` — update ping/active behavior description to reflect ping (liveness, 5s heartbeat) vs activity (5s "active" window) split.
- [ ] `doc/ARCHITECTURE.md` — update session status description: add `activity` message, `/activity` endpoint, `last_activity_at` field.
- [ ] `doc/SERVER_ENDPOINTS.md` — add **Update Session Activity** section for `POST /api/v1/sessions/{session_id}/activity`.
- [ ] `doc/SERVER_ENDPOINTS.md` — update WebSocket Message Format event union to `"start|ping|activity|end|meta"`.
- [ ] `doc/TABLES.md` — add `last_activity_at` column to `sessions` table documentation.

---

## Phase 7: Integration tests

### `integration_tests/tests/session.spec.ts`

- [ ] Adjust existing `last_ping_at` test — assert 5s heartbeat updates `last_ping_at`. [req.1a7c0q] [req.2s2rj8]
- [ ] Add activity test: send input to tmux session, assert `last_activity_at` is set/recent and dashboard/detail show **Active**. [req.lgmngh] [req.qi06bf]
- [ ] Assert active decays to **Inactive** after ~5s of no output. [req.qi06bf]
- [ ] Assert both `ping` and `activity` events arrive over the updates WebSocket. [req.dwt6ud] [req.t2od0w]
- [ ] Verify: `./integration_tests/integration_tests.sh` passes.

---

## Phase 8: Final verification

- [ ] Run `./test.sh` — all Go unit tests pass. [req.garhw0] [req.i6hso6]
- [ ] Run `npm test` in `web/` — all web unit tests pass. [req.garhw0] [req.i6hso6]
- [ ] Run `./integration_tests/integration_tests.sh` — all integration tests pass. [req.garhw0] [req.i6hso6]
- [ ] Run `./build.sh` — full build succeeds.
