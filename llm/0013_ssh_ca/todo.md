# SSH CA Implementation Todo

## Project Status

- 🟢 Phase 1: Database Schema & Go Dependencies - COMMITTED
- 🟢 Phase 2: FROST Key Generation & Certificate Building - COMMITTED
- 🟢 Phase 3: Session Management & Rate Limiting - COMMITTED
- 🟢 Phase 3.5: Add Verification Shares to KeyShares - COMMITTED
- 🟢 Phase 4a: FROST Signing Protocol (frost.go) - COMMITTED
- 🟢 Phase 4b: WebSocket Handler & Routes - COMMITTED
- 🟢 Phase 5: User Registration Integration - COMMITTED (✅ encryption support added)
- 🟡 Phase 6: Frontend TypeScript Dependencies & Types - IMPLEMENTED
- 🟡 Phase 7: FROST Crypto Library (Frontend) - IMPLEMENTED
- 🟡 Phase 8: FROST Web Worker - IMPLEMENTED
- 🟢 Phase 9: FROST Client Library - COMMITTED (✅ code review fixes applied)
- 🟡 Phase 10: Frontend UI Components - IMPLEMENTED
- 🟡 Phase 11: SSH Client Integration - IMPLEMENTED
- 🟢 Phase 12: Docker Container CA Support - COMMITTED
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

- [x] Create `internal/ctxutil/context.go`:
  - [x] Move `ContextKeyUserID`, `ContextKeyHostID`, `ContextKeySession` from `auth`
  - [x] Move `UserIDFromContext()`, `HostIDFromContext()` from `auth`
  - [x] Add `SessionFromContext()` helper
- [x] Update `internal/auth/`:
  - [x] Remove context key definitions (re-export from ctxutil for backward compatibility)
  - [x] Import `ctxutil` for context keys and helpers
- [x] Update `internal/sessions/handler.go`:
  - [x] Replace `auth` import with `ctxutil` for context utilities
- [x] Update `internal/ssh/ca/handler.go`:
  - [x] Replace `sessions` import with `ctxutil` for `UserIDFromContext`
- [x] Verify no import cycles: `go build ./...`

**Registration integration:**

- [x] Modify `internal/auth/webauthn.go` `FinishRegistration` [req.ancud7]:
  - [x] Call `ca.GenerateKeyShares()` after successful registration (import `internal/ssh/ca`)
  - [x] Store server share in `ssh_ca` table
  - [x] Store client share in `ssh_ca_client_shares` (raw initially, frontend encrypts and updates via PUT)
  - [x] Return client share in registration response
  - [x] **FIXED**: Added `PUT /api/v1/sshca/client-share` endpoint for frontend to save encrypted share [req.qogtvx]
- [x] Update `internal/hosts/handler.go`:
  - [x] Modify `CreateHost` to handle `ssh_principal` [req.w51l9k]
  - [x] Modify `UpdateHost` to handle `ssh_principal` [req.w51l9k]

**Phase 5 Testing:**
- [x] Run `go build ./...` to verify no import cycles
- [x] Run existing auth tests: `go test ./internal/auth/... -v`
- [x] Run existing sessions tests: `go test ./internal/sessions/... -v`
- [x] Run existing ssh/ca tests: `go test ./internal/ssh/ca/... -v`

---

## Phase 6: Frontend TypeScript Dependencies & Types

- [x] Add `@noble/curves` to web/package.json [req.0xpudr]
- [x] Add `@noble/hashes` to web/package.json [req.jap7ew]
- [x] Create `web/src/types/sshca.ts` with TypeScript interfaces [req.0xpudr]:
  - [x] `FROSTShare`
  - [x] `SigningSessionState`
  - [x] `WorkerMessage`
  - [x] `WorkerResponse`

**Phase 6 Testing:**
- [x] Run `cd web && npm install`
- [x] Run `cd web && npm run build` to verify types compile

---

## Phase 7: FROST Crypto Library (Frontend)

- [x] Create `web/src/lib/crypto/frost.ts` [req.0xpudr]:
  - [x] `generateNonces()` - fresh nonces for signing [req.ey98nq]
  - [x] `computeCommitment()` - compute commitment from nonces [req.5xcc6i]
  - [x] `computePartialSignature()` - compute partial sig [req.o3lf24]
  - [x] `deserializeShare()` - parse share from bytes
  - [x] `encodeCommitment()` / `decodeCommitment()` - encode/decode commitment for transmission
  - [x] `clientRound1()` / `clientRound2()` - high-level signing flow functions
  - [x] `buildCommitmentList()` - convert commitments to @noble/curves format
  - [x] `zeroMemory()` - securely clear sensitive data [req.obmwbr]
