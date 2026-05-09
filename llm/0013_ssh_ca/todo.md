# SSH CA Implementation Todo

## Project Status

- 🟢 Phase 1: Database Schema & Go Dependencies - COMMITTED
- 🟢 Phase 2: FROST Key Generation & Certificate Building - COMMITTED
- 🟡 Phase 3: Session Management & Rate Limiting - IMPLEMENTED
- 🟡 Phase 3.5: Add Verification Shares to KeyShares - IMPLEMENTED
- 🟡 Phase 4a: FROST Signing Protocol (frost.go) - IMPLEMENTED
- 🟡 Phase 4b: WebSocket Handler & Routes - IMPLEMENTED
- 🔴 Phase 5: User Registration Integration - NOT STARTED
- 🟡 Phase 6: Frontend TypeScript Dependencies & Types - IMPLEMENTED
- 🔴 Phase 7: FROST Crypto Library (Frontend) - NOT STARTED
- 🔴 Phase 8: FROST Web Worker - NOT STARTED
- 🔴 Phase 9: FROST Client Library - NOT STARTED
- 🔴 Phase 10: Frontend UI Components - NOT STARTED
- 🔴 Phase 11: SSH Client Integration - NOT STARTED
- 🔴 Phase 12: Docker Container CA Support - NOT STARTED
- 🔴 Phase 13: Integration Test - NOT STARTED
- 🔴 Phase 14: Final Validation - NOT STARTED

---

## Phase 1: Database Schema & Go Dependencies

- [x] Add `taurushq-io/multi-party-sig` dependency to go.mod [req.c02qrs]
- [x] Create migration `sql/00012_create_ssh_ca_table.sql` [req.c02qrs] [req.1mujak]
- [x] Create migration `sql/00013_create_ssh_ca_client_shares_table.sql` [req.qwdm15] [req.gvq1jj]
- [x] Create migration `sql/00014_add_ssh_principal_to_hosts.sql` [req.zbf0si] [req.w51l9k]
- [x] Create migration `sql/00015_create_cert_audit_log_table.sql` [req.xj6amw]
- [x] Create `internal/db/sshca.go` with database functions:
  - [x] `CreateSSHCA()`
  - [x] `GetSSHCA()`
  - [x] `IncrementCertSerial()` [req.56dvhi]
  - [x] `SaveClientShare()` [req.qwdm15]
  - [x] `GetClientShare()`
  - [x] `LogCertIssuance()` [req.xj6amw]
- [x] Update `internal/db/queries.go` Host struct with `SSHPrincipal` field [req.zbf0si]
- [x] Update host CRUD functions to handle `ssh_principal` column
- [x] Add `SSHCAConfig` to `internal/config/config.go` [req.2k5is9] [req.u72wa2]

**Phase 1 Testing:**
- [x] Run migrations: `go run main.go migrate`
- [x] Verify tables exist: `sqlite3 devsesh.db ".schema ssh_ca"`, `.schema ssh_ca_client_shares`, `.schema cert_audit_log`
- [x] Verify hosts table has ssh_principal: `sqlite3 devsesh.db ".schema hosts"`
- [x] Run `go build ./...` to verify compilation

---

## Phase 2: FROST Key Generation & Certificate Building

- [x] Create `internal/ssh/ca.go` with `SSHCAData` and `SigningSession` structs [req.c02qrs]
- [x] Create `internal/ssh/ca.go`:
  - [x] `GenerateKeyShares()` - FROST 2-of-2 Ed25519 keygen [req.c02qrs]
  - [x] `CreateTBSCertificate()` - build certificate structure [req.umkdzs] [req.zbf0si] [req.2x3a51] [req.56dvhi]
  - [x] `BuildSignedCertificate()` - assemble final certificate [req.jki5t0]
- [x] Create `internal/ssh/ca_test.go`:
  - [x] Test key share generation produces valid shares
  - [x] Test TBS certificate has correct format and extensions
  - [x] Test certificate assembly produces valid OpenSSH certificate

**Phase 2 Testing:**
- [x] Run unit tests: `go test ./internal/ssh/... -v`

---

## Phase 3: Session Management & Rate Limiting (Actor Model)

- [x] Create `internal/ssh/ca/session.go` with actor-based `SessionManager` [req.1i6osk] [req.tie4zq]:
  - [x] `NewSessionManager()` - spawn actor goroutine
  - [x] `CreateSession()` - UUID generation, 60-second expiry [req.1i6osk]
  - [x] `GetSession()` - retrieve or error if expired
  - [x] `DeleteSession()` - cleanup sensitive data [req.3zw1de]
  - [x] Cleanup ticker for expired sessions
