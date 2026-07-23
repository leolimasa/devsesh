# Code Review: Ping / Activity Overhaul (0015)

## Summary
Splits the single "ping-on-output" signal into two independent signals: a fixed 5s **ping** heartbeat (liveness → `last_ping_at`) and a throttled **activity** signal on terminal buffer changes (→ new `last_activity_at`), and redefines the frontend "Active" badge to mean activity within the last 5 seconds.

## Requirements Coverage

- **[req.1a7c0q]** — Ping every 5s while `devsesh start` runs. ✅ `cmd/start.go` adds a `time.NewTicker(5s)` goroutine under `signalCtx` (tracked by `wg`) that calls `apiClient.PingSession`. Decoupled from output.
- **[req.2s2rj8]** — Server updates `last_ping_at` on ping. ✅ `PingHandler` unchanged, still calls `db.UpdateSessionPing`.
- **[req.ugzh7u]** — Emit `activity` on every buffer change, throttled to max 1/sec. ✅ `OutputMonitor.Write` calls `throttle.Call()`; `util.Throttle` with 1s interval; `onActivity` → `apiClient.SendActivity`.
- **[req.quoywx]** — Throttling must not discard mid-window changes. ✅ `Throttle` uses a leading + trailing (coalesced) design so a change mid-window still produces a trailing call. Covered by `TestThrottle_MidWindowChangeNotDiscarded`.
- **[req.lgmngh]** — On `activity`, update (create) `last_activity_at`. ✅ New migration `00019`, `UpdateSessionActivity`, `ActivityHandler`.
- **[req.dwt6ud]** — Broadcast both `ping` and `activity` over the sessions websocket. ✅ `ActivityHandler` broadcasts `SessionUpdate{Event:"activity"}`; `PingHandler` broadcasts `"ping"`. TS union extended.
- **[req.qi06bf]** — "Active" = activity within last 5s. ✅ `web/src/lib/session.ts` `isActive` now checks `Date.now() - last_activity_at < 5000`, `false` if `ended_at` set or `last_activity_at` null.
- **[req.t2od0w]** — Frontend listens for `activity` and `ping` and updates the model. ⚠️ Partial — the `SessionUpdate` event union is extended and the generic `handleUpdate` in both pages replaces the stored session on any non-end event, so `activity`/`ping` flow through. No new page-level test proves this path (relies on the generic handler being unchanged).
- **[req.garhw0] / [req.i6hso6]** — All unit + integration tests written and passing. ⚠️ Go unit + web unit tests pass (verified). Integration tests updated but do **not** cover two behaviors the implementation doc promised (websocket assertions and the Active→Inactive decay) — see Integration test coverage.
- **[req.x6sv41]** — Update docs (README + `doc/`). ✅ README, `ARCHITECTURE.md`, `SERVER_ENDPOINTS.md`, `TABLES.md` all updated.

## Implementation Progress

- Migration `sql/00019_add_last_activity_at_to_sessions.sql` — ✅
- `db.Session.LastActivityAt` + all read queries (`GetSessionsByUserID`, `GetSession`, `GetSessionsWithHostByUserID`) + `CreateSession` INSERT — ✅
- `UpdateSessionActivity` — ✅
- `util.Throttle` (`NewThrottle`/`Call`/`Stop`) — ✅ **but implemented as a polling actor (atomic flag polled every `interval/10`), not the channel/timer design described in implementation.md.** Behaviorally correct; see Code Review.
- `OutputMonitor` swap to `Throttle`, rename `onOutput`→`onActivity`, drop `lastWrite`/`mu` — ✅
- `SendActivity` client method — ✅
- `cmd/start.go` decouple + ping goroutine — ✅
- `ActivityHandler` + route wired through `jwtMiddleware`+`RequireSessionOwner` — ✅
- Frontend types + `isActive` — ✅
- `StartHandler` seeds `LastActivityAt` on creation — ✅
- Docs — ✅

## Todo Status

Completed (per diff): Phase 1 (util + DB + tests), Phase 2 (handler + route + test), Phase 3 (`SendActivity` + tmux + test), Phase 4 (CLI ping goroutine), Phase 5 (types + `isActive` + `session.test.ts` + page test fixtures), Phase 6 (all docs).

