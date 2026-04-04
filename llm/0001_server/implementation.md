# Implementation: Server

## Project Layout

```
devsesh/
├── flake.nix
├── go.mod
├── main.go
├── cmd/
│   ├── root.go
│   ├── server.go
│   └── migrate.go
├── internal/
│   ├── config/
│   │   └── config.go
│   ├── db/
│   │   ├── db.go
│   │   ├── migrate.go
│   │   └── queries.go
│   ├── server/
│   │   ├── server.go
│   │   └── middleware.go
│   ├── auth/
│   │   ├── jwt.go
│   │   ├── webauthn.go
│   │   └── pairing.go
│   ├── sessions/
│   │   ├── handler.go
│   │   └── websocket.go
│   └── ssh/
│       └── handler.go
├── sql/
│   ├── 00001_create_migrations_table.sql
│   ├── 00002_create_server_config_table.sql
│   ├── 00003_create_users_table.sql
│   ├── 00004_create_webauthn_credentials_table.sql
│   ├── 00005_create_pairing_codes_table.sql
│   └── 00006_create_sessions_table.sql
└── web/
    └── index.html
```

---

## Data Structures

### SQL Tables

**`migrations`** [req.zr26qx]
- `id` INTEGER PRIMARY KEY
- `name` TEXT NOT NULL UNIQUE — filename of the migration
- `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

**`server_config`**
- `key` TEXT PRIMARY KEY
- `value` TEXT NOT NULL

**`users`** [req.vcnuq2]
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `email` TEXT NOT NULL UNIQUE
- `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

**`webauthn_credentials`** [req.uq2b35]
- `id` TEXT PRIMARY KEY — credential ID (base64url)
- `user_id` INTEGER NOT NULL REFERENCES users(id)
- `public_key` BLOB NOT NULL
- `sign_count` INTEGER NOT NULL DEFAULT 0
- `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

**`pairing_codes`** [req.sq63yf]
- `code` TEXT PRIMARY KEY — random alphanumeric code
- `user_id` INTEGER NOT NULL REFERENCES users(id)
- `approved` BOOLEAN NOT NULL DEFAULT FALSE — set by `pair/exchange` after WebAuthn validation
- `used` BOOLEAN NOT NULL DEFAULT FALSE — set by `pair/complete` after JWT is issued
- `expires_at` DATETIME NOT NULL

**`sessions`** [req.8tey8x]
- `id` TEXT PRIMARY KEY — UUID provided by client
- `user_id` INTEGER NOT NULL REFERENCES users(id)
- `name` TEXT NOT NULL
- `hostname` TEXT NOT NULL
- `started_at` DATETIME NOT NULL
- `last_ping_at` DATETIME
- `ended_at` DATETIME
- `metadata` TEXT — JSON blob of session file key-value data

### Go Structs

**`internal/config/config.go`**
```go
type Config struct {
    DBPath             string        // SQLite file path
    JWTSecret          string
    JWTExpiry          time.Duration // default 24h (login)
    JWTPairExpiry      time.Duration // default 30d (pairing)
    PairingCodeExpiry  time.Duration // default 5m
    AllowUserCreation  bool          // default false
    Port               int           // default 8080
}
```

**`internal/auth/jwt.go`**
```go
type Claims struct {
    UserID int64 `json:"sub"`
    jwt.RegisteredClaims
}
```

**`internal/sessions/websocket.go`**
```go
type SessionUpdate struct {
    Event     string  `json:"event"` // "start" | "ping" | "end" | "meta"
    SessionID string  `json:"session_id"`
    Session   Session `json:"session"`
}
```

---

## Files and Functions

### `flake.nix` (created) [req.patb61, req.h6t9ye]

Top-level Nix flake with:
- `devShells.default` — includes `go`, `gopls`, `gotools`, `sqlite`, and any other needed dev tools
- `packages.default` — builds the `devsesh` binary using `buildGoModule`

### `web/index.html` (created) [req.3i4lvw, req.4g1p44]

Empty HTML placeholder with a `<title>devsesh</title>` and a minimal body. Embedded via `//go:embed web` in `internal/server/server.go`.