- [x] Create `internal/ssh/ca/session.go` with actor-based `SessionManager` [req.1i6osk] [req.tie4zq]:
  - [x] `NewSessionManager()` - spawn actor goroutine
  - [x] `CreateSession()` - UUID generation, 60-second expiry [req.1i6osk]
  - [x] `GetSession()` - retrieve or error if expired
  - [x] `DeleteSession()` - cleanup sensitive data [req.3zw1de]
  - [x] Cleanup ticker for expired sessions
- [x] Use `internal/util/ratelimit.go` (generic RateLimiter) [req.zp9nw1]:
  - [x] `NewRateLimiter()` - spawn actor goroutine
  - [x] `Allow()` - check rate limit (10/minute default)
  - [x] Periodic cleanup of old timestamps
- [x] Create `internal/ssh/ca/session_test.go`:
  - [x] Test session creation returns unique UUIDs
  - [x] Test session expiration after 60 seconds
  - [x] Test concurrent session access via actor
- [x] Create `internal/util/ratelimit_test.go`:
  - [x] Test allows up to limit requests
  - [x] Test blocks after limit exceeded
  - [x] Test window resets after time passes

**Phase 3 Testing:**
- [x] Run unit tests: `go test ./internal/ssh/ca/... -v -race`

---

## Phase 3.5: Add Verification Shares to KeyShares [req.v8k2fs]

- [x] Create migration `sql/00016_add_verification_shares_to_ssh_ca.sql`:
  - [x] Add `server_verifying_share BLOB NOT NULL`
  - [x] Add `client_verifying_share BLOB NOT NULL`
- [x] Update `internal/ssh/ca/ca.go` `KeyShares` struct:
  - [x] Add `ServerVerifyingShare []byte`
  - [x] Add `ClientVerifyingShare []byte`
- [x] Update `GenerateKeyShares()` to extract and return both verification shares
- [x] Update `internal/db/sshca.go`:
  - [x] Update `SSHCAData` struct with verification share fields
  - [x] Update `CreateSSHCA()` to store verification shares
  - [x] Update `GetSSHCA()` to retrieve verification shares

**Phase 3.5 Testing:**
- [x] Run `go test ./internal/ssh/ca/... -v` to verify key generation includes verification shares
- [x] Run `go test ./internal/db/... -v` to verify migration test passes

---

## Phase 4a: FROST Signing Protocol (frost.go)

- [x] Add to `internal/ssh/ca/frost.go`:
  - [x] `FROSTSigningState` struct - holds state between signing rounds
  - [x] `ServerRound1()` - generate nonces, return commitment (uses PublicKeyShares for Configuration) [req.5xcc6i] [req.ey98nq] [req.v8k2fs]
  - [x] `ServerRound2()` - compute partial signature [req.o3lf24]
  - [x] `AggregateSignatures()` - combine partials into final 64-byte Ed25519 sig [req.dzym7r]
  - [x] `CreateClientSigner()` - **for testing only** - simulates client-side FROST signer in Go tests (actual client uses TypeScript/@noble/curves)
  - [x] `ZeroSigningState()` - securely clear signing state from memory
- [x] Add FROST signing tests to `internal/ssh/ca/frost_test.go`:
  - [x] Test round 1 produces valid commitment
  - [x] Test round 2 produces valid partial signature
  - [x] Test signature aggregation produces verifiable Ed25519 signature
  - [x] Test nonces are never reused [req.ey98nq]
  - [x] Test full signing flow with SSH certificate

**Phase 4a Testing:**
- [x] Run unit tests: `go test ./internal/ssh/ca/... -v`

---

## Phase 4b: WebSocket Handler & Routes

- [x] Create `internal/ssh/ca/handler.go` WebSocket handler [req.5kl1v5]:
  - [x] JWT authentication on connection [req.o9pemq]
  - [x] Host ownership validation [req.hs8zrm]
  - [x] Handle `request_cert` message - create session, build TBS [req.wdalb2]
  - [x] Handle `round1` message - exchange commitments [req.5xcc6i]
  - [x] Handle `round2` message - exchange partial signatures [req.o3lf24]
  - [x] Send final certificate [req.jki5t0]
  - [x] Session timeout handling [req.tie4zq]
  - [x] Error cleanup [req.3zw1de]
  - [x] Retry support [req.9e2ob6]