Still pending / not fully done:
- **Phase 7** — the two integration tests were rewritten, but the todo item "Assert active decays to **Inactive** after ~5s of no output" [req.qi06bf] is **not** implemented, and "Assert both `ping` and `activity` events arrive over the updates WebSocket" [req.dwt6ud][req.t2od0w] is **not** asserted (tests check DB state via REST, not the websocket).
- **Phase 8** — `./integration_tests/integration_tests.sh` was not run as part of this review (Docker/Playwright suite); todo marks it 🟢 but that is unverified here.
- `todo.md` marks all phases 🟢; given the gaps above, Phase 7/8 are optimistically marked.

## Unit test coverage

- **[req.1a7c0q]** ping every 5s — no direct unit test (heartbeat lives in `cmd/start.go`, untested; covered only at integration level).
- **[req.2s2rj8]** ping updates `last_ping_at` — `TestPingHandler` (pre-existing).
- **[req.ugzh7u]** throttle 1/sec — `TestThrottle_SpacingNeverExceedsInterval`, `TestThrottle_BurstYieldsLeadingPlusTrailing`; client wiring `TestSendActivity_Success`.
- **[req.quoywx]** no discard — `TestThrottle_MidWindowChangeNotDiscarded`, `TestThrottle_BurstYieldsLeadingPlusTrailing`, `TestThrottle_StopFlushesPending`.
- **[req.lgmngh]** update/create `last_activity_at` — `TestUpdateSessionActivity`, `TestSessionActivityRoundTrip`, `TestActivityHandler`, `TestStartHandler` (seed assertion).
- **[req.dwt6ud]** broadcast activity — ❌ **no unit test asserts the hub broadcast** (`TestActivityHandler` only checks the DB row, not that `SessionUpdate{Event:"activity"}` was broadcast; `TestPingHandler` has the same gap).
- **[req.qi06bf]** active within 5s — `session.test.ts` (within 5s, >5s, null, ended) — good coverage.
- **[req.t2od0w]** pages consume ping/activity — ❌ no dedicated test for `handleUpdate` receiving an `activity`/`ping` event.

**Requirements without an equivalent unit test:** [req.1a7c0q] (heartbeat cadence), [req.dwt6ud] (broadcast assertion), [req.t2od0w] (page update on activity event).

## Unit test quality issues

