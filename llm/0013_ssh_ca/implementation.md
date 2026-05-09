# SSH CA Implementation

This document describes the implementation of FROST-based threshold signature SSH certificates for devsesh.

## Data Structures

### Database Tables

#### `ssh_ca` (new table) [req.c02qrs] [req.1mujak] [req.v8k2fs]
Stores the CA public key, server's FROST share, and both verification shares per user.

| Column                    | Type                | Description                              |
|---------------------------|---------------------|------------------------------------------|
| `user_id`                 | INTEGER PRIMARY KEY | Foreign key to users                     |
| `public_key`              | BLOB                | Ed25519 CA public key (32 bytes)         |
| `server_share`            | BLOB                | Server's FROST Ed25519 secret share      |
| `server_verifying_share`  | BLOB                | Server's public verification share       |
| `client_verifying_share`  | BLOB                | Client's public verification share       |
| `cert_serial`             | INTEGER             | Current certificate serial number        |
| `created_at`              | DATETIME            | Timestamp                                |

#### `ssh_ca_client_shares` (new table) [req.qwdm15] [req.gvq1jj]
Stores the encrypted client FROST share.

| Column            | Type                | Description                            |
|-------------------|---------------------|----------------------------------------|
| `user_id`         | INTEGER PRIMARY KEY | Foreign key to users                   |
| `encrypted_share` | BLOB                | Client share encrypted with master key |
| `created_at`      | DATETIME            | Timestamp                              |

#### Modify `hosts` table [req.zbf0si] [req.w51l9k]
Add SSH principal column.

| Column          | Type | Description                             |
|-----------------|------|-----------------------------------------|
| `ssh_principal` | TEXT | SSH certificate principal for this host |

#### `cert_audit_log` (new table) [req.xj6amw]
Audit log for certificate issuance.

| Column          | Type                | Description                                         |
|-----------------|---------------------|-----------------------------------------------------|
| `id`            | INTEGER PRIMARY KEY | Auto-increment                                      |
| `user_id`       | INTEGER             | Foreign key to users                                |
| `host_id`       | INTEGER             | Foreign key to hosts (nullable for failed attempts) |
| `serial`        | INTEGER             | Certificate serial (nullable for failed attempts)   |
| `success`       | BOOLEAN             | Whether issuance succeeded                          |
| `error_message` | TEXT                | Error details if failed                             |
| `created_at`    | DATETIME            | Timestamp                                           |

### Go Types

#### `internal/ssh/ca/ca.go` [req.c02qrs] [req.v8k2fs]

```go
type SSHCAData struct {
    UserID               int64
    PublicKey            []byte
    ServerShare          []byte
    ServerVerifyingShare []byte
    ClientVerifyingShare []byte
    CertSerial           int64
    CreatedAt            time.Time
}

type SigningSession struct {
    ID              string
    UserID          int64
    HostID          int64
    TBSData         []byte
    ServerNonces    interface{} // FROST nonces
    Commitment      []byte
    CreatedAt       time.Time
    ExpiresAt       time.Time
}
```

### TypeScript Types

#### `web/src/types/sshca.ts` (new file) [req.0xpudr]

```typescript
interface FROSTShare {
  identifier: Uint8Array
  secretShare: Uint8Array
  groupPublicKey: Uint8Array
  verifyingShare: Uint8Array
}

interface SigningSessionState {
  sessionId: string
  round: 'idle' | 'round1' | 'round2' | 'complete'
  commitment?: Uint8Array
  partialSignature?: Uint8Array
}

interface WorkerMessage {
  type: 'init' | 'round1' | 'round2' | 'status' | 'terminate'
  payload?: unknown
}

interface WorkerResponse {
  type: 'ready' | 'commitment' | 'partial_sig' | 'error' | 'terminated'
  payload?: unknown
}
```

---

## Backend Implementation

### Module: `internal/ssh/ca/ca.go` (new file)