### `sql/` migrations (created) [req.mij1ct]

Sequential SQL files for each table. Each file contains only a `CREATE TABLE IF NOT EXISTS` statement. No down migrations.

---

### `main.go` (created)

- Entry point. Calls `cmd.Execute()`.

---

### `cmd/root.go` (created)

- Defines the root Cobra command `devsesh`.
- No logic beyond setting up the command tree.

### `cmd/server.go` (created) [req.voigef]

**`NewServerCmd() *cobra.Command`**
- Creates the `server` subcommand.
- Loads `Config` via `config.LoadFromEnv()`.
- Opens the DB via `db.Open(cfg)`.
- Runs pending migrations via `db.RunMigrations(conn)`.
- Resolves the JWT secret via `db.ResolveJWTSecret(conn, cfg.JWTSecret)` and stores it back in `cfg.JWTSecret`.
- Creates a `auth.ChallengeStore` via `auth.NewChallengeStore(5 * time.Minute)`.
- Creates the HTTP server via `server.New(cfg, conn, challengeStore)` and calls `server.Start()`.

### `cmd/migrate.go` (created) [req.ix4ta6]

**`NewMigrateCmd() *cobra.Command`**
- Creates the `migrate` subcommand.
- Loads config, opens DB, and calls `db.RunMigrations(conn)`.
- Prints each migration name as it's applied. Exits with status 0 on success.

---

### `internal/config/config.go` (created)

**`LoadFromEnv() Config`**
- Reads all configuration from environment variables with sensible defaults.
- `DEVSESH_DB_PATH`, `DEVSESH_JWT_SECRET` (optional — if unset, auto-generated), `DEVSESH_JWT_EXPIRY`, `DEVSESH_JWT_PAIR_EXPIRY`,
  `DEVSESH_PAIRING_CODE_EXPIRY`, `DEVSESH_ALLOW_USER_CREATION`, `DEVSESH_PORT`.
- Returns a fully populated `Config`. `JWTSecret` may be empty string if not set in env — resolution happens after DB is open.

---

### `internal/db/db.go` (created) [req.vcnuq2]

**`Open(cfg config.Config) (*sql.DB, error)`**
- Opens (or creates) the SQLite file at `cfg.DBPath` using the `modernc.org/sqlite` driver (pure Go, no cgo needed).
- Sets reasonable connection pool parameters and pings to verify connectivity.

**`ResolveJWTSecret(db *sql.DB, envSecret string) (string, error)`**
- If `envSecret` is non-empty, returns it as-is (env var takes precedence).
- Otherwise, calls `GetConfigValue(db, "jwt_secret")`.
  - If found, returns the stored secret.
  - If not found, generates a 32-byte cryptographically random secret (hex-encoded), persists it via `SetConfigValue(db, "jwt_secret", secret)`, and returns it.

### `internal/db/migrate.go` (created) [req.ix4ta6, req.mij1ct, req.zr26qx]

```go
//go:embed ../../sql/*.sql
var migrationFS embed.FS
```

**`RunMigrations(db *sql.DB) error`**
- Ensures the `migrations` table exists (creates it if missing).
- Reads all `*.sql` files from the embedded FS, sorted by filename.
- For each file not already in the `migrations` table, executes it in a transaction and inserts a row into `migrations`.
- Returns on first error.

### `internal/db/queries.go` (created)

Pure functions that accept `*sql.DB` (or `*sql.Tx`) and return data or errors. No global state.

**Server config queries**
- `GetConfigValue(db *sql.DB, key string) (string, error)` — returns value or `sql.ErrNoRows`
- `SetConfigValue(db *sql.DB, key, value string) error` — upserts the key-value pair