- [x] Register routes in `internal/server/server.go`:
  - [x] `GET /api/v1/sshca/public-key` [req.23hk63]
  - [x] `GET /api/v1/sshca/client-share`
  - [x] `WS /api/v1/sshca/sign` [req.5kl1v5]

**Phase 4b Testing:**
- [x] Manual test: Start server, verify `/api/v1/sshca/public-key` returns 404 (no user yet)

---

## Phase 5: User Registration Integration

**Prerequisite: Break import cycle by extracting context utilities**

- [ ] Create `internal/ctxutil/context.go`:
  - [ ] Move `ContextKeyUserID`, `ContextKeyHostID`, `ContextKeySession` from `auth`
  - [ ] Move `UserIDFromContext()`, `HostIDFromContext()` from `auth`
  - [ ] Add `SessionFromContext()` helper
- [ ] Update `internal/auth/`:
  - [ ] Remove context key definitions
  - [ ] Import `ctxutil` for context keys and helpers
- [ ] Update `internal/sessions/handler.go`:
  - [ ] Replace `auth` import with `ctxutil` for context utilities
- [ ] Update `internal/ssh/ca/handler.go`:
  - [ ] Replace `sessions` import with `ctxutil` for `UserIDFromContext`
- [ ] Verify no import cycles: `go build ./...`

**Registration integration:**

- [ ] Modify `internal/auth/webauthn.go` `FinishRegistration` [req.ancud7]:
  - [ ] Call `ca.GenerateKeyShares()` after successful registration (import `internal/ssh/ca`)
  - [ ] Store server share in `ssh_ca` table
  - [ ] Encrypt client share, store in `ssh_ca_client_shares`
  - [ ] Return encrypted client share in registration response
- [ ] Update `internal/hosts/handlers.go`:
  - [ ] Modify `CreateHost` to handle `ssh_principal` [req.w51l9k]
  - [ ] Modify `UpdateHost` to handle `ssh_principal` [req.w51l9k]

**Phase 5 Testing:**
- [ ] Run `go build ./...` to verify no import cycles
- [ ] Run existing auth tests: `go test ./internal/auth/... -v`
- [ ] Run existing sessions tests: `go test ./internal/sessions/... -v`
- [ ] Run existing ssh/ca tests: `go test ./internal/ssh/ca/... -v`
- [ ] Manual test: Register new user, verify `ssh_ca` and `ssh_ca_client_shares` tables populated
- [ ] Verify `GET /api/v1/sshca/public-key` returns CA public key for authenticated user

---

## Phase 6: Frontend TypeScript Dependencies & Types

- [x] Add `@noble/curves` to web/package.json [req.0xpudr]
- [x] Add `@noble/hashes` to web/package.json [req.jap7ew]
- [ ] Create `web/src/types/sshca.ts` with TypeScript interfaces [req.0xpudr]:
  - [ ] `FROSTShare`
  - [ ] `SigningSessionState`
  - [ ] `WorkerMessage`
  - [ ] `WorkerResponse`

**Phase 6 Testing:**
- [ ] Run `cd web && npm install`
- [ ] Run `cd web && npm run build` to verify types compile

---

## Phase 7: FROST Crypto Library (Frontend)

- [ ] Create `web/src/lib/crypto/frost.ts` [req.0xpudr]:
  - [ ] `generateNonces()` - fresh nonces for signing [req.ey98nq]
  - [ ] `computeCommitment()` - compute commitment from nonces [req.5xcc6i]
  - [ ] `computePartialSignature()` - compute partial sig [req.o3lf24]
  - [ ] `deserializeShare()` - parse share from bytes
  - [ ] `serializeCommitment()` - encode commitment for transmission
- [ ] Create `web/src/lib/crypto/frost.test.ts`:
  - [ ] Test nonce generation produces unique values
  - [ ] Test commitment computation
  - [ ] Test partial signature computation with known test vectors

**Phase 7 Testing:**
- [ ] Run `cd web && npm test -- frost`

---

## Phase 8: FROST Web Worker

- [ ] Create `web/src/workers/frost-worker.ts` [req.qwdm15] [req.gvq1jj]:
  - [ ] `onmessage` handler for: init, round1, round2, status, terminate [req.xxu1i4]
  - [ ] Share storage in worker-local variable (not accessible from main thread) [req.qwdm15]
  - [ ] `zeroMemory()` function to clear share [req.obmwbr]
  - [ ] Inactivity timer (30 minutes default) [req.2k5is9]
  - [ ] Auto-terminate on timeout [req.obmwbr]
- [ ] Configure Vite to bundle worker separately