**Dependencies:** `taurushq-io/multi-party-sig` [req.c02qrs]

#### `GenerateKeyShares() (KeyShares, error)` [req.c02qrs] [req.v8k2fs]
Generate new FROST 2-of-2 Ed25519 key shares during user registration.
- Use `bytemare/frost` TrustedDealerKeygen for Ed25519 FROST
- Return `KeyShares` struct containing:
  - `PublicKey`: group public key (CA public key, 32 bytes)
  - `ServerShare`: server's encoded secret key share (KeyShare)
  - `ClientShare`: client's encoded secret key share (KeyShare, encrypted by caller before storage)
  - `ServerVerifyingShare`: server's encoded PublicKeyShare (~103 bytes, includes ID, public key, VSS commitment)
  - `ClientVerifyingShare`: client's encoded PublicKeyShare (~103 bytes, includes ID, public key, VSS commitment)
- PublicKeyShare structs are public information and stored plaintext
- PublicKeyShares are needed to set up `frost.Configuration` during signing sessions

#### `CreateTBSCertificate(publicKey []byte, principal string, serial uint64, validSeconds int) (tbsData []byte, error)` [req.umkdzs] [req.zbf0si] [req.2x3a51] [req.56dvhi]
Build certificate-to-be-signed data.
- Create `ssh-ed25519-cert-v01@openssh.com` user certificate structure
- Set principals from host configuration
- Add extensions: `permit-pty`, `permit-port-forwarding`
- Set validity window (default 60 seconds, max 5 minutes)
- Use monotonically increasing serial per user

### Module: `internal/ssh/ca/frost.go` (new file)

Contains the FROST signing protocol implementation.

#### `FROSTSigningState` struct
Holds state between FROST signing rounds:
- `Signer`: the FROST signer with internal nonce state
- `ServerCommitment`: the server's commitment from Round 1
- `Configuration`: the FROST configuration for this session

#### `ServerRound1(serverShare, serverPublicKeyShare, clientPublicKeyShare, publicKey, message []byte) (commitment []byte, state *FROSTSigningState, error)` [req.5xcc6i] [req.ey98nq] [req.v8k2fs]
Server's FROST round 1: generate nonces and commitment.
- Decode server's KeyShare and both PublicKeyShares
- Set up FROST Configuration with threshold=2, maxSigners=2
- Create Signer and call Commit() to generate fresh nonces
- Return encoded commitment and FROSTSigningState for Round 2

#### `ServerRound2(state *FROSTSigningState, clientCommitment, message []byte) (partialSig []byte, error)` [req.o3lf24]
Server's FROST round 2: compute partial signature.
- Decode client's commitment
- Build commitment list with both commitments (sorted by signer ID)
- Call Sign() to compute server's partial signature
- Return encoded signature share

#### `AggregateSignatures(state *FROSTSigningState, serverPartial, clientPartial, clientCommitment, message []byte) (signature []byte, error)` [req.dzym7r]
Combine partial signatures into final Ed25519 signature.
- Decode both partial signatures
- Aggregate using Configuration.AggregateSignatures()
- Verify combined signature against group public key
- Return 64-byte Ed25519 signature (R || S format)

#### `CreateClientSigner(clientShare, serverPublicKeyShare, clientPublicKeyShare, publicKey []byte) (*frost.Signer, *frost.Configuration, error)`
**Used for testing only.** Creates a FROST signer for the client side.
- In production, the client-side signing is done in TypeScript using `@noble/curves`
- This function is used in Go unit tests to simulate the client's participation in the signing protocol
- Returns a configured Signer ready to generate commitments and partial signatures

#### `ZeroSigningState(state *FROSTSigningState)`
Securely clears the signing state from memory by setting all fields to nil.

#### `BuildSignedCertificate(tbsData, signature []byte) (cert []byte, error)` [req.jki5t0]
Assemble final signed certificate.
- Combine TBS data with signature
- Format as OpenSSH certificate wire format
- Return base64-encoded certificate