**User queries**
- `CreateUser(db *sql.DB, email string) (int64, error)` — inserts a new user, returns generated ID
- `GetUserByEmail(db *sql.DB, email string) (*User, error)` — returns user or nil
- `CountUsers(db *sql.DB) (int, error)` — used to enforce first-user-only creation [req.m50le9]

**WebAuthn credential queries**
- `SaveCredential(db *sql.DB, cred WebAuthnCredential) error`
- `GetCredentialsByUserID(db *sql.DB, userID int64) ([]WebAuthnCredential, error)`
- `UpdateCredentialSignCount(db *sql.DB, credID string, count uint32) error`

**Pairing code queries**
- `CreatePairingCode(db *sql.DB, code string, userID int64, expiresAt time.Time) error`
- `GetPairingCode(db *sql.DB, code string) (*PairingCode, error)` — returns nil if not found
- `ApprovePairingCode(db *sql.DB, code string) error` — sets `approved=true`
- `MarkPairingCodeUsed(db *sql.DB, code string) error` — sets `used=true`

**Session queries**
- `CreateSession(db *sql.DB, s Session) error`
- `UpdateSessionPing(db *sql.DB, id string, t time.Time) error`
- `EndSession(db *sql.DB, id string, t time.Time) error`
- `UpdateSessionMeta(db *sql.DB, id, metadata string) error`
- `GetSessionsByUserID(db *sql.DB, userID int64) ([]Session, error)`
- `GetSession(db *sql.DB, id string) (*Session, error)`

---

### `internal/server/server.go` (created) [req.1wq405, req.4g1p44]

```go
//go:embed ../../web
var webFS embed.FS
```

**`New(cfg config.Config, db *sql.DB, cs *auth.ChallengeStore) *Server`**
- Constructs the HTTP server, wires all routes, and initializes the WebSocket hub.

**`(s *Server) Start() error`**
- Calls `http.ListenAndServe`.

**Route registration (within `New`):**
- `GET /` → serves embedded `web/index.html` [req.1wq405]
- `POST /api/v1/auth/login/begin` → `auth.LoginBeginHandler` [req.38glsd]
- `POST /api/v1/auth/login/finish` → `auth.LoginFinishHandler` [req.38glsd]
- `POST /api/v1/auth/register/begin` → `auth.RegisterBeginHandler` [req.onj6fp]
- `POST /api/v1/auth/register/finish` → `auth.RegisterFinishHandler` [req.onj6fp]
- `POST /api/v1/auth/pair/start` → `auth.PairStartHandler` [req.sq63yf]
- `POST /api/v1/auth/pair/exchange` → `auth.PairExchangeHandler` (web client, JWT required)
- `POST /api/v1/auth/pair/complete` → `auth.PairCompleteHandler` [req.hq0gcy]
- `POST /api/v1/sessions/{session_id}/start` → `sessions.StartHandler` [req.8tey8x] (JWT required)
- `POST /api/v1/sessions/{session_id}/ping` → `sessions.PingHandler` [req.3vl4km] (JWT + SessionOwner required)
- `POST /api/v1/sessions/{session_id}/end` → `sessions.EndHandler` [req.foiehx] (JWT + SessionOwner required)
- `POST /api/v1/sessions/{session_id}/meta` → `sessions.MetaHandler` [req.wukj7o] (JWT + SessionOwner required)
- `GET /api/v1/sessions` → `sessions.ListHandler` [req.vb9w44] (JWT required)
- `GET /api/v1/sessions/updates` → `sessions.UpdatesHandler` (WebSocket) [req.zcfv5c] (JWT required)
- SSH/ssheasy endpoints registered via `ssh.RegisterRoutes` [req.s9db30]

### `internal/server/middleware.go` (created)

**`RequireJWT(secret string) func(http.Handler) http.Handler`**
- Extracts and validates the Bearer token from the `Authorization` header.
- On success, stores the parsed `Claims` in the request context.
- Returns `401 Unauthorized` on failure.