- **`TestUpdateSessionActivity` — weak assertion.** It only checks `got.LastActivityAt != nil`, never that the stored value equals `activityTime`. A no-op implementation that writes `time.Now()` (or any non-null) would pass. **Fix:** assert `got.LastActivityAt.Equal(activityTime.UTC().Truncate(time.Second))` (mirror the round-trip test's `Equal` check).
- **`TestActivityHandler` — does not verify the broadcast [req.dwt6ud].** It asserts status 200 and the DB row but never inspects the hub. **Fix:** subscribe a client to `hub` for `userID` before the call and assert a `SessionUpdate` with `Event == "activity"` and matching `SessionID` is received (whatever pattern `TestPingHandler` would use — extend both).
- **`Throttle` tests are wall-clock/`time.Sleep`-based and timing-sensitive.** `TestThrottle_BurstYieldsLeadingPlusTrailing` waits only 20ms for a poll (poll interval = 100ms/10 = 10ms) — fine, but under a loaded CI runner these margins can flake. **Fix:** either widen the sleep margins relative to `pollInterval`, or inject a clock/step function so the actor can be driven deterministically. At minimum add a comment tying the sleeps to `interval/10`.
- **`TestThrottle_SpacingNeverExceedsInterval` doesn't actually assert spacing.** It only asserts `count >= 2`, which the burst tests already cover; it does not measure inter-call spacing. **Fix:** record call timestamps and assert consecutive gaps are `>= interval` (minus a tolerance), which is what the test name claims.
- **`TestStartHandler` seed assertion** is fine but also only checks non-nil; consider asserting it is within a few seconds of `now`.

## Integration test coverage

- **[req.1a7c0q]/[req.2s2rj8]** — "Ping heartbeat updates last_ping_at…" waits 7s and asserts `pingDiff > 0`. Covers that the heartbeat fires; does **not** verify the ~5s cadence (only that it updated at least once).
- **[req.lgmngh]/[req.qi06bf]** — "…activity updates last_activity_at" sends a tmux command and asserts `last_activity_at != null`; the "Active" badge test sends `echo` and asserts the dashboard/detail show **Active**.
- **[req.qi06bf] decay to Inactive** — ❌ **not tested.** implementation.md and todo.md both call for asserting the badge decays to **Inactive** after ~5s of no output; no such assertion exists.
- **[req.dwt6ud]/[req.t2od0w] websocket** — ❌ **not tested.** implementation.md promised "Assert both `ping` and `activity` arrive over the updates websocket"; the tests only read REST/DB state.

**Requirements without an equivalent integration test:** [req.dwt6ud] (websocket delivery), [req.qi06bf] decay-to-inactive half, and the 5s cadence portion of [req.1a7c0q].

## Integration test quality issues

- **Fixed-`setTimeout` waits replace polling.** The rewrite dropped the poll-until-updated loop in favor of `setTimeout(7000)` / `setTimeout(4000)` / `setTimeout(3000)`. This is slower and more brittle than polling `getSessionFromApi` until the condition holds. **Fix:** reintroduce a poll-with-timeout helper (assert as soon as `last_activity_at`/`last_ping_at` advances) instead of sleeping a fixed duration.
- **Activity assertion is weak.** After sending `echo "activity trigger"` the test only asserts `afterActivity.last_activity_at != null` — but `last_activity_at` was already seeded non-null on creation, so this passes even if activity was never sent. **Fix:** capture `last_activity_at` before the command and assert it strictly advances (`> before`), the way the ping half now does.
- **Ping-cadence assertion is loose.** `pingDiff > 0` proves an update happened but not that it's a 5s heartbeat. **Fix:** capture two successive `last_ping_at` values ~5s apart and assert the delta is roughly one interval, or count updates over ~12s.
- **Missing decay + websocket cases** (see coverage) should be added to satisfy [req.qi06bf] and [req.dwt6ud].

## Code organization issues

- **Unrelated changes mixed into this diff.** `web/src/components/SessionTopBar.tsx` (pill-overflow tolerance + `document.fonts.ready` re-measure + observing the measure row) and the `ROADMAP.md` reshuffle have nothing to do with the ping/activity overhaul. They inflate the diff and should be split into their own commit. implementation.md only anticipated touching `SessionTopBar` *if it derived status* — these changes are about emoji/font layout, not `isActive`.
- **`Throttle` lives in `debounce.go`.** Reasonable (co-located with `Debouncer`), and the file is still small, but the filename now under-describes its contents. Consider renaming to `rate.go`/`throttle.go` or splitting once a third primitive lands. Not blocking.
- **No duplicated functionality** — `SendActivity`/`UpdateSessionActivity`/`ActivityHandler` correctly mirror their ping counterparts rather than reimplementing; the shared read-query scanning is extended in place. Good.
- **Possible utility candidate:** the three read queries repeat the `if xxx.Valid { t,_ := parseTime(...); s.Field = &t }` block for `last_ping_at`, `last_activity_at`, `ended_at`. A small `nullTimePtr(sql.NullString) *time.Time` helper would remove the triplication — but this predates the change; optional.

## Code Review

### 1. `Throttle` deviates from the specified design and busy-polls (MEDIUM)
implementation.md/todo.md specify an actor "owning state via channels, no mutex … arm a timer to fire at `lastFired + interval`." The implementation instead polls an `atomic.Bool` every `interval/10` forever. It is behaviorally correct for the requirements, but:
- It wakes 10×/interval even when totally idle (10 timer wakeups/sec for the 1s interval), a small but perpetual cost per active session.
- The leading edge is delayed by up to `interval/10` (≤100ms), and after the first fire every subsequent fire snaps to interval boundaries — so it is effectively "trailing on a fixed grid," not truly leading-per-burst. Fine for this use, but note the doc mismatch.

Steps to address:
1. Decide whether to (a) update implementation.md to describe the polling design, or (b) reimplement with the timer/channel design. For (b): keep a `calls chan struct{}` and a lazily-armed `time.Timer`; on a call, fire immediately if `time.Since(lastFired) >= interval` else set `pending` and `timer.Reset(until boundary)`; on timer fire, if `pending` invoke and clear. This removes the busy-poll and gives sub-ms leading latency.
2. If keeping the poll design, at least document the tradeoff in the doc and consider a longer poll floor to reduce idle wakeups.

### 2. Goroutine leak on `StartSession` failure (LOW)
In `cmd/start.go`, the ping goroutine and the file watcher are started under `signalCtx` before `StartSession`. If `StartSession` returns an error, the function `return`s at line 150 **without** calling `cancelSignal()` or `wg.Wait()`, so those goroutines are only cleaned up because the process exits. It's benign today (runStart is the CLI's top-level `RunE`), but it's a latent trap if this code is ever reused.

Steps to address:
1. Add `defer cancelSignal()` right after `signalCtx, cancelSignal := context.WithCancel(ctx)` so every return path cancels the context.
2. Keep the explicit `cancelSignal()` before `wg.Wait()` on the success path (deferred cancel is idempotent).

