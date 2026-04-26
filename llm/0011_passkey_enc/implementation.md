# Implementation Plan: Passkey Encryption

This document describes the implementation plan for cross-device passkey enrollment with master key encryption.

## Data Structures

### SQL Tables

#### `passkey_enrollments` (new table)

```sql
CREATE TABLE IF NOT EXISTS passkey_enrollments (
    code       TEXT(8) PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id),
    expires_at DATETIME NOT NULL,
    completed  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- Code is 8 alphanumeric characters (A-Z, 0-9), stored uppercase without hyphen
- `user_id` is NULL when created by Machine B; set when Machine A connects with JWT

#### `webauthn_credentials` (modified)

Add column:
```sql
ALTER TABLE webauthn_credentials ADD COLUMN encrypted_master_key BLOB;
```

- NULL for legacy credentials created before this feature
- Each passkey stores the master key encrypted with that specific passkey's PRF-derived key

### Go Structs

#### `PasskeyEnrollment` (new) - `internal/db/queries.go`

```go
type PasskeyEnrollment struct {
    Code      string
    UserID    *int64
    ExpiresAt time.Time
    Completed bool
    CreatedAt time.Time
}
```

#### `WebAuthnCredential` (modified) - `internal/db/queries.go`

Add field:
```go
EncryptedMasterKey []byte
```

#### `EnrollmentHub` (new) - `internal/auth/enrollment_ws.go`

Similar to `sessions.Hub`, manages WebSocket connections per enrollment code. Tracks two clients per enrollment (Machine A and Machine B).

```go
type enrollmentClient struct {
    conn      *websocket.Conn
    send      chan []byte
    code      string
    isMachineA bool
    userID    *int64
}

type EnrollmentHub struct {
    enrollments map[string]*enrollmentPair
    mu          sync.RWMutex
}

type enrollmentPair struct {
    machineA *enrollmentClient
    machineB *enrollmentClient
}
```

### TypeScript Types

#### `web/src/lib/crypto/spake2.ts` (new file)

SPAKE2 implementation types:

```typescript
interface Spake2State {
    privateScalar: Uint8Array
    publicElement: Uint8Array
    isPartyA: boolean
}

interface Spake2Result {
    sharedSecret: Uint8Array
    confirmationMac: Uint8Array
}
```

#### `web/src/types/api.ts` (modified)

Add types for enrollment:

```typescript
interface PasskeyEnrollment {
    code: string
}