**`RequireSessionOwner(db *sql.DB) func(http.Handler) http.Handler`**
- Extracts `session_id` from the URL path.
- Fetches the session via `db.GetSession(id)`; returns `404` if not found.
- Returns `403` if `session.user_id` does not match the `userID` from context.
- On success, stores the session in the request context so handlers can use it without re-fetching.

**`UserIDFromContext(ctx context.Context) (int64, bool)`**
- Helper to retrieve the user ID stored by `RequireJWT`.

**`SessionFromContext(ctx context.Context) (*Session, bool)`**
- Helper to retrieve the session stored by `RequireSessionOwner`.

---

### `internal/auth/jwt.go` (created) [req.myorh8, req.dl579b, req.ou3x03, req.8fttif]

**`GenerateToken(secret string, userID int64, expiry time.Duration) (string, error)`**
- Creates a signed HS256 JWT with `sub=userID` and the given expiry.

**`ValidateToken(secret, tokenStr string) (*Claims, error)`**
- Parses and validates the JWT, returning Claims or an error.

### `internal/auth/webauthn.go` (created) [req.38glsd, req.onj6fp, req.uq2b35]

Uses the `github.com/go-webauthn/webauthn` library.

**`NewWebAuthn(rpID, rpOrigin string) (*webauthn.WebAuthn, error)`**
- Instantiates the WebAuthn handler with the relying party configuration.

**`ChallengeStore` struct**
```go
type challengeEntry struct {
    data      *webauthn.SessionData
    expiresAt time.Time
}

type ChallengeStore struct {
    mu      sync.Mutex
    entries map[string]challengeEntry // keyed by email
    ttl     time.Duration
}
```

**`NewChallengeStore(ttl time.Duration) *ChallengeStore`**
- Returns an initialized store with the given TTL.
- Starts a background goroutine that ticks every `ttl` and deletes all entries whose `expiresAt` is in the past.

**`(s *ChallengeStore) Set(email string, data *webauthn.SessionData)`**
- Stores the WebAuthn session data under the given email key, with `expiresAt = now + ttl`.

**`(s *ChallengeStore) Get(email string) (*webauthn.SessionData, bool)`**
- Returns the session data if found and not yet expired; returns `false` otherwise.
- Does **not** delete the entry on retrieval (deletion happens either in `Delete` or the cleanup goroutine).

**`(s *ChallengeStore) Delete(email string)`**
- Removes the entry for the given email.

**`LoginBeginHandler(wa *webauthn.WebAuthn, db *sql.DB, cs *ChallengeStore) http.HandlerFunc`** [req.38glsd]
- Accepts `{"email": "..."}`.
- Looks up user by email; returns `404` if not found.
- Calls `wa.BeginLogin`, stores the returned `*webauthn.SessionData` via `cs.Set(email, sessionData)`.
- Returns the WebAuthn challenge options as JSON.

**`LoginFinishHandler(wa *webauthn.WebAuthn, db *sql.DB, cfg config.Config, cs *ChallengeStore) http.HandlerFunc`** [req.38glsd, req.myorh8]
- Accepts `{"email": "..."}` plus the WebAuthn credential response body.
- Calls `cs.Get(email)`; returns `401` if missing or expired.
- Calls `wa.FinishLogin`, updates the credential sign count via `db.UpdateCredentialSignCount`.
- Calls `cs.Delete(email)`.
- Generates and returns a JWT via `jwt.GenerateToken` with `cfg.JWTExpiry` [req.ou3x03].

**`RegisterBeginHandler(wa *webauthn.WebAuthn, db *sql.DB, cfg config.Config, cs *ChallengeStore) http.HandlerFunc`** [req.onj6fp, req.m50le9]
- Accepts `{"email": "..."}`.
- Returns `403` if `CountUsers > 0` and `!cfg.AllowUserCreation`.
- Calls `wa.BeginRegistration`, stores session data via `cs.Set(email, sessionData)`.
- Returns the WebAuthn registration options as JSON.