### 3. "Active" badge can be up to ~10s stale without an interval tick (LOW)
`isActive` is time-based (`<5000ms`) but the pages re-render only when a websocket message arrives. When output stops, the last `activity` may have landed just under 5s ago, and the next re-render is the 5s **ping** — so a session can render "Active" for up to ~10s after it actually went idle. implementation.md explicitly accepts "at most 5s stale," but the ping-boundary math makes the worst case closer to two windows.

Steps to address (optional):
1. If tighter accuracy matters, add a lightweight `setInterval(1000)` "tick" on the dashboard/detail purely to re-run `isActive` (no network), or
2. Leave as-is and update implementation.md to state the realistic worst-case (~2×5s) rather than 5s.

### 4. `last_activity_at` seeded on creation makes brand-new sessions "Active" with zero output (LOW / by design)
`StartHandler` seeds `LastActivityAt = &now`, so a session with no terminal output yet shows "Active" for 5s. This is intentional (badge lights on start), but it means req.qi06bf ("activity within last 5s") is satisfied by a synthetic seed, not real activity. Confirm this is desired; if a session that never produces output should read "Inactive," seed only `last_ping_at`.

### 5. Migration is not guarded / not reversible (LOW — matches existing convention)
`ALTER TABLE sessions ADD COLUMN last_activity_at DATETIME;` is fine for SQLite and nullable (existing rows unaffected). No down-migration, consistent with the repo's forward-only style. No action unless the project adopts rollbacks.

### 6. `SendActivity` fires an HTTP POST per throttle tick with no backpressure (LOW)
Under sustained output the client POSTs `/activity` up to 1×/sec indefinitely. `SendActivity` uses `context.Background()` (no timeout) like the existing `PingSession`, so a stalled server could pile up goroutines/connections. Pre-existing pattern, but worth a follow-up: give `doRequest` a per-call timeout.

### Positives
- Clean mirroring of the ping path end-to-end (client → route → handler → DB → websocket → types).
- `last_activity_at` correctly threaded through **all three** read queries and both round-trip directions, with a test that checks all three.
- `DeleteStaleSessions` correctly left on `last_ping_at` (liveness), preserving cleanup semantics.
- Docs updated across README + all three `doc/` files including the websocket event union.

## Code review TODO

- [ ] **HIGH** — Add integration assertion that the badge **decays to Inactive** after ~5s of no output [req.qi06bf].
- [ ] **HIGH** — Add integration (or handler-level) assertion that `ping` **and** `activity` arrive over the updates websocket [req.dwt6ud][req.t2od0w].
- [ ] **HIGH** — Strengthen the activity integration test: assert `last_activity_at` strictly **advances** after the tmux command (currently passes on the seeded value).
- [ ] **MEDIUM** — Assert the hub broadcast in `TestActivityHandler` (and ideally `TestPingHandler`) — verify `Event=="activity"` is emitted, not just the DB write [req.dwt6ud].
- [ ] **MEDIUM** — Strengthen `TestUpdateSessionActivity` to assert the stored time equals the passed `activityTime` (use `.Equal`).
- [ ] **MEDIUM** — Reconcile `Throttle` with implementation.md: either switch to the timer/channel design (removes idle busy-poll) or update the doc to describe the polling actor.
- [ ] **MEDIUM** — Split the unrelated `SessionTopBar.tsx` and `ROADMAP.md` changes out of this feature diff.
- [ ] **MEDIUM** — Run `./integration_tests/integration_tests.sh` and confirm green before marking Phase 7/8 done (unverified in this review).
- [ ] **LOW** — `cmd/start.go`: `defer cancelSignal()` to avoid leaking the ping/watcher goroutines on the `StartSession` error path.
- [ ] **LOW** — Replace fixed `setTimeout` waits in the integration tests with poll-until-condition; tighten the ping-cadence assertion beyond `>0`.
- [ ] **LOW** — Reduce timing fragility in `Throttle` tests (deterministic clock or wider margins tied to `interval/10`).
- [ ] **LOW** — Confirm the "seed `last_activity_at` on start" behavior is intended (new sessions read Active with no output).
- [ ] **FUTURE** — Give client `doRequest`/`SendActivity`/`PingSession` a per-call timeout instead of `context.Background()`.
- [ ] **FUTURE** — Extract a `nullTimePtr(sql.NullString) *time.Time` helper to de-duplicate the repeated null-time scanning in the three read queries.
