# Todo: Server Implementation

## Phase 1 — Project Foundation & Nix Setup

- [ ] Create `flake.nix` at the repo root with `devShells.default` (includes `go`, `gopls`, `gotools`, `sqlite`) and `packages.default` that builds the `devsesh` binary via `buildGoModule` [req.patb61, req.h6t9ye]
- [ ] Initialize `go.mod` with module name `github.com/leobeosab/devsesh` and add required dependencies:
  - `modernc.org/sqlite` (pure-Go SQLite driver)
  - `github.com/spf13/cobra`
  - `github.com/golang-jwt/jwt/v5`
  - `github.com/go-webauthn/webauthn`
  - `github.com/gorilla/websocket`
  - `github.com/hullarb/ssheasy`
- [ ] Create `main.go` — entry point that calls `cmd.Execute()`
- [ ] Create `cmd/root.go` — defines the root Cobra command `devsesh` with no logic beyond building the command tree

**Phase 1 tests:**
- [ ] Run `nix flake check` to verify the flake is valid
- [ ] Run `go build ./...` to confirm the module compiles with no errors

---

## Phase 2 — Configuration

- [ ] Create `internal/config/config.go`:
  - Define `Config` struct with fields: `DBPath`, `JWTSecret`, `JWTExpiry` (default 24h), `JWTPairExpiry` (default 30d), `PairingCodeExpiry` (default 5m), `AllowUserCreation` (default false), `Port` (default 8080), `MaintenanceInterval` (default 1h) [req.ou3x03, req.8fttif, req.k5powd]
  - Implement `LoadFromEnv() Config` reading: `DEVSESH_DB_PATH`, `DEVSESH_JWT_SECRET`, `DEVSESH_JWT_EXPIRY`, `DEVSESH_JWT_PAIR_EXPIRY`, `DEVSESH_PAIRING_CODE_EXPIRY`, `DEVSESH_ALLOW_USER_CREATION`, `DEVSESH_PORT`, `DEVSESH_MAINTENANCE_INTERVAL`

**Phase 2 tests:**
- [ ] Run `go test ./internal/config/...` — verify defaults are applied when env vars are absent and that env vars override them

---

## Phase 3 — Database Layer

- [ ] Create `sql/00001_create_migrations_table.sql` — `CREATE TABLE IF NOT EXISTS migrations` with `id`, `name`, `applied_at` [req.zr26qx]
- [ ] Create `sql/00002_create_server_config_table.sql` — `CREATE TABLE IF NOT EXISTS server_config` with `key`, `value`
- [ ] Create `sql/00003_create_users_table.sql` — `CREATE TABLE IF NOT EXISTS users` with `id`, `email`, `created_at` [req.vcnuq2]
- [ ] Create `sql/00004_create_webauthn_credentials_table.sql` — `CREATE TABLE IF NOT EXISTS webauthn_credentials` with `id`, `user_id`, `public_key`, `sign_count`, `created_at` [req.uq2b35]
- [ ] Create `sql/00005_create_pairing_codes_table.sql` — `CREATE TABLE IF NOT EXISTS pairing_codes` with `code`, `user_id`, `approved`, `used`, `expires_at` [req.sq63yf]
- [ ] Create `sql/00006_create_sessions_table.sql` — `CREATE TABLE IF NOT EXISTS sessions` with `id`, `user_id`, `name`, `hostname`, `started_at`, `last_ping_at`, `ended_at`, `metadata` [req.8tey8x]
- [ ] Create `internal/db/db.go`:
  - `Open(cfg config.Config) (*sql.DB, error)` — opens/creates the SQLite file, sets connection pool params, pings [req.vcnuq2]
  - `ResolveJWTSecret(db *sql.DB, envSecret string) (string, error)` — env takes precedence; otherwise reads from `server_config`, generating and persisting a 32-byte random secret if absent