### Module: `internal/ssh/ca/handler.go` (new file)

**Dependencies:** `gorilla/websocket` [req.5kl1v5]

#### `HandleSigningWebSocket(w http.ResponseWriter, r *http.Request)` [req.5kl1v5] [req.o9pemq] [req.hs8zrm]
WebSocket handler for FROST signing protocol.
- Authenticate via JWT (first message or header)
- Validate host ownership
- Manage signing session lifecycle
- Handle round1/round2 messages
- Enforce 60-second session timeout [req.tie4zq]
- Clean up on disconnect or error [req.3zw1de]

#### Message types:
```go
type WSMessage struct {
    Type    string `json:"type"` // "request_cert", "round1", "round2"
    HostID  int64  `json:"host_id,omitempty"`
    Payload []byte `json:"payload,omitempty"`
}

type WSResponse struct {
    Type       string `json:"type"` // "session", "commitment", "certificate", "error"
    SessionID  string `json:"session_id,omitempty"`
    Payload    []byte `json:"payload,omitempty"`
    Error      string `json:"error,omitempty"`
}
```

### Module: `internal/db/sshca.go` (new file)

#### `CreateSSHCA(db *sql.DB, ca SSHCAData) error`
Store new CA data for user.

#### `GetSSHCA(db *sql.DB, userID int64) (*SSHCAData, error)`
Retrieve CA data for user.

#### `IncrementCertSerial(db *sql.DB, userID int64) (int64, error)` [req.56dvhi]
Atomically increment and return next certificate serial.

#### `SaveClientShare(db *sql.DB, userID int64, encryptedShare []byte) error` [req.qwdm15]
Store encrypted client share.

#### `GetClientShare(db *sql.DB, userID int64) ([]byte, error)`
Retrieve encrypted client share for transmission to client.

#### `LogCertIssuance(db *sql.DB, userID, hostID int64, serial int64, success bool, errMsg string) error` [req.xj6amw]
Record certificate issuance attempt in audit log.

### Module: `internal/ssh/ca/session.go` (new file)

#### `SessionManager` struct [req.1i6osk] [req.tie4zq]
In-memory signing session storage with expiration using actor model.

```go
type sessionCmd struct {
    op       string // "create", "get", "delete"
    id       string
    userID   int64
    hostID   int64
    tbsData  []byte
    respChan chan sessionResp
}

type sessionResp struct {
    session *SigningSession
    err     error
}

type SessionManager struct {
    cmdChan chan sessionCmd
}
```

#### `NewSessionManager() *SessionManager`
Create new session manager that spawns actor goroutine.
- Actor goroutine owns `map[string]*SigningSession`
- Processes commands sequentially via channel
- Runs cleanup ticker to expire old sessions

#### `CreateSession(userID, hostID int64, tbsData []byte) (*SigningSession, error)` [req.1i6osk]
Send create command to actor, receive new session with UUID and 60-second expiry.

#### `GetSession(sessionID string) (*SigningSession, error)`
Send get command to actor, receive session or error if expired/not found.

#### `DeleteSession(sessionID string)` [req.3zw1de]
Send delete command to actor, which removes session and clears sensitive data.

### Module: `internal/util/ratelimit.go` (reuses generic RateLimiter)

#### `RateLimiter` struct [req.zp9nw1]
Per-user rate limiting for certificate requests using actor model.

```go
type rateLimitCmd struct {
    userID   int64
    respChan chan bool
}

type RateLimiter struct {
    cmdChan chan rateLimitCmd
}
```

#### `NewRateLimiter(limit int, window time.Duration) *RateLimiter`
Create rate limiter that spawns actor goroutine.
- Actor goroutine owns `map[int64][]time.Time`
- Processes allow-check commands sequentially
- Periodically cleans up old timestamps (default: 10 certs per minute per user)

#### `Allow(userID int64) bool`
Send check command to actor, receive whether user can request another certificate.