**`RegisterFinishHandler(wa *webauthn.WebAuthn, db *sql.DB, cs *ChallengeStore) http.HandlerFunc`** [req.onj6fp, req.32nb8u]
- Accepts `{"email": "..."}` plus the WebAuthn attestation response body.
- Calls `cs.Get(email)`; returns `401` if missing or expired.
- Calls `wa.FinishRegistration`, saves user and credential via `db.CreateUser` + `db.SaveCredential`.
- Calls `cs.Delete(email)`.

### `internal/auth/pairing.go` (created) [req.sq63yf, req.hq0gcy, req.zjyw4e, req.k5powd, req.ehjrlx, req.8fttif]

**`PairStartHandler(db *sql.DB, cfg config.Config) http.HandlerFunc`** [req.sq63yf, req.zjyw4e, req.k5powd]
- Accepts `{"username": "..."}`.
- Looks up the user by email; returns `404` if not found.
- Attempts up to 5 times to generate and insert a pairing code:
  - Generates a cryptographically random 6-character alphanumeric code.
  - Calls `db.CreatePairingCode` with `expiresAt = now + cfg.PairingCodeExpiry`.
  - On unique constraint error, retries with a new code. On any other error, returns 500.
- Returns `500` if all 5 attempts fail (should never happen in practice).
- Returns `{"code": "..."}`.

**`PairExchangeHandler(wa *webauthn.WebAuthn, db *sql.DB) http.HandlerFunc`**
- Called by the web client (requires JWT auth — the user is already logged in via WebAuthn in the web client).
- Accepts `{"code": "..."}`.
- Fetches the pairing code; returns `400` if not found, already used, or expired.
- Calls `db.ApprovePairingCode` to mark it as approved.
- Returns `200 OK`. The web client then shows the same code back to the user to paste into the CLI.

**`PairCompleteHandler(db *sql.DB, cfg config.Config) http.HandlerFunc`** [req.hq0gcy, req.ehjrlx, req.8fttif]
- Called by the CLI.
- Accepts `{"code": "..."}`.
- Fetches the pairing code; returns `400` if not found, already used, expired, or not yet approved.
- Generates a JWT via `jwt.GenerateToken` with `cfg.JWTPairExpiry` [req.8fttif].
- Marks the code as used via `db.MarkPairingCodeUsed`.
- Returns `{"token": "..."}`.

---

### `internal/sessions/handler.go` (created) [req.8tey8x, req.3vl4km, req.foiehx, req.wukj7o, req.vb9w44]

All handlers extract `userID` from context (set by JWT middleware) and `session_id` from the URL path.

**`StartHandler(db *sql.DB, hub *Hub) http.HandlerFunc`** [req.8tey8x, req.dkjy5l]
- Decodes the JSON request body into `map[string]any`.
- Extracts the known fields `name`, `hostname`, and `start_time` from the map for the dedicated session columns.
- Serializes the full map (all fields) to JSON and stores it as the session metadata blob.
- Calls `db.CreateSession`.
- Broadcasts `SessionUpdate{Event: "start", ...}` to `hub.Broadcast(userID, ...)` where `userID` comes from the JWT context.

**`PingHandler(db *sql.DB, hub *Hub) http.HandlerFunc`** [req.3vl4km, req.dluknx]
- Retrieves the session from context (populated by `RequireSessionOwner`).
- Calls `db.UpdateSessionPing(id, time.Now())`.
- Broadcasts `SessionUpdate{Event: "ping", ...}` to `hub.Broadcast(session.user_id, ...)`.

**`EndHandler(db *sql.DB, hub *Hub) http.HandlerFunc`** [req.foiehx, req.ke019e]
- Retrieves the session from context (populated by `RequireSessionOwner`).
- Calls `db.EndSession(id, time.Now())`.
- Broadcasts `SessionUpdate{Event: "end", ...}` to `hub.Broadcast(session.user_id, ...)`.