- [ ] Create `internal/db/migrate.go` — embed `sql/*.sql` via `//go:embed`; implement `RunMigrations(db *sql.DB) error` that ensures the `migrations` table exists, reads files sorted by name, skips already-applied ones, executes each in a transaction, and inserts a row into `migrations` [req.ix4ta6, req.mij1ct, req.zr26qx]
- [ ] Create `internal/db/maintenance.go`:
  - `StartMaintenance(ctx context.Context, db *sql.DB, interval time.Duration)` — background goroutine ticking every `interval`, runs cleanup tasks, stops on ctx cancellation
  - `DeleteExpiredPairingCodes(db *sql.DB) error` — `DELETE FROM pairing_codes WHERE expires_at < CURRENT_TIMESTAMP`
- [ ] Create `internal/db/queries.go` with all pure query functions:
  - Server config: `GetConfigValue`, `SetConfigValue`
  - Users: `CreateUser`, `GetUserByEmail`, `CountUsers` [req.m50le9]
  - WebAuthn credentials: `SaveCredential`, `GetCredentialsByUserID`, `UpdateCredentialSignCount`
  - Pairing codes: `CreatePairingCode`, `GetPairingCode`, `ApprovePairingCode`, `MarkPairingCodeUsed`
  - Sessions: `CreateSession`, `UpdateSessionPing`, `EndSession`, `UpdateSessionMeta`, `GetSessionsByUserID`, `GetSession`

**Phase 3 tests:**
- [ ] Run `go test ./internal/db/...` — cover `RunMigrations` (idempotent), `ResolveJWTSecret` (auto-generate + persist), and round-trip CRUD for users, pairing codes, and sessions
- [ ] Manually verify: `go run . migrate` against a temp DB and inspect with `sqlite3` that all 6 tables exist and a row appears in `migrations` for each file

---

## Phase 4 — Auth: JWT & WebAuthn

- [ ] Create `internal/auth/jwt.go`:
  - Define `Claims` struct embedding `jwt.RegisteredClaims` with `UserID int64 \`json:"sub"\``
  - `GenerateToken(secret string, userID int64, expiry time.Duration) (string, error)` — HS256 signed JWT [req.myorh8, req.ou3x03, req.8fttif]
  - `ValidateToken(secret, tokenStr string) (*Claims, error)` [req.dl579b]
- [ ] Create `internal/auth/webauthn.go`:
  - `NewWebAuthn(rpID, rpOrigin string) (*webauthn.WebAuthn, error)`
  - `ChallengeStore` struct with `sync.Mutex`-protected `map[string]challengeEntry` and TTL cleanup goroutine [req.uq2b35]
  - `NewChallengeStore(ttl time.Duration) *ChallengeStore`
  - Methods: `Set`, `Get` (expiry-aware), `Delete`
  - `LoginBeginHandler` — looks up user, begins WebAuthn login, stores challenge [req.38glsd]
  - `LoginFinishHandler` — finishes WebAuthn login, updates sign count, issues JWT with `cfg.JWTExpiry` [req.38glsd, req.myorh8, req.ou3x03]
  - `RegisterBeginHandler` — enforces first-user-only or `AllowUserCreation` flag, begins registration [req.onj6fp, req.m50le9]
  - `RegisterFinishHandler` — finishes registration, creates user and credential [req.onj6fp, req.32nb8u]

**Phase 4 tests:**
- [ ] Run `go test ./internal/auth/...` — cover `GenerateToken`/`ValidateToken` round-trips, expiry rejection, `ChallengeStore` TTL expiry, and handler unit tests using `httptest`

---

## Phase 5 — Auth: Pairing

- [ ] Create `internal/auth/pairing.go`:
  - `PairStartHandler(db *sql.DB, cfg config.Config) http.HandlerFunc` — accepts `{"username":"..."}`, looks up user, generates unique 6-char alphanumeric code with up to 5 retries, persists via `CreatePairingCode` with `expiresAt = now + cfg.PairingCodeExpiry`, returns `{"code":"..."}` [req.sq63yf, req.zjyw4e, req.k5powd]
  - `PairExchangeHandler(db *sql.DB) http.HandlerFunc` — requires JWT (web client); accepts `{"code":"..."}`, validates code exists/unused/not expired, calls `ApprovePairingCode`, returns `200 OK` [req.p2xw1a, req.n3hk7b, req.q8mv5c, req.r7ft2d]
  - `PairCompleteHandler(db *sql.DB, cfg config.Config) http.HandlerFunc` — called by CLI; validates code exists/unused/not expired/approved, issues JWT with `cfg.JWTPairExpiry`, marks code used, returns `{"token":"..."}` [req.hq0gcy, req.ehjrlx, req.w5yn3x, req.8fttif]