### Module: `internal/ctxutil/context.go` (new file)

Extract shared context utilities to break import cycle between `auth`, `sessions`, and `ssh/ca`.

```go
package ctxutil

import (
	"context"

	"github.com/leolimasa/devsesh/internal/db"
)

type contextKey string

const (
	ContextKeyUserID  contextKey = "userID"
	ContextKeyHostID  contextKey = "hostID"
	ContextKeySession contextKey = "session"
)

// UserIDFromContext extracts user ID from request context.
func UserIDFromContext(ctx context.Context) (int64, bool) {
	userID, ok := ctx.Value(ContextKeyUserID).(int64)
	return userID, ok
}

// HostIDFromContext extracts host ID from request context.
func HostIDFromContext(ctx context.Context) (int64, bool) {
	hostID, ok := ctx.Value(ContextKeyHostID).(int64)
	return hostID, ok
}

// SessionFromContext extracts session from request context.
func SessionFromContext(ctx context.Context) (*db.Session, bool) {
	session, ok := ctx.Value(ContextKeySession).(*db.Session)
	return session, ok
}
```

**Update existing packages:**
- `internal/auth`: Remove context key definitions, import `ctxutil` instead
- `internal/sessions`: Import `ctxutil` instead of `auth` for context utilities
- `internal/ssh/ca`: Import `ctxutil` instead of `sessions` for `UserIDFromContext`

### Module: `internal/auth/webauthn.go` (modify)

#### Modify `FinishRegistration` [req.ancud7]
After successful registration with PRF:
- Call `ca.GenerateKeyShares()` to create FROST shares (import `internal/ssh/ca`)
- Store server share in `ssh_ca` table
- Encrypt client share with random key, store in `ssh_ca_client_shares`
- Return encrypted client share to frontend (will be re-encrypted with master key)

### Module: `internal/hosts/handlers.go` (modify)

#### Modify `UpdateHost` [req.w51l9k]
Add `ssh_principal` field handling.

#### Modify `CreateHost`
Add `ssh_principal` field handling.

### Module: `internal/server/server.go` (modify)

#### Add routes:
- `GET /api/v1/sshca/public-key` - Download CA public key [req.23hk63]
- `GET /api/v1/sshca/client-share` - Get encrypted client share
- `WS /api/v1/sshca/sign` - WebSocket signing endpoint [req.5kl1v5]

---

## Frontend Implementation

### Module: `web/src/workers/frost-worker.ts` (new file) [req.qwdm15] [req.gvq1jj]

**Dependencies:** `@noble/curves`, `@noble/hashes` [req.0xpudr] [req.jap7ew]

Web Worker that holds FROST share in memory.

#### `self.onmessage` handler [req.xxu1i4]
Handle messages from main thread:
- `init`: Store decrypted share, start inactivity timer
- `round1`: Generate nonces, compute commitment
- `round2`: Compute partial signature from received commitment
- `status`: Return current state
- `terminate`: Zero share from memory and close [req.obmwbr]

#### `let inactivityTimer: number` [req.2k5is9]
30-minute (configurable) timer that auto-terminates worker.
Reset on each signing operation.

#### `function zeroMemory(data: Uint8Array)` [req.obmwbr]
Securely overwrite share data before releasing.

#### Share storage pattern:
```typescript
let share: Uint8Array | null = null

function clearShare() {
  if (share) {
    share.fill(0)
    share = null
  }
}
```

### Module: `web/src/lib/frost-client.ts` (new file) [req.0xpudr]

#### `class FROSTClient`
Manages communication with FROST worker.

#### `constructor()` [req.qwdm15]
Spawn web worker, set up message handlers.

#### `async initWithShare(encryptedShare: Uint8Array, masterKey: Uint8Array): Promise<void>` [req.qogtvx]
Decrypt share using master key and initialize worker.