**Phase 8 Testing:**
- [ ] Run `cd web && npm run build` to verify worker bundles
- [ ] Create manual test page that loads worker and verifies message passing

---

## Phase 9: FROST Client Library

- [ ] Create `web/src/lib/frost-client.ts` [req.0xpudr]:
  - [ ] `FROSTClient` class [req.qwdm15]
  - [ ] `constructor()` - spawn worker
  - [ ] `initWithShare()` - decrypt and initialize worker [req.qogtvx]
  - [ ] `requestCertificate()` - complete signing flow [req.3j5hnq] [req.wdalb2] [req.5xcc6i] [req.o3lf24] [req.jki5t0]
  - [ ] `isActive()` - check worker status [req.35jehk]
  - [ ] `getRemainingTime()` - time until auto-terminate [req.35jehk]
  - [ ] `terminate()` - manual termination [req.obmwbr]
- [ ] Create `web/src/contexts/FROSTContext.tsx`:
  - [ ] `FROSTProvider` component
  - [ ] `useFROST()` hook

**Phase 9 Testing:**
- [ ] Run `cd web && npm run build`
- [ ] Verify no TypeScript errors

---

## Phase 10: Frontend UI Components

- [ ] Create `web/src/components/WorkerStatusIndicator.tsx` [req.35jehk]:
  - [ ] Active/inactive state display
  - [ ] Countdown timer
  - [ ] Pulsing indicator when ready
- [ ] Create `web/src/components/CAPublicKeyDownload.tsx` [req.23hk63] [req.0lpwy4]:
  - [ ] Fetch CA public key from API
  - [ ] Display SHA256 fingerprint
  - [ ] Download button (OpenSSH format)
- [ ] Modify `web/src/components/HostForm.tsx` [req.w51l9k]:
  - [ ] Add SSH principal input field
  - [ ] Update form validation
  - [ ] Update API calls to include principal

**Phase 10 Testing:**
- [ ] Run `cd web && npm run build`
- [ ] Manual test: Verify host form shows principal field
- [ ] Manual test: Verify CA download component renders

---

## Phase 11: SSH Client Integration

- [ ] Modify `web/wasm/sshclient/client.go`:
  - [ ] Add `SetCertificateCallback()` function
  - [ ] Add certificate-based auth to `Connect()` Auth methods
  - [ ] Request certificate via callback before password fallback
- [ ] Rebuild WASM: `cd web/wasm/sshclient && ./build_wasm.sh`
- [ ] Modify `web/src/lib/ssh-client.ts` [req.4oofln]:
  - [ ] Check FROST worker status before connect
  - [ ] Trigger WebAuthn prompt if worker inactive
  - [ ] Initialize worker with master key
  - [ ] Request certificate for host
  - [ ] Pass certificate to WASM client
- [ ] Modify `web/src/components/SSHTerminal.tsx` [req.4oofln]:
  - [ ] Integrate with FROST context
  - [ ] Show WebAuthn prompt when needed
  - [ ] Display certificate request progress
- [ ] Modify `web/src/pages/RegisterPage.tsx`:
  - [ ] Fetch encrypted client share after registration
  - [ ] Re-encrypt with PRF-derived master key
  - [ ] Store for later retrieval

**Phase 11 Testing:**
- [ ] Run `cd web && npm run build`
- [ ] Run `cd web/wasm/sshclient && ./build_wasm.sh`
- [ ] Manual test: Connect to SSH host, verify certificate auth attempted

---

## Phase 12: Docker Container CA Support

- [ ] Create `integration_tests/ssh/ca_setup.sh` [req.17dfwk]:
  - [ ] Accept CA public key via environment variable
  - [ ] Configure `TrustedUserCAKeys` in sshd_config
  - [ ] Configure `AuthorizedPrincipalsFile`
  - [ ] Create principals file for testuser
- [ ] Modify `integration_tests/ssh/Dockerfile` [req.17dfwk]:
  - [ ] Copy ca_setup.sh into container
  - [ ] Make script executable
- [ ] Modify `integration_tests/ssh/entrypoint.sh` [req.17dfwk] [req.cu1f0k]:
  - [ ] Call CA setup script if CA_PUBLIC_KEY env var set
  - [ ] Create flag file with known content