**Phase 5 tests:**
- [ ] Run `go test ./internal/auth/...` (pairing tests) — cover: code generation uniqueness, expiry rejection in exchange/complete, unapproved code rejected by complete, happy path issues correct JWT

---

## Phase 6 — Sessions

- [ ] Create `internal/sessions/websocket.go`:
  - Define `client` struct (`conn`, `send chan []byte`, `userID int64`)
  - Define `Hub` struct (`clients map[int64]map[*client]bool`, `mu sync.RWMutex`)
  - `NewHub() *Hub`
  - `Register(c *client)`, `Unregister(c *client)` (closes `c.send`)
  - `Broadcast(userID int64, msg SessionUpdate)` — marshals once, non-blocking send, unregisters slow clients [req.zcfv5c, req.2q1oku]
  - `writePump(c *client)` goroutine
  - `UpdatesHandler(hub *Hub, cfg config.Config) http.HandlerFunc` — upgrades to WebSocket, registers client, starts `writePump`, discards incoming messages [req.zcfv5c]
- [ ] Create `internal/sessions/handler.go`:
  - `StartHandler(db *sql.DB, hub *Hub) http.HandlerFunc` — decodes body, extracts `name`/`hostname`/`start_time`, stores full body as metadata, calls `CreateSession`, broadcasts `"start"` event [req.8tey8x, req.dkjy5l]
  - `PingHandler(db *sql.DB, hub *Hub) http.HandlerFunc` — calls `UpdateSessionPing`, broadcasts `"ping"` event [req.3vl4km, req.dluknx]
  - `EndHandler(db *sql.DB, hub *Hub) http.HandlerFunc` — calls `EndSession`, broadcasts `"end"` event [req.foiehx, req.ke019e]
  - `MetaHandler(db *sql.DB, hub *Hub) http.HandlerFunc` — decodes body, calls `UpdateSessionMeta`, broadcasts `"meta"` event [req.wukj7o, req.o1ytg6]
  - `ListHandler(db *sql.DB) http.HandlerFunc` — returns `GetSessionsByUserID` as JSON [req.vb9w44, req.i71v1y]

**Phase 6 tests:**
- [ ] Run `go test ./internal/sessions/...` — cover: hub broadcast to multiple clients, slow-client eviction, all five handlers via `httptest` (start/ping/end/meta/list), WebSocket upgrade test

---

## Phase 7 — SSH / ssheasy Integration

- [ ] Create `internal/ssh/handler.go`:
  - `RegisterRoutes(mux *http.ServeMux, db *sql.DB, cfg config.Config)` — registers the three SSH routes (all JWT-protected) [req.s9db30]
  - `ConnectHandler(db *sql.DB, cfg config.Config) http.HandlerFunc` — looks up session for `hostname` and `session_id`, upgrades to WebSocket, uses ssheasy to SSH into `hostname` and attach to the tmux session, bidirectionally pipes until either side closes [req.s8p122]
  - `SSHWebAuthnBeginHandler` — begins WebAuthn assertion for SSH key authorization [req.uq2b35]
  - `SSHWebAuthnCompleteHandler` — finishes assertion, returns short-lived SSH credential accepted by ssheasy [req.uq2b35]

**Phase 7 tests:**
- [ ] Run `go test ./internal/ssh/...` — cover route registration, mock-WebSocket connect handler (verify session lookup and ssheasy invocation), WebAuthn begin/complete round-trip via `httptest`
- [ ] Manual smoke test: start server locally, open web client, click a session, verify WebSocket SSH tunnel upgrades without error

---

## Phase 8 — HTTP Server & Middleware