#### `async requestCertificate(hostId: number): Promise<string>` [req.3j5hnq]
High-level API to perform complete signing flow:
1. Open WebSocket to `/api/v1/sshca/sign`
2. Send certificate request for host
3. Receive TBS data and session info [req.wdalb2]
4. Perform round 1 via worker [req.5xcc6i]
5. Exchange commitments with server
6. Perform round 2 via worker [req.o3lf24]
7. Send partial signature to server
8. Receive completed certificate [req.jki5t0]

#### `isActive(): boolean` [req.35jehk]
Check if worker is active and share is loaded.

#### `getRemainingTime(): number` [req.35jehk]
Get remaining time before worker auto-terminates.

#### `terminate(): void` [req.obmwbr]
Manually terminate worker and clear share.

### Module: `web/src/lib/crypto/frost.ts` (new file) [req.0xpudr]

FROST Ed25519 cryptographic operations using `@noble/curves`.

**Note:** This is the production client-side implementation. The Go function `CreateClientSigner()` in `internal/ssh/ca/frost.go` serves the same purpose but is only used for testing the server-side code.

#### `function generateNonces(): { hiding: Uint8Array, binding: Uint8Array }`  [req.ey98nq]
Generate fresh nonces for signing round.

#### `function computeCommitment(nonces: { hiding: Uint8Array, binding: Uint8Array }): Uint8Array` [req.5xcc6i]
Compute commitment from nonces.

#### `function computePartialSignature(share: Uint8Array, nonces: object, message: Uint8Array, allCommitments: Uint8Array[]): Uint8Array` [req.o3lf24]
Compute partial signature for round 2.

### Module: `web/src/contexts/FROSTContext.tsx` (new file)

React context for FROST client state.

#### `FROSTProvider`
Manages FROSTClient instance and status.

#### `useFROST()` hook
Access FROST client and status:
- `client: FROSTClient | null`
- `isActive: boolean`
- `remainingTime: number`
- `initWorker: (masterKey: Uint8Array) => Promise<void>`

### Module: `web/src/components/WorkerStatusIndicator.tsx` (new file) [req.35jehk]

Display webworker status in UI.
- Show active/inactive state
- Display countdown timer when active
- Pulsing indicator when worker is ready

### Module: `web/src/components/CAPublicKeyDownload.tsx` (new file) [req.23hk63] [req.0lpwy4]

Component to download CA public key.
- Fetch from `/api/v1/sshca/public-key`
- Display SHA256 fingerprint
- Download button (OpenSSH format)

### Module: `web/src/components/HostForm.tsx` (modify) [req.w51l9k]

Add SSH principal field to host edit form.

### Module: `web/src/pages/RegisterPage.tsx` (modify)

After successful PRF-based registration:
- Fetch encrypted client share from backend
- Re-encrypt with PRF-derived master key
- Store in appropriate location for later retrieval

### Module: `web/wasm/sshclient/client.go` (modify)

#### Modify `Connect` function auth methods
Add certificate authentication as primary method:
```go
Auth: []ssh.AuthMethod{
    ssh.PublicKeysCallback(func() ([]ssh.Signer, error) {
        // Get certificate from FROSTClient via callback
        // Return certificate signer if available
    }),
    ssh.PasswordCallback(func() (string, error) {
        // Fallback to password
    }),
}
```

#### Add `SetCertificateCallback(callback js.Value)`
Register callback to request certificate from frontend.

### Module: `web/src/lib/ssh-client.ts` (modify)

#### Modify `connect` method [req.4oofln]
Before connecting:
1. Check if FROST worker is active
2. If not active, prompt for WebAuthn authentication
3. Initialize worker with master key
4. Request certificate for target host
5. Pass certificate to WASM client

### Module: `web/src/components/SSHTerminal.tsx` (modify) [req.4oofln]

Integrate with FROST client:
- Check worker status before connecting
- Trigger WebAuthn prompt if needed
- Show certificate request progress

---

## Integration Test

