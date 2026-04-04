# Implementation Review: Server

## Overall Assessment

The implementation is comprehensive and covers all stated requirements. The architecture is clean, the file layout is sensible, and the separation of concerns is good. The following issues were identified, ranging from bugs to design concerns.

---

## Issues

### 1. `status` column missing from `sessions` table — [req.ke019e]

**Severity: Minor gap**

[req.ke019e] says `end` should "update the session status to inactive". The `sessions` table has no `status` column — only `ended_at`. Either:
- Add a `status TEXT` column (e.g. `'active'` / `'inactive'`), or
- Accept that `ended_at IS NOT NULL` implies inactive and update the requirement wording accordingly.

Currently the schema doesn't reflect the requirement language.

---

### 2. `userID` type mismatch between `Hub` and the rest of the codebase

**Severity: Bug — Fixed in implementation.md**

`Hub` was using `map[string]map[*websocket.Conn]bool` (string keys), but user IDs in the DB, JWT claims, and all query functions are `int64`. Updated `Hub` struct and all method signatures (`Register`, `Unregister`, `Broadcast`) to use `int64`.

---

### 3. In-memory WebAuthn session state in `LoginHandler` and `CreateUserHandler`

**Severity: Design concern — Partially addressed in implementation.md**

Both handlers now use a `ChallengeStore` with a configurable TTL and a background cleanup goroutine that evicts expired entries. Stale challenges can no longer accumulate indefinitely.

Remaining constraints (acceptable for this project scope):
- The server still cannot be restarted mid-ceremony without breaking in-flight challenges.
- Horizontal scaling still requires sticky sessions or a shared store.

---

### 4. `GET` request with side effects in `LoginHandler` and `CreateUserHandler`

**Severity: Design concern — Fixed in implementation.md**

Split into four explicit `POST` endpoints following the conventional WebAuthn REST pattern:
- `POST /api/v1/auth/login/begin` → `LoginBeginHandler`
- `POST /api/v1/auth/login/finish` → `LoginFinishHandler`
- `POST /api/v1/auth/register/begin` → `RegisterBeginHandler`
- `POST /api/v1/auth/register/finish` → `RegisterFinishHandler`

Note: `/api/v1/auth/create_user` was renamed to `/api/v1/auth/register/...` to align with the split. The original req tag [req.onj6fp] is preserved on the new handlers.

---

### 5. Synchronous WebSocket broadcast under a write lock

**Severity: Performance concern — Fixed in implementation.md**

Replaced `*websocket.Conn` entries with a `client` struct holding a buffered `send chan []byte`. Each registered client gets a dedicated `writePump` goroutine that drains the channel and writes to the connection. `Broadcast` now only holds a read lock long enough to enqueue a message per client; the actual WebSocket write happens outside any lock. Slow clients that let their channel fill up are dropped via a non-blocking send.

---

### 6. YAML request bodies in `StartHandler` and `MetaHandler`

**Severity: Design concern — Fixed in implementation.md**

Both handlers now accept JSON and decode the body into `map[string]any`. `StartHandler` additionally extracts known fields (`name`, `hostname`, `start_time`) from the map for the dedicated session columns; the full map is stored as the metadata blob. The CLI client is responsible for parsing any on-disk YAML session files and serializing to JSON before sending.

---

### 7. Undocumented `pair/exchange` endpoint

**Severity: Minor — Fixed in requirements.md**

Added `/api/v1/auth/pair/exchange` to requirements.md with req tags [req.p2xw1a, req.n3hk7b, req.q8mv5c, req.r7ft2d]. Also added [req.w5yn3x] to `pair/complete` to make the approval dependency explicit.

---

### 8. No cleanup for expired pairing codes

**Severity: Minor / Operational concern — Fixed in implementation.md**

Added `internal/db/maintenance.go` with a `StartMaintenance(ctx, db, interval)` function that runs a background goroutine ticking at `cfg.MaintenanceInterval` (default 1h, configurable via `DEVSESH_MAINTENANCE_INTERVAL`). Each tick calls `DeleteExpiredPairingCodes` which issues a single `DELETE` against `pairing_codes`. The context is cancelled on SIGINT/SIGTERM, stopping the loop cleanly on server shutdown. Additional cleanup tasks can be added to the tick in the future.

---

### 9. SSH connectivity assumes `session_id` = tmux session name

**Severity: Design assumption to verify**

`ConnectHandler` attaches to the tmux session using `attach-session -t [session_id]`. This works only if the CLI client names its tmux session after the session UUID it sends to the server. This coupling must be enforced on the client side. Worth adding an explicit note (or a dedicated `tmux_session` field in the `sessions` table) to make this contract explicit.

---

### 10. No CORS or rate limiting

**Severity: Security / Operational note**

The web client will make cross-origin requests. No CORS middleware is specified. Additionally, unauthenticated endpoints (`login`, `create_user`, `pair/start`, `pair/complete`) have no rate limiting, making them susceptible to brute-force or enumeration attacks. At minimum, CORS headers for the web client origin and a simple per-IP rate limiter on auth endpoints should be added.

---

## Minor Notes

- `flake.nix` lists `go`, `gopls`, `gotools`, `sqlite` as dev tools. If `ssheasy` or its SSH dependencies require system libraries (e.g. `libssh2`, `openssh`), these should also be listed.
- `StartHandler` broadcasts with `hub.Broadcast(userID, ...)` where `userID` comes from JWT context. Confirm this is the correct user to broadcast to (the session owner), not the session's stored `user_id` — they should be the same, but worth being explicit.
- `EndHandler` calls `db.EndSession(id, time.Now())` — `time.Now()` is server time. If the client has a more accurate end time, consider accepting it in the request body.