- [ ] Create `web/index.html` — minimal HTML placeholder with `<title>devsesh</title>` and empty body [req.3i4lvw]
- [ ] Create `internal/server/middleware.go`:
  - `RequireJWT(secret string) func(http.Handler) http.Handler` — validates Bearer token, stores `Claims` in context, returns `401` on failure [req.dl579b]
  - `RequireSessionOwner(db *sql.DB) func(http.Handler) http.Handler` — fetches session, checks ownership, stores session in context, returns `404`/`403` on failure
  - `UserIDFromContext(ctx context.Context) (int64, bool)`
  - `SessionFromContext(ctx context.Context) (*db.Session, bool)`
- [ ] Create `internal/server/server.go`:
  - Embed `web/` via `//go:embed ../../web` [req.4g1p44]
  - `New(cfg config.Config, db *sql.DB, cs *auth.ChallengeStore) *Server` — wires all routes [req.1wq405]:
    - `GET /` → serve embedded `web/index.html`
    - `POST /api/v1/auth/login/begin` → `auth.LoginBeginHandler` [req.38glsd]
    - `POST /api/v1/auth/login/finish` → `auth.LoginFinishHandler` [req.38glsd]
    - `POST /api/v1/auth/register/begin` → `auth.RegisterBeginHandler` [req.onj6fp]
    - `POST /api/v1/auth/register/finish` → `auth.RegisterFinishHandler` [req.onj6fp]
    - `POST /api/v1/auth/pair/start` → `auth.PairStartHandler` [req.sq63yf]
    - `POST /api/v1/auth/pair/exchange` → `RequireJWT` → `auth.PairExchangeHandler` [req.p2xw1a]
    - `POST /api/v1/auth/pair/complete` → `auth.PairCompleteHandler` [req.hq0gcy]
    - `POST /api/v1/sessions/{session_id}/start` → `RequireJWT` → `sessions.StartHandler` [req.8tey8x]
    - `POST /api/v1/sessions/{session_id}/ping` → `RequireJWT` → `RequireSessionOwner` → `sessions.PingHandler` [req.3vl4km]
    - `POST /api/v1/sessions/{session_id}/end` → `RequireJWT` → `RequireSessionOwner` → `sessions.EndHandler` [req.foiehx]
    - `POST /api/v1/sessions/{session_id}/meta` → `RequireJWT` → `RequireSessionOwner` → `sessions.MetaHandler` [req.wukj7o]
    - `GET /api/v1/sessions` → `RequireJWT` → `sessions.ListHandler` [req.vb9w44]
    - `GET /api/v1/sessions/updates` → `RequireJWT` → `sessions.UpdatesHandler` [req.zcfv5c]
    - SSH routes via `ssh.RegisterRoutes` [req.s9db30]
  - `(s *Server) Start() error` — calls `http.ListenAndServe`

**Phase 8 tests:**
- [ ] Run `go test ./internal/server/...` — cover middleware unit tests (`RequireJWT` with valid/missing/expired token; `RequireSessionOwner` with owner mismatch)
- [ ] Run `go build ./...` to confirm the full server package compiles

---

## Phase 9 — CLI Commands

- [ ] Create `cmd/migrate.go`:
  - `NewMigrateCmd() *cobra.Command` — loads config, opens DB, calls `db.RunMigrations`, prints each applied migration name, exits 0 on success [req.ix4ta6]
  - Register with root command
- [ ] Create `cmd/server.go`:
  - `NewServerCmd() *cobra.Command` — loads config, opens DB, runs migrations, resolves JWT secret, creates `ChallengeStore`, wires signal-based `context.Context` for graceful shutdown, starts maintenance loop, creates and starts the HTTP server [req.voigef]
  - Register with root command

**Phase 9 tests:**
- [ ] Run `go build -o devsesh .` and confirm binary is produced
- [ ] Run `./devsesh migrate` against a fresh SQLite file; verify all 6 migration files are applied and the command exits 0
- [ ] Run `./devsesh server` and confirm the server starts on the configured port; send `GET /` and verify the placeholder HTML is returned
- [ ] Send `POST /api/v1/auth/register/begin` with an email on a fresh DB; verify a WebAuthn challenge is returned
- [ ] Send `POST /api/v1/auth/pair/start` with a known user; verify a 6-char code is returned and expires per config
- [ ] Connect a WebSocket client to `/api/v1/sessions/updates` with a valid JWT; trigger a `POST /api/v1/sessions/{id}/start` and verify the update message is received over the socket