- [x] Create `web/src/lib/crypto/frost.test.ts`:
  - [x] Test nonce generation produces unique values
  - [x] Test commitment encoding/decoding
  - [x] Test signature share encoding/decoding
  - [x] Test full signing flow produces valid Ed25519 signature
  - [x] Test different messages produce different signatures

**Phase 7 Testing:**
- [x] Run `cd web && npm test -- frost`

---

## Phase 8: FROST Web Worker

- [x] Create `web/src/workers/frost-worker.ts` [req.qwdm15] [req.gvq1jj]:
  - [x] `onmessage` handler for: init, round1, round2, status, terminate [req.xxu1i4]
  - [x] Share storage in worker-local variable (not accessible from main thread) [req.qwdm15]
  - [x] `zeroMemory()` function to clear share [req.obmwbr]
  - [x] Inactivity timer (30 minutes default) [req.2k5is9]
  - [x] Auto-terminate on timeout [req.obmwbr]
- [x] Configure Vite to bundle worker separately
- [x] Create `web/src/workers/frost-worker.test.ts` with unit tests

**Phase 8 Testing:**
- [x] Run `cd web && npm run build` to verify worker bundles
- [x] Run `cd web && npm test -- frost-worker` to verify all tests pass (16 tests)

---

## Phase 9: FROST Client Library

- [x] Create `web/src/lib/frost-client.ts` [req.0xpudr]:
  - [x] `FROSTClient` class [req.qwdm15]
  - [x] `constructor()` - spawn worker
  - [x] `initWithShare()` - decrypt and initialize worker [req.qogtvx]
  - [x] `requestCertificate()` - complete signing flow [req.3j5hnq] [req.wdalb2] [req.5xcc6i] [req.o3lf24] [req.jki5t0]
  - [x] `isActive()` - check worker status [req.35jehk]
  - [x] `getRemainingTime()` - time until auto-terminate [req.35jehk]
  - [x] `terminate()` - manual termination [req.obmwbr]
- [x] Add `GET /api/v1/sshca/config` endpoint returning all FROST config
- [x] Add `getSSHCAConfig()` and `getSSHCASigningWebSocketURL()` to web/src/lib/api.ts
- [x] Create `web/src/contexts/FROSTContext.tsx`:
  - [x] `FROSTProvider` component
  - [x] `useFROST()` hook

**Phase 9 Code Review Fixes (required before completion):**
- [x] Fix duplicate `SSHCAConfig` interface in `web/src/types/api.ts`
- [x] Fix serial number always returning 0 in `requestCertificate()` return value
- [x] Add nil check for clientShare in `ConfigHandler` (handler.go)
- [x] Add `onclose` handler in WebSocket signing flow to prevent hanging promises
- [x] Update `FROSTContext.tsx` to accept master key and use `initWithShare()` for decryption [req.qogtvx]
- [x] Add `PUT /api/v1/sshca/client-share` endpoint to save encrypted share
- [x] Add `updateSSHCAClientShare()` API function

**Phase 9 Testing:**
- [x] Run `cd web && npm run build` - verified (build succeeds, 142 modules)
- [x] Verify no TypeScript errors - verified (tsc --noEmit passes)
- [x] Run frontend tests: `cd web && npm test` - verified (113 tests pass)
- [x] Run Go tests: `go test ./internal/...` - verified (all pass)

---

## Phase 10: Frontend UI Components

- [x] Create `web/src/components/WorkerStatusIndicator.tsx` [req.35jehk]:
  - [x] Active/inactive state display
  - [x] Countdown timer
  - [x] Pulsing indicator when ready
- [x] Create `web/src/components/CAPublicKeyDownload.tsx` [req.23hk63] [req.0lpwy4]:
  - [x] Fetch CA public key from API
  - [x] Display SHA256 fingerprint
  - [x] Download button (OpenSSH format)
- [x] Modify `web/src/components/HostForm.tsx` [req.w51l9k]:
  - [x] Add SSH principal input field
  - [x] Update form validation
  - [x] Update API calls to include principal
- [x] Add `ssh_principal` field to Host type in `web/src/types/api.ts`
- [x] Update API functions in `web/src/lib/api.ts` to include `ssh_principal`
- [x] Add `getSSHCAPublicKey()` API function
- [x] Update test files to include `ssh_principal` in mock Host objects