interface EnrollmentMessage {
    type: 'spake2_a' | 'spake2_b' | 'encrypted_payload'
    message?: string
    nonce?: string
    ciphertext?: string
}
```

---

## Backend Implementation (Go)

### File: `sql/00010_create_passkey_enrollments_table.sql` (new)

Create migration for `passkey_enrollments` table.

### File: `sql/00011_add_encrypted_master_key.sql` (new)

Add `encrypted_master_key` column to `webauthn_credentials`.

### File: `internal/db/queries.go` (modified)

#### `CreatePasskeyEnrollment(db, code, expiresAt)` (new) [req.ofsosx]

Insert a new enrollment record with NULL user_id.

#### `GetPasskeyEnrollment(db, code)` (new)

Fetch enrollment by code. Return nil if not found or expired.

#### `LinkEnrollmentToUser(db, code, userID)` (new) [req.d7zh06]

Update enrollment to set user_id when Machine A connects.

#### `CompleteEnrollment(db, code)` (new)

Mark enrollment as completed.

#### `SaveCredentialWithMasterKey(db, cred, encryptedMasterKey)` (new)

Insert credential with encrypted master key. Used by enrollment complete and register finish.

#### `GetCredentialWithMasterKey(db, userID, credID)` (new)

Fetch a specific credential including its encrypted_master_key.

#### `SaveCredential` (modified)

Add optional encrypted_master_key parameter support.

### File: `internal/auth/enrollment.go` (new)

#### `generateEnrollmentCode()` [req.ofsosx]

Generate 8-character alphanumeric code using `crypto/rand`. Characters are A-Z, 0-9 (36 possible, ~41 bits entropy for 8 chars).

#### `CreateEnrollmentHandler(db)` (new) [req.ofsosx]

- `POST /api/v1/auth/passkeys/enrollment`
- No authentication required (called by Machine B) [req.j5182j]
- Generate enrollment code, store with 5-minute expiry [req.5h2z1o]
- Return `{"code": "A1B2C3D4"}`

#### `EnrollmentBeginHandler(db, wa, cs)` (new) [req.5wwa85]

- `POST /api/v1/auth/passkeys/enrollment/{code}/begin`
- No authentication required (called by Machine B)
- Validate enrollment exists, not expired, not completed, and has user_id set
- Generate WebAuthn credential creation options for the linked user
- Return PublicKeyCredentialCreationOptions

#### `EnrollmentCompleteHandler(db, wa, cs)` (new) [req.juesne]

- `POST /api/v1/auth/passkeys/enrollment/{code}/complete`
- No authentication required (called by Machine B)
- Validate enrollment, verify WebAuthn credential
- Store credential with encrypted_master_key
- Mark enrollment as completed
- Return HTTP 201

#### `GetMasterKeyHandler(db)` (new) [req.qjp17z]

- `GET /api/v1/auth/master-key`
- Requires JWT authentication
- Find user's first credential with encrypted_master_key
- Return `{"encrypted_master_key": "base64..."}`

### File: `internal/auth/enrollment_ws.go` (new)

#### `NewEnrollmentHub()` (new)

Create hub for managing enrollment WebSocket connections.

#### `EnrollmentWebSocketHandler(db, hub, jwtSecret)` (new) [req.trer79, req.np0vt2]

- `GET /api/v1/auth/passkeys/enrollment/{code}`
- WebSocket upgrade handler
- Only two connections allowed per code (one for each machine) [req.trer79]
- Machine B connects first; Machine A connects second with JWT [req.np0vt2]
- Extract code from path
- If no JWT token query param: this is Machine B [req.zbesi6]
  - Validate enrollment exists and not expired
  - Register as Machine B, reject if already connected
- If JWT token present: this is Machine A [req.jt9sgz]
  - Validate JWT, extract user_id
  - Validate enrollment exists and Machine B is connected [req.o16rm6]
  - Link enrollment to user [req.g3ff0v]
  - Register as Machine A
- Relay messages between Machine A and Machine B [req.a0z799]
- If SPAKE2 verification fails on either side, connection is terminated [req.5yd9a7]
- Clean up on disconnect

#### Message relay logic

Server acts as a pure relay. It receives JSON messages and forwards them to the other party. The server cannot decrypt the messages after SPAKE2 completes.

### File: `internal/auth/webauthn.go` (modified)

#### `RegisterFinishHandler` (modified) [req.qhyidm, req.hmhedi, req.9vhwsv, req.wemf9m]

- Accept `encrypted_master_key` in request body
- Store it alongside the credential
- Existing flow unchanged; master key storage is additive

### File: `internal/server/server.go` (modified)

Register new routes:

```go
mux.Handle("POST /api/v1/auth/passkeys/enrollment", auth.CreateEnrollmentHandler(database))
mux.Handle("GET /api/v1/auth/passkeys/enrollment/{code}", auth.EnrollmentWebSocketHandler(database, enrollmentHub, cfg.JWTSecret))
mux.Handle("POST /api/v1/auth/passkeys/enrollment/{code}/begin", auth.EnrollmentBeginHandler(wa, database, cs))
mux.Handle("POST /api/v1/auth/passkeys/enrollment/{code}/complete", auth.EnrollmentCompleteHandler(wa, database, cs))
mux.Handle("GET /api/v1/auth/master-key", jwtMiddleware(http.HandlerFunc(auth.GetMasterKeyHandler(database))))
```

---

## Frontend Implementation (TypeScript/React)

### File: `web/src/lib/crypto/spake2.ts` (new) [req.dwfami, req.43fwpo, req.a71c6e, req.lkx4qh]

SPAKE2 implementation using `@noble/curves` for elliptic curve primitives [req.dwfami]. Follows RFC 9382 [req.43fwpo]. Uses hash-to-curve (RFC 9380) for deriving M and N points [req.a71c6e]. Requires careful implementation and review [req.lkx4qh].

#### `deriveSpake2Params(password: string)` (new) [req.smsrbz, req.b1kyz5]

- Encode password as UTF-8, uppercase, no hyphens [req.smsrbz]
- Use hash-to-curve (RFC 9380) to derive M and N points on P-256

#### `spake2Init(password: string, isPartyA: boolean)` (new)

- Generate random scalar x (or y)
- Compute public element: if party A, pA = w*M + X; if party B, pB = w*N + Y
- Return state object with private scalar and public element

#### `spake2Finish(state: Spake2State, otherPublicElement: Uint8Array)` (new) [req.xuf7hi, req.i3gm0t]

- Compute shared point: if party A, K = x*(pB - w*N); if party B, K = y*(pA - w*M)
- Derive shared secret using HKDF (SHA-256)
- Return shared secret bytes

### File: `web/src/lib/crypto/aes.ts` (new)

AES-256-GCM encryption/decryption using Web Crypto API.

#### `encrypt(key: Uint8Array, plaintext: Uint8Array)` (new) [req.kx0axx]

- Generate random 12-byte nonce using `crypto.getRandomValues()`
- Encrypt with AES-256-GCM via `crypto.subtle`
- Return `{ nonce, ciphertext }`

#### `decrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array)` (new) [req.otuasv]

- Decrypt with AES-256-GCM via `crypto.subtle`
- Return plaintext bytes

#### `deriveKey(sharedSecret: Uint8Array, info: string)` (new)

- Use HKDF with SHA-256 to derive 256-bit key
- Use fixed salt and provided info string

### File: `web/src/lib/crypto/prf.ts` (new)

WebAuthn PRF extension helpers.

#### `getPrfSalt()` (new)

Return fixed salt for PRF extension (consistent across all operations).

#### `deriveMasterKeyFromPrf(prfOutput: Uint8Array)` (new) [req.eejh3t]

- Use HKDF to derive 256-bit key from PRF output
- This key is used to encrypt/decrypt the master key

#### `generateMasterKey()` (new) [req.hmhedi]

- Generate 256-bit random master key using `crypto.getRandomValues()`

### File: `web/src/lib/api.ts` (modified)

#### `createPasskeyEnrollment()` (new) [req.ofsosx]

POST to `/api/v1/auth/passkeys/enrollment`, return `{ code }`.

#### `enrollmentBegin(code: string)` (new) [req.5wwa85]

POST to `/api/v1/auth/passkeys/enrollment/{code}/begin`, return credential options.

#### `enrollmentComplete(code: string, credential: unknown, encryptedMasterKey: string)` (new) [req.juesne]

POST to `/api/v1/auth/passkeys/enrollment/{code}/complete` with credential and encrypted master key.

#### `getMasterKey()` (new) [req.qjp17z]

GET `/api/v1/auth/master-key` with JWT, return `{ encrypted_master_key }`.

#### `getEnrollmentWebSocketURL(code: string, token?: string)` (new)

Build WebSocket URL for enrollment. Include token query param if provided.

#### `registerFinish` (modified) [req.wemf9m]

Add `encrypted_master_key` parameter to request body.

### File: `web/src/pages/AddPasskeyPage.tsx` (new) [req.ebg0n8]

New page for Machine A (authenticated user adding passkey from another device).

#### Component state

- `code`: input field for 8-character code [req.lnezjk]
- `status`: 'idle' | 'connecting' | 'handshaking' | 'transferring' | 'success' | 'error'
- `errorMessage`: string
- `wsConnection`: WebSocket reference

#### UI elements

- Input field for enrollment code (accepts with or without hyphen) [req.lnezjk]
- Display URL to visit on Machine B [req.xg8m17]
- Warning: "Only enter codes from devices YOU control" [req.08hb37]
- "Link device" button [req.dk5jee]
- Status indicator during handshake
- Success/error messages [req.tr1031]
- Cancel button [req.naf7y6]

#### `handleSubmit()` [req.sm41hl, req.erqla1]

SPAKE2 handshake [req.erqla1]:

1. Strip hyphen, validate format (8 alphanumeric chars) [req.40vbd1]
2. Initiate WebAuthn authentication to verify current user identity [req.iw7vre]
3. Use WebAuthn PRF extension to derive the master key decryption key [req.eejh3t]
4. Open WebSocket to `/api/v1/auth/passkeys/enrollment/{code}?token=JWT` [req.jt9sgz]
5. Derive SPAKE2 parameters from the enrollment code [req.smsrbz]
6. Wait for SPAKE2 message B from Machine B [req.kbqskn]
7. Compute SPAKE2 message A, send to Machine B [req.11y9dp]
8. Compute shared secret and derive session encryption key [req.xuf7hi]
9. If SPAKE2 fails (wrong code), display error and allow retry [req.elmvhg]

#### `handleMasterKeyTransfer()` [req.989f5h]

1. Call `getMasterKey()` to get encrypted master key [req.qjp17z]
2. Decrypt master key using PRF-derived key [req.36fdlg]
3. Re-encrypt with SPAKE2-derived session key [req.kx0axx]
4. Send encrypted payload over WebSocket [req.1e8lhh]
5. Wait for confirmation from Machine B
6. Show success message [req.tr1031]

### File: `web/src/pages/RegisterPasskeyPage.tsx` (new) [req.j5182j]

New page for Machine B (registering new passkey on new device).

#### Component state

- `code`: generated enrollment code
- `status`: 'idle' | 'waiting' | 'handshaking' | 'registering' | 'success' | 'error'
- `expiresAt`: countdown timer
- `wsConnection`: WebSocket reference
- `sessionKey`: derived SPAKE2 key

#### UI elements

- "Start" button to begin enrollment [req.vgsxxk]
- Display code prominently with hyphen (e.g., `A1B2-C3D4`) [req.wj9f9q]
- Status indicator ("Waiting for other device...") [req.bnv3m1]
- Expiration countdown (5 minutes) [req.5h2z1o]
- Success/error feedback [req.q9gwaf]
- Cancel button [req.e11s51]

#### `handleStart()` [req.0czjkd]

1. Call `createPasskeyEnrollment()` [req.ofsosx]
2. Display code formatted as XXXX-XXXX [req.wj9f9q]
3. Start 5-minute countdown [req.5h2z1o]
4. Open WebSocket to `/api/v1/auth/passkeys/enrollment/{code}` (no token) [req.zbesi6]
5. Initialize SPAKE2 as party B [req.b1kyz5]
6. Send SPAKE2 message B [req.5b4xmi]
7. Wait for Machine A to connect

#### `handleHandshake()` [req.weg5pl]

1. Receive SPAKE2 message A [req.fu4k2k]
2. Compute shared secret and derive session key [req.i3gm0t]
3. Store session key for decryption

#### `handleMasterKeyReceived(encryptedPayload)` [req.mz1e0l]

1. Decrypt master key using session key [req.otuasv]
2. Call `enrollmentBegin(code)` to get credential options [req.5wwa85]
3. Initiate WebAuthn credential creation with PRF extension [req.014tfk]
4. Encrypt master key with new passkey's PRF-derived key [req.fwfejn]
5. Call `enrollmentComplete()` with credential and encrypted master key [req.juesne]
6. Send confirmation message back to Machine A
7. Show success, redirect to login [req.7z0811]

### File: `web/src/pages/RegisterPage.tsx` (modified)

#### `handleRegister()` (modified) [req.qhyidm]

1. Call `registerBegin()` as before
2. Use WebAuthn with PRF extension enabled
3. Generate random master key [req.hmhedi]
4. Encrypt master key with PRF-derived key [req.9vhwsv]
5. Call `registerFinish()` with credential and encrypted master key [req.wemf9m]

### File: `web/src/App.tsx` (modified)

Add routes:

```tsx
<Route path="/passkeys/add" element={<ProtectedRoute><AddPasskeyPage /></ProtectedRoute>} />
<Route path="/passkeys/enroll" element={<RegisterPasskeyPage />} />
```

### File: `web/src/pages/PasskeyManagementPage.tsx` (modified)

Add link/button to navigate to cross-device passkey enrollment:

- "Add passkey from another device" button that links to `/passkeys/add`

---

## Security Considerations

- Server cannot decrypt messages after SPAKE2 handshake [req.a0z799]
- 8-character code provides ~41 bits entropy (36^8) [req.5h2z1o]
- Attack requires both knowing the code AND having authenticated session on Machine A
- Use constant-time comparison for any secret comparisons
- Clear sensitive key material from memory when possible
- Generate fresh random nonce for each AES-GCM encryption
- SPAKE2 implementation must follow RFC 9382 exactly [req.43fwpo]