**Phase 12 Testing:**
- [ ] Build container: `cd integration_tests/ssh && docker build -t devsesh-ssh-test .`
- [ ] Test CA auth manually:
  ```bash
  # Generate test CA keypair
  ssh-keygen -t ed25519 -f /tmp/ca_key -N ""
  # Run container with CA
  docker run -d -p 2222:22 -e CA_PUBLIC_KEY="$(cat /tmp/ca_key.pub)" devsesh-ssh-test
  # Sign a user key
  ssh-keygen -t ed25519 -f /tmp/user_key -N ""
  ssh-keygen -s /tmp/ca_key -I test -n testuser -V +1m /tmp/user_key.pub
  # Test connection
  ssh -i /tmp/user_key -o CertificateFile=/tmp/user_key-cert.pub -p 2222 testuser@localhost
  ```

---

## Phase 13: Integration Test

- [ ] Create `integration_tests/tests/ssh-ca-e2e.spec.ts` [req.jc1drs]:
  - [ ] Register new user with WebAuthn + PRF [req.ancud7]
  - [ ] Verify CA public key created
  - [ ] Verify encrypted client share stored
  - [ ] Start SSH container with CA trust [req.vz2fg3] [req.17dfwk]
  - [ ] Pass CA public key to container
  - [ ] Verify flag file exists [req.cu1f0k]
  - [ ] Create host with principal, no password [req.4whcli]
  - [ ] Connect via web interface [req.twjlw7]
  - [ ] WebAuthn PRF authentication
  - [ ] FROST worker initialization
  - [ ] Certificate signing
  - [ ] Execute `cat FLAG_FILE` [req.xbft6g]
  - [ ] Validate output matches expected content

**Phase 13 Testing:**
- [ ] Run integration test: `cd integration_tests && npx playwright test ssh-ca-e2e`

---

## Phase 14: Final Validation

- [ ] Run all Go tests: `go test ./... -v -race`
- [ ] Run all frontend tests: `cd web && npm test`
- [ ] Run all integration tests: `cd integration_tests && npx playwright test`
- [ ] Verify all requirement tags are covered:
  - [ ] [req.v8k2fs] Verification shares stored for FROST Configuration
  - [ ] [req.0xpudr] @noble/curves dependency
  - [ ] [req.jap7ew] @noble/hashes dependency
  - [ ] [req.c02qrs] multi-party-sig FROST implementation
  - [ ] [req.1mujak] SSH certificate generation
  - [ ] [req.qwdm15] Main thread isolation
  - [ ] [req.gvq1jj] Memory-only share storage
  - [ ] [req.xxu1i4] Worker postMessage API
  - [ ] [req.obmwbr] Memory zeroing on terminate
  - [ ] [req.2k5is9] 30-minute inactivity timeout
  - [ ] [req.o9pemq] JWT authentication
  - [ ] [req.hs8zrm] Host ownership validation
  - [ ] [req.qogtvx] WebAuthn PRF requirement
  - [ ] [req.ey98nq] Fresh nonces
  - [ ] [req.tie4zq] 60-second session timeout
  - [ ] [req.1i6osk] Single-use UUID sessions
  - [ ] [req.zp9nw1] Rate limiting
  - [ ] [req.u72wa2] Configurable certificate validity
  - [ ] [req.xj6amw] Audit logging
  - [ ] [req.umkdzs] ssh-ed25519-cert-v01 format
  - [ ] [req.zbf0si] Per-host principals
  - [ ] [req.2x3a51] permit-pty, permit-port-forwarding extensions
  - [ ] [req.56dvhi] Monotonic serial numbers
  - [ ] [req.23hk63] CA public key download
  - [ ] [req.0lpwy4] CA fingerprint display
  - [ ] [req.35jehk] Worker status indicator
  - [ ] [req.4oofln] WebAuthn prompt on inactive worker
  - [ ] [req.w51l9k] SSH principal field in host form
  - [ ] [req.5kl1v5] WebSocket signing protocol
  - [ ] [req.3j5hnq] Client-initiated certificate request
  - [ ] [req.wdalb2] Server TBS data creation
  - [ ] [req.5xcc6i] Round 1 commitment exchange
  - [ ] [req.o3lf24] Round 2 partial signatures
  - [ ] [req.dzym7r] Signature aggregation
  - [ ] [req.jki5t0] Certificate return to client
  - [ ] [req.3zw1de] Session abort on failure
  - [ ] [req.9e2ob6] Immediate retry support
  - [ ] [req.17dfwk] Docker CA acceptance
  - [ ] [req.cu1f0k] Flag file in container
  - [ ] [req.jc1drs] Integration test
  - [ ] [req.ancud7] User registration creates CA
  - [ ] [req.vz2fg3] Container accepts CA auth
  - [ ] [req.4whcli] Host without password
  - [ ] [req.twjlw7] Web interface connection
  - [ ] [req.xbft6g] Flag file verification