**Phase 10 Testing:**
- [x] Run `cd web && npm run build` - verified (142 modules built)
- [x] Run `cd web && npm test` - verified (113 tests pass)
- [ ] Manual test: Verify host form shows principal field
- [ ] Manual test: Verify CA download component renders

---

## Phase 11: SSH Client Integration

- [x] Modify `web/wasm/sshclient/client.go`:
  - [x] Add `SetCertificateCallback()` function
  - [x] Add `ResolveCertificate()` and `RejectCertificate()` functions
  - [x] Add `parseCertificateAndKey()` to parse certificate and private key
  - [x] Add certificate-based auth to `Connect()` Auth methods (using `ssh.NewCertSigner`)
  - [x] Request certificate via callback before password fallback
- [x] Rebuild WASM: `./build_wasm.sh`
- [x] Modify `web/src/lib/ssh-client.ts` [req.4oofln]:
  - [x] Add certificate callback support to global declarations
  - [x] Add `certificate-request` event emission
  - [x] Add `resolveCertificate()` and `rejectCertificate()` methods
- [x] Modify `web/src/lib/frost-client.ts`:
  - [x] Generate ephemeral Ed25519 keypair for each certificate request
  - [x] Send user public key with certificate request
  - [x] Return both certificate and ephemeral private key in `CertificateResult`
- [x] Update `web/src/types/sshca.ts`:
  - [x] Add `userPrivateKey` and `userPublicKey` to `CertificateResult`
- [x] Modify backend `internal/ssh/ca/ca.go`:
  - [x] Update `CreateTBSCertificate()` to accept user public key parameter
- [x] Modify backend `internal/ssh/ca/handler.go`:
  - [x] Add `user_public_key` field to `wsMessage` struct
  - [x] Validate and use user public key in `handleRequestCert()`
- [x] Update Go tests for new `CreateTBSCertificate()` signature
- [x] Create `web/src/components/WebAuthnDialog.tsx`:
  - [x] Dialog for prompting WebAuthn authentication
  - [x] Uses AlertDialog UI component
- [x] Modify `web/src/components/SSHTerminal.tsx` [req.4oofln]:
  - [x] Integrate with FROST context via `useFROST()`
  - [x] Handle `certificate-request` event from SSH client
  - [x] Show WebAuthn dialog when FROST worker is inactive
  - [x] Perform WebAuthn PRF authentication to unlock worker
  - [x] Request certificate and pass to SSH client with private key
  - [x] Fall back to password auth if certificate auth fails
- [x] Modify `web/src/pages/RegisterPage.tsx`:
  - [x] Capture client share from registration response
  - [x] Encrypt with master key and store in localStorage as pending
- [x] Modify `web/src/pages/LoginPage.tsx`:
  - [x] Check for pending client share after login
  - [x] Upload encrypted client share to server
- [x] Update `web/src/lib/api.ts`:
  - [x] Update `registerFinish()` to return `RegisterFinishResponse` with client share
- [x] Update `web/src/contexts/FROSTContext.tsx`:
  - [x] Import and use `CertificateResult` type
- [x] Update test file `web/src/components/SSHTerminal.test.tsx`:
  - [x] Mock FROST context
  - [x] Add mock certificate methods to SSHClient

**Phase 11 Testing:**
- [x] Run `cd web && npm run build` - verified (build succeeds)
- [x] Run `./build_wasm.sh` - verified (WASM built successfully)
- [x] Run `cd web && npm test` - verified (113 tests pass)
- [x] Run `go test ./internal/ssh/ca/...` - verified (all tests pass)
- [ ] Manual test: Connect to SSH host, verify certificate auth attempted

---

## Phase 12: Docker Container CA Support

- [x] Create `integration_tests/ssh/ca_setup.sh` [req.17dfwk]:
  - [x] Accept CA public key via environment variable
  - [x] Configure `TrustedUserCAKeys` in sshd_config
  - [x] Configure `AuthorizedPrincipalsFile`
  - [x] Create principals file for testuser
- [x] Modify `integration_tests/ssh/Dockerfile` [req.17dfwk]:
  - [x] Copy ca_setup.sh into container
  - [x] Make script executable
- [x] Modify `integration_tests/ssh/entrypoint.sh` [req.17dfwk] [req.cu1f0k]:
  - [x] Call CA setup script if CA_PUBLIC_KEY env var set
  - [x] Create flag file with known content

**Phase 12 Testing:**
- [x] Build container: `cd integration_tests/ssh && docker build -t devsesh-ssh-test .`
- [x] Test CA auth manually:
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