### File: `integration_tests/tests/ssh-ca-e2e.spec.ts` (new file) [req.jc1drs]

#### `test('SSH CA certificate authentication works end-to-end')`

1. Register new user with WebAuthn + PRF [req.ancud7]
   - Verify CA public key is created
   - Verify encrypted client share is stored

2. Start SSH container with CA trust [req.vz2fg3] [req.17dfwk]
   - Modify container to accept CA public key
   - Add flag file [req.cu1f0k]

3. Create host with principal [req.4whcli]
   - No password set
   - Principal matches container user

4. Connect via web interface [req.twjlw7]
   - WebAuthn PRF authentication
   - FROST worker initialization
   - Certificate signing

5. Verify connection [req.xbft6g]
   - Execute `cat FLAG_FILE`
   - Validate output matches expected content

### File: `integration_tests/ssh/Dockerfile` (modify) [req.17dfwk]

Add CA trust configuration:
```dockerfile
# Accept CA-signed certificates
COPY ca_setup.sh /ca_setup.sh
RUN chmod +x /ca_setup.sh
```

### File: `integration_tests/ssh/ca_setup.sh` (new file) [req.17dfwk]

Script to configure SSH CA trust:
- Accept CA public key via environment variable
- Configure `TrustedUserCAKeys` in sshd_config
- Set `AuthorizedPrincipalsFile`

### File: `integration_tests/ssh/entrypoint.sh` (modify) [req.17dfwk] [req.cu1f0k]

- Call CA setup script if CA_PUBLIC_KEY is provided
- Create flag file with known content

---

## Database Migrations

### `sql/00012_create_ssh_ca_table.sql` (new file)
```sql
CREATE TABLE ssh_ca (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    public_key BLOB NOT NULL,
    server_share BLOB NOT NULL,
    server_verifying_share BLOB NOT NULL,
    client_verifying_share BLOB NOT NULL,
    cert_serial INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### `sql/00013_create_ssh_ca_client_shares_table.sql` (new file)
```sql
CREATE TABLE ssh_ca_client_shares (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    encrypted_share BLOB NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### `sql/00014_add_ssh_principal_to_hosts.sql` (new file)
```sql
ALTER TABLE hosts ADD COLUMN ssh_principal TEXT;
```

### `sql/00015_create_cert_audit_log_table.sql` (new file)
```sql
CREATE TABLE cert_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    host_id INTEGER REFERENCES hosts(id),
    serial INTEGER,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cert_audit_log_user_id ON cert_audit_log(user_id);
CREATE INDEX idx_cert_audit_log_created_at ON cert_audit_log(created_at);
```

---

## Configuration

### Add to `config.Config` struct [req.2k5is9] [req.u72wa2]

```go
type SSHCAConfig struct {
    WorkerTimeout     time.Duration `yaml:"worker_timeout"`      // Default: 30m
    CertValiditySecs  int           `yaml:"cert_validity_secs"`  // Default: 60, max: 300
    RateLimitPerMin   int           `yaml:"rate_limit_per_min"`  // Default: 10
}
```

---

## Security Considerations

1. **Share isolation** [req.qwdm15]: Client share never leaves webworker context
2. **Memory zeroing** [req.obmwbr]: Share overwritten before worker termination
3. **Nonce freshness** [req.ey98nq]: New nonces generated for every signing session
4. **Session expiration** [req.tie4zq]: 60-second timeout prevents stale sessions
5. **Single-use sessions** [req.1i6osk]: UUID-based sessions cannot be reused
6. **Rate limiting** [req.zp9nw1]: Prevent certificate flooding
7. **Audit logging** [req.xj6amw]: All issuance attempts recorded
8. **Host ownership** [req.hs8zrm]: Server validates user owns target host
9. **JWT authentication** [req.o9pemq]: All signing requests authenticated
10. **PRF requirement** [req.qogtvx]: Master key derivation requires WebAuthn PRF