**`MetaHandler(db *sql.DB, hub *Hub) http.HandlerFunc`** [req.wukj7o, req.o1ytg6]
- Retrieves the session from context (populated by `RequireSessionOwner`).
- Decodes the JSON request body into `map[string]any`, serializes it to JSON.
- Calls `db.UpdateSessionMeta(id, metaJSON)`.
- Broadcasts `SessionUpdate{Event: "meta", ...}` to `hub.Broadcast(session.user_id, ...)`.

**`ListHandler(db *sql.DB) http.HandlerFunc`** [req.vb9w44, req.i71v1y]
- Calls `db.GetSessionsByUserID(userID)`.
- Returns the list as JSON.

### `internal/sessions/websocket.go` (created) [req.zcfv5c, req.2q1oku]

**`client` struct**
```go
type client struct {
    conn   *websocket.Conn
    send   chan []byte // buffered; writer goroutine drains this
    userID int64
}
```

**`Hub` struct**
```go
type Hub struct {
    clients map[int64]map[*client]bool // maps userID → set of clients
    mu      sync.RWMutex
}
```

**`NewHub() *Hub`**
- Returns an initialized empty hub.

**`(h *Hub) Register(c *client)`**
- Acquires write lock, adds `c` to the user's set.

**`(h *Hub) Unregister(c *client)`**
- Acquires write lock, removes `c` from the user's set. Deletes the user entry if empty.
- Closes `c.send` to signal the writer goroutine to exit.

**`(h *Hub) Broadcast(userID int64, msg SessionUpdate)`**
- Marshals `msg` to JSON once.
- Acquires read lock, iterates over the user's clients.
- For each client, does a non-blocking send to `c.send`:
  - If the channel is full (client too slow), calls `h.Unregister(c)` and closes `c.conn`.

**`writePump(c *client)`** (unexported, run as a goroutine)
- Reads JSON-encoded messages from `c.send` and writes them to `c.conn`.
- Returns (and the goroutine exits) when `c.send` is closed or a write error occurs.

**`UpdatesHandler(hub *Hub, cfg config.Config) http.HandlerFunc`** [req.zcfv5c]
- Upgrades the request to a WebSocket using `gorilla/websocket`.
- Creates a `client{conn, send: make(chan []byte, 64), userID}`.
- Calls `hub.Register(c)`.
- Starts `go writePump(c)`.
- Reads (and discards) incoming messages in a loop; on read error, calls `hub.Unregister(c)` and returns.

---

### `internal/ssh/handler.go` (created) [req.s9db30, req.uq2b35, req.s8p122]

Uses the `github.com/hullarb/ssheasy` library.

**`RegisterRoutes(mux *http.ServeMux, db *sql.DB, cfg config.Config)`**
- Registers the following routes (JWT required):
  - `GET /api/v1/ssh/connect/{session_id}` — WebSocket endpoint that proxies an SSH connection to the tmux session referenced by `session_id`. Uses ssheasy to negotiate the SSH channel. The target host and session name are looked up from the DB session record.
  - `POST /api/v1/ssh/webauthn/begin` — Begins a WebAuthn assertion ceremony for SSH key authorization.
  - `POST /api/v1/ssh/webauthn/complete` — Completes the assertion, returning a short-lived SSH credential or signed challenge accepted by ssheasy.

**`ConnectHandler(db *sql.DB, cfg config.Config) http.HandlerFunc`** [req.s8p122]
- Looks up the session to get `hostname` and `session_id` (used as tmux session name).
- Upgrades to WebSocket.
- Uses ssheasy to establish an SSH connection to `hostname`, attaching to the tmux session `attach-session -t [session_id]`.
- Bidirectionally pipes the WebSocket to the SSH channel until either side closes.
