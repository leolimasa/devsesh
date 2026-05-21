# SSH CA Implementation - Code Review

## Summary

This PR implements FROST-based threshold signature SSH certificates for devsesh, enabling passwordless SSH authentication using 2-of-2 Ed25519 threshold signatures. The implementation spans backend (Go), frontend (TypeScript/React), WASM SSH client, and integration tests.

## Requirements Coverage

| Requirement                                     | Status | Implementation                                 |
|-------------------------------------------------|--------|------------------------------------------------|
| [req.0xpudr] @noble/curves dependency           | ✅     | Added to web/package.json, used in frost.ts    |
| [req.jap7ew] @noble/hashes dependency           | ✅     | Added to web/package.json                      |
| [req.c02qrs] FROST Ed25519 (Go)                 | ✅     | bytemare/frost in internal/ssh/ca/             |
| [req.1mujak] SSH certificate generation         | ✅     | golang.org/x/crypto/ssh in ca.go               |
| [req.qwdm15] Main thread isolation              | ✅     | Worker holds share, main thread never accesses |
| [req.gvq1jj] Memory-only share storage          | ✅     | Worker-local variable, no IndexedDB            |
| [req.xxu1i4] Worker postMessage API             | ✅     | init, round1, round2, status, terminate        |
| [req.obmwbr] Memory zeroing on terminate        | ✅     | zeroMemory() in frost.ts and frost-worker.ts   |
| [req.2k5is9] 30-minute inactivity timeout       | ✅     | Configurable timeout in worker                 |
| [req.o9pemq] JWT authentication                 | ✅     | RequireJWT middleware on all SSHCA routes      |
| [req.hs8zrm] Host ownership validation          | ✅     | handleRequestCert validates host.UserID        |
| [req.qogtvx] WebAuthn PRF requirement           | ✅     | SSHTerminal.tsx triggers WebAuthn dialog       |
| [req.ey98nq] Fresh nonces                       | ✅     | generateNonces() creates new nonces each call  |
| [req.tie4zq] 60-second session timeout          | ✅     | SessionManager with expiry                     |
| [req.1i6osk] Single-use UUID sessions           | ✅     | UUID generation, deleted after use             |
| [req.zp9nw1] Rate limiting                      | ✅     | RateLimiter (10/min default)                   |
| [req.u72wa2] Configurable cert validity         | ✅     | SSHCAConfig.CertValiditySecs                   |
| [req.xj6amw] Audit logging                      | ✅     | LogCertIssuance in cert_audit_log              |
| [req.umkdzs] ssh-ed25519-cert-v01 format        | ✅     | CreateTBSCertificate output                    |
| [req.zbf0si] Per-host principals                | ✅     | ssh_principal column in hosts                  |
| [req.2x3a51] permit-pty, permit-port-forwarding | ✅     | Extensions set in CreateTBSCertificate         |
| [req.56dvhi] Monotonic serial numbers           | ✅     | IncrementCertSerial atomic operation           |
| [req.23hk63] CA public key download             | ✅     | PublicKeyHandler, CAPublicKeyDownload.tsx      |
| [req.0lpwy4] CA fingerprint display             | ✅     | computeFingerprint in CAPublicKeyDownload.tsx  |
| [req.35jehk] Worker status indicator            | ✅     | WorkerStatusIndicator.tsx                      |
| [req.4oofln] WebAuthn prompt on inactive worker | ✅     | WebAuthnDialog.tsx in SSHTerminal              |
| [req.w51l9k] SSH principal field in host form   | ✅     | HostForm.tsx updated                           |
| [req.5kl1v5] WebSocket signing protocol         | ✅     | SigningWebSocketHandler                        |
| [req.3j5hnq] Client-initiated cert request      | ✅     | "request_cert" message type                    |
| [req.wdalb2] Server TBS data creation           | ✅     | handleRequestCert builds TBS                   |
| [req.5xcc6i] Round 1 commitment exchange        | ✅     | handleRound1, clientRound1                     |
| [req.o3lf24] Round 2 partial signatures         | ✅     | handleRound2, clientRound2                     |
| [req.dzym7r] Signature aggregation              | ✅     | AggregateSignatures in frost.go                |
| [req.jki5t0] Certificate return to client       | ✅     | "certificate" response type                    |
| [req.3zw1de] Session abort on failure           | ✅     | cleanup() and DeleteSession                    |
| [req.9e2ob6] Immediate retry support            | ✅     | New session on each request                    |
| [req.v8k2fs] Verification shares storage        | ✅     | server_verifying_share, client_verifying_share |
| [req.17dfwk] Docker CA acceptance               | ✅     | ca_setup.sh, entrypoint.sh updated             |
| [req.cu1f0k] Flag file in container             | ✅     | FLAG_FILE created in entrypoint                |
| [req.jc1drs] Integration test                   | ✅     | ssh-ca-e2e.spec.ts                             |
| [req.ancud7] User registration creates CA       | ✅     | GenerateKeyShares in FinishRegistration        |
| [req.vz2fg3] Container accepts CA auth          | ✅     | TrustedUserCAKeys configured                   |
| [req.4whcli] Host without password              | ✅     | Test creates host with no password             |
| [req.twjlw7] Web interface connection           | ✅     | SSHTerminal with certificate auth              |
| [req.xbft6g] Flag file verification             | ✅     | cat FLAG_FILE in integration test              |

## Implementation Progress

| Phase                                                | Status         | Notes                                                |
|------------------------------------------------------|----------------|------------------------------------------------------|
| Phase 1: Database Schema & Go Dependencies           | ✅ Committed   | Migrations, db functions                             |
| Phase 2: FROST Key Generation & Certificate Building | ✅ Committed   | ca.go, ca_test.go                                    |
| Phase 3: Session Management & Rate Limiting          | ✅ Committed   | Actor-based SessionManager                           |
| Phase 3.5: Verification Shares                       | ✅ Committed   | KeyShares includes verifying shares                  |
| Phase 4a: FROST Signing Protocol                     | ✅ Committed   | frost.go with full signing flow                      |
| Phase 4b: WebSocket Handler & Routes                 | ✅ Committed   | handler.go with signing WebSocket                    |
| Phase 5: User Registration Integration               | ✅ Committed   | webauthn.go generates CA on register                 |
| Phase 6: Frontend TypeScript Dependencies & Types    | ✅ Implemented | @noble/curves, sshca.ts types                        |
| Phase 7: FROST Crypto Library (Frontend)             | ✅ Implemented | frost.ts with full client signing                    |
| Phase 8: FROST Web Worker                            | ✅ Implemented | frost-worker.ts with timeout                         |
| Phase 9: FROST Client Library                        | ✅ Committed   | frost-client.ts, FROSTContext.tsx                    |
| Phase 10: Frontend UI Components                     | ✅ Implemented | WorkerStatusIndicator, CAPublicKeyDownload, HostForm |
| Phase 11: SSH Client Integration                     | ✅ Implemented | SSHTerminal with cert auth, WebAuthnDialog           |
| Phase 12: Docker Container CA Support                | ✅ Committed   | ca_setup.sh, entrypoint.sh                           |
| Phase 13: Integration Test                           | ✅ Implemented | ssh-ca-e2e.spec.ts (5 tests pass)                    |
| Phase 14: Final Validation                           | ⏳ Not Started | All tests need to be run together                    |

## Todo Status

Based on the diff, the todo.md file shows:
- ✅ Phases 1-5, 9, 12-13 marked as committed
- ✅ Phases 6-8, 10-11 marked as implemented
- ⏳ Phase 14 (Final Validation) not started

## Unit Test Coverage

| Requirement                      | Unit Test                                                | File                |
|----------------------------------|----------------------------------------------------------|---------------------|
| [req.c02qrs] FROST keygen        | ✅ TestGenerateKeyShares                                 | ca_test.go          |
| [req.v8k2fs] Verification shares | ✅ TestGenerateKeyShares                                 | ca_test.go          |
| [req.umkdzs] Certificate format  | ✅ TestCreateTBSCertificate                              | ca_test.go          |
| [req.2x3a51] Extensions          | ✅ TestCreateTBSCertificate_PermitPtyAndPortForwarding   | ca_test.go          |
| [req.56dvhi] Serial numbers      | ✅ TestCreateTBSCertificate (serial=42)                  | ca_test.go          |
| [req.5xcc6i] Round 1             | ✅ TestServerRound1_ProducesValidCommitment              | frost_test.go       |
| [req.o3lf24] Round 2             | ✅ TestServerRound2_ProducesValidPartialSignature        | frost_test.go       |
| [req.dzym7r] Aggregation         | ✅ TestAggregateSignatures_ProducesValidEd25519Signature | frost_test.go       |
| [req.ey98nq] Fresh nonces        | ✅ TestNonceUniqueness                                   | frost_test.go       |
| [req.1i6osk] Session creation    | ✅ TestSessionManager_CreateSession                      | session_test.go     |
| [req.tie4zq] Session expiry      | ✅ TestHandler_SessionExpiry                             | handler_test.go     |
| [req.zp9nw1] Rate limiting       | ✅ TestRateLimiterWithHandler                            | handler_test.go     |
| [req.hs8zrm] Host ownership      | ✅ TestHandler_HostOwnershipValidation_RejectsNonOwner   | handler_test.go     |
| [req.xj6amw] Audit logging       | ✅ TestHandler_AuditLogging                              | handler_test.go     |
| [req.9e2ob6] Retry support       | ✅ TestHandler_RetryAfterSessionFailure                  | handler_test.go     |
| [req.3zw1de] Session cleanup     | ✅ TestHandler_SessionCleanupOnDelete                    | handler_test.go     |
| [req.23hk63] Public key handler  | ✅ TestHandler_PublicKeyHandler_Success                  | handler_test.go     |
| [req.0xpudr] @noble/curves       | ✅ frost.test.ts                                         | web/src/lib/crypto/ |
| [req.xxu1i4] Worker API          | ✅ frost-worker.test.ts                                  | web/src/workers/    |

### Requirements Missing Unit Tests

1. **[req.qwdm15]** Main thread isolation - No explicit test verifying main thread cannot access share
2. **[req.gvq1jj]** Memory-only storage - No test verifying share isn't persisted to IndexedDB
3. **[req.2k5is9]** 30-minute timeout - Worker tests use shorter timeout, need full timeout test
4. **[req.o9pemq]** JWT authentication - No handler-level test for JWT requirement
5. **[req.u72wa2]** Configurable validity - No test for max 5-minute limit enforcement
6. **[req.0lpwy4]** CA fingerprint - No test for computeFingerprint() function
7. **[req.35jehk]** Worker status indicator - No component tests for WorkerStatusIndicator

## Unit Test Quality Issues

### 1. handler_test.go - Missing Error Cases
**Issue:** Many handler tests verify happy paths but lack error case coverage.
**Suggestion:** Add tests for:
- Invalid base64 in user_public_key
- Malformed WebSocket messages
- Database errors during certificate issuance

### 2. frost_test.go - Hardcoded Test Values
**Issue:** Some tests use hardcoded byte arrays that may not reflect real-world data.
**Suggestion:** Generate test data dynamically or use well-documented test vectors.

### 3. ca_test.go - Simplified Test Assertions
**Issue:** Tests were simplified in the diff, removing some detailed assertions.
**Suggestion:** Restore assertions for:
- `cert.Key.Type() == "ssh-ed25519"`
- `cert.SignatureKey.Type() == "ssh-ed25519"`
- Verify signature key matches CA public key

### 4. frost-worker.test.ts - Mock Worker Environment
**Issue:** Tests run in Node.js, not a real worker environment.
**Suggestion:** Consider using a worker polyfill or running subset of tests in browser environment.

### 5. SSHTerminal.test.tsx - Incomplete Mock
**Issue:** FROST context mock returns `vi.fn().mockRejectedValue` which may cause false positives.
**Suggestion:** Add tests that exercise the actual certificate request flow with proper mocking.

## Integration Test Coverage

| Requirement                           | Integration Test                                                   | File               |
|---------------------------------------|--------------------------------------------------------------------|--------------------|
| [req.jc1drs] E2E certificate auth     | ✅ complete certificate-based SSH connection workflow              | ssh-ca-e2e.spec.ts |
| [req.ancud7] Registration creates CA  | ✅ user registration creates SSH CA key shares                     | ssh-ca-e2e.spec.ts |
| [req.23hk63] CA public key endpoint   | ✅ CA public key endpoint returns valid OpenSSH key                | ssh-ca-e2e.spec.ts |
| [req.vz2fg3] Container CA trust       | ✅ SSH container configured with CA trust accepts certificate auth | ssh-ca-e2e.spec.ts |
| [req.17dfwk] Docker CA setup          | ✅ SSH container has testsession tmux session                      | ssh-ca-e2e.spec.ts |
| [req.4whcli] Host without password    | ✅ via setupSSHCATestEnvironment (no ssh_password)                 | ssh-ca-e2e.spec.ts |
| [req.twjlw7] Web interface connection | ✅ connectWithCertificateOnly                                      | ssh-ca-e2e.spec.ts |
| [req.xbft6g] Flag file verification   | ✅ verifyFlagFileInTerminal                                        | ssh-ca-e2e.spec.ts |
| [req.4oofln] WebAuthn prompt          | ✅ tested in connectWithCertificateOnly                            | ssh-ca-e2e.spec.ts |
| [req.qogtvx] PRF requirement          | ✅ setupPRFAuthenticator, registerUserWithPRF                      | prf-auth.ts        |

### Requirements Missing Integration Tests

1. **[req.zp9nw1]** Rate limiting - No test that issues 10+ certificates in a minute
2. **[req.tie4zq]** 60-second session timeout - No test that waits for session expiry
3. **[req.3zw1de]** Session abort on failure - No test for mid-protocol failure recovery
4. **[req.obmwbr]** Memory zeroing - Cannot verify memory zeroing in integration test
5. **[req.xj6amw]** Audit logging - No test verifying cert_audit_log entries
6. **[req.0lpwy4]** CA fingerprint display - No visual test for fingerprint rendering

## Integration Test Quality Issues

### 1. prf-auth.ts - LocalStorage PRF Caching
**Issue:** The PRF consistency script uses localStorage to cache PRF outputs between page navigations. This is a workaround for Chromium's virtual authenticator producing inconsistent PRF outputs.
```typescript
const PRF_CACHE_KEY = '__prf_output_cache__'
localStorage.setItem(PRF_CACHE_KEY, JSON.stringify(cache))
```
**Suggestion:** Document this limitation clearly. Consider clearing the cache between test runs to avoid cross-test contamination.

### 2. ssh-ca-e2e.spec.ts - Long Timeouts
**Issue:** Many operations use long timeouts (20-60 seconds) which can mask performance regressions.
**Suggestion:** Add performance assertions or use shorter timeouts with retry logic.

### 3. ssh-container.ts - Shell Command Execution
**Issue:** Uses `execSync` which can hang if Docker commands fail silently.
```typescript
execSync(`docker exec ${containerName} pgrep sshd`)
```
**Suggestion:** Add timeout to all execSync calls and better error handling.

### 4. Test Isolation
**Issue:** ssh-ca-e2e.spec.ts and ssh-e2e.spec.ts both use Docker containers. If run in parallel, they may conflict.
**Suggestion:** Use unique container names per test file (already done) and ensure port allocations don't conflict.

## Code Organization Issues

### 1. Large Files - ✅ FIXED
- ~~`internal/ssh/ca/handler.go` (744 lines)~~ → Split into:
  - `handler.go` (~50 lines): Handler struct and constructor
  - `http_handlers.go` (~160 lines): HTTP handlers
  - `websocket.go` (~200 lines): WebSocket connection management
  - `signing.go` (~360 lines): FROST signing protocol
- ~~`web/src/lib/crypto/frost.ts` (622 lines)~~ → Split into:
  - `frost-encoding.ts` (~230 lines): Wire format encoding/decoding
  - `frost.ts` (~280 lines): Core FROST signing logic
- `web/src/lib/frost-client.ts` (471 lines) - Consider extracting WebSocket communication
- `web/src/components/SSHTerminal.tsx` - Component grew significantly with certificate auth logic

### 2. Duplicate Functionality
- `encodeBase64`/`decodeBase64` in encoding.ts reimplements btoa/atob with Uint8Array support. Consider using a library or consolidating.
- ROADMAP.md notes: "encoding.ts is reimplementing base64 encoding?"

### 3. Utility Functions That Should Be Shared - ✅ FIXED
- ~~`zeroMemory()` duplicated~~ → Extracted to `web/src/lib/crypto/memory.ts`
- ~~`computeFingerprint()` in CAPublicKeyDownload.tsx~~ → Moved to `web/src/lib/crypto/ssh.ts`

### 4. Folder Structure Deviation
- `internal/ctxutil/` is a new package created to break import cycles. This is the correct approach but should be documented.

### 5. Binary Files Committed - ✅ FIXED
- ~~`web/devsesh` binary file~~ → Removed from git, added to .gitignore
- `web/public/sshclient.wasm` changed (expected)

## Code Review

### Potential Bugs or Issues

#### 1. SSHTerminal.tsx - State Race Condition (HIGH)
**Issue:** After calling `initWorker()`, the code immediately calls `requestCert()` but `isActive` state may not be updated yet due to React's async state updates.
```typescript
await initWorker(masterKey)
// isActive is still false here due to async state update
const result = await requestCert(host.id)
```
**Current Workaround:** The code requests the certificate directly after `initWorker` instead of checking `isActive`.
**Suggestion:** This workaround is correct. Add a comment explaining why the direct call is necessary.

#### 2. handler.go - TBS Data Calculation (MEDIUM)
**Issue:** The TBS data calculation subtracts 4 bytes for the signature length field:
```go
certBytes := cert.Marshal()
tbsData := certBytes[:len(certBytes)-4]
```
This relies on the internal structure of `ssh.Certificate.Marshal()`. If the SSH library changes, this could break.
**Suggestion:** Add a test that verifies the TBS data format matches what the SSH library expects, or use `cert.bytesForSigning()` if accessible.

#### 3. frost.ts - Hardcoded Scalar Offset (MEDIUM)
**Issue:** The secret scalar offset is hardcoded:
```typescript
const expectedScalarOffset = 103
const signingShare = clientShare.slice(expectedScalarOffset, expectedScalarOffset + SCALAR_SIZE)
```
This assumes a specific bytemare/frost encoding that could change.
**Suggestion:** Add validation that the extracted scalar is non-zero and within the Ed25519 scalar range.

#### 4. WebAuthnDialog.tsx - Auth Progress Tracking (LOW)
**Issue:** Uses a ref to track auth progress to prevent onCancel from being called during authentication:
```typescript
const authInProgressRef = useRef(false)
```
This is a reasonable pattern but could be cleaner with a state machine.
**Suggestion:** Consider using a state machine library or simplifying the dialog lifecycle.

### Security Concerns

#### 1. Client Share Stored Before Encryption - ✅ FIXED
~~**Issue:** In `webauthn.go`, the client share was stored unencrypted before frontend encryption.~~

**Fix Applied:**
- Removed `db.SaveClientShare()` call from `RegisterFinishHandler` - unencrypted share is never stored
- Changed `UpdateClientShare()` to use UPSERT (`INSERT OR REPLACE`) to create/update records
- Flow now: Server returns plaintext share → Frontend encrypts → Frontend calls PUT → Server stores encrypted only

#### 2. PRF Output Caching in LocalStorage (MEDIUM)
**Issue:** Integration tests cache PRF outputs in localStorage:
```typescript
localStorage.setItem(PRF_CACHE_KEY, JSON.stringify(cache))
```
This is test-only code, but if accidentally included in production, it would weaken security.
**Suggestion:** Ensure this code is not bundled into production builds. Add a check or use a test-only module.

#### 3. Debug Logging of Key Material (LOW)
**Issue:** Several places log key material for debugging:
```go
slog.Info("SSH CA key shares generated",
    "publicKey_hex", fmt.Sprintf("%x", keyShares.PublicKey),
```
While public keys are not secret, this pattern could accidentally be extended to log secrets.
**Suggestion:** Use structured logging with explicit key material markers so they can be filtered in production.

#### 4. Zero Salt in AES (Noted in ROADMAP.md) - ✅ FIXED
~~**Issue:** ROADMAP.md notes: "aes.ts has 0 byte salt?"~~

**Fix Applied:**
- Added `ENROLLMENT_HKDF_SALT = 'devsesh-enrollment-v1'` constant
- Updated `deriveKey()` to use proper salt instead of empty `Uint8Array(0)`
- Now consistent with `prf.ts` which already uses proper salt for master key derivation

### Performance Implications

#### 1. WebSocket Per Certificate Request
**Issue:** Each certificate request opens a new WebSocket connection.
**Suggestion:** For high-frequency usage, consider keeping the WebSocket open and multiplexing requests.

#### 2. Worker Polling Every Second
**Issue:** `FROSTContext.tsx` polls worker status every second:
```typescript
intervalRef.current = setInterval(() => {
    setIsActive(clientRef.current.isActive())
    setRemainingTime(clientRef.current.getRemainingTime())
}, 1000)
```
**Suggestion:** This is acceptable for now but could use requestAnimationFrame or only poll when the indicator is visible.

#### 3. Multiple API Calls on SSH Connect
**Issue:** When connecting, SSHTerminal.tsx makes multiple API calls:
1. getMasterKey()
2. loginBegin()
3. getSSHCAConfig()
4. WebSocket connection
**Suggestion:** Consider batching some of these calls or pre-fetching config.

### Code Style Consistency

#### 1. Error Message Casing
**Issue:** Some error messages use lowercase, some use sentence case:
```go
client.sendError("host_id is required")  // lowercase
client.sendError("SSH CA not configured")  // Title Case
```
**Suggestion:** Standardize on lowercase error messages for consistency.

#### 2. Logging Levels
**Issue:** Mix of slog.Info, slog.Debug, slog.Error without clear guidelines:
```go
slog.Info("FROST signature verified successfully", ...)
slog.Debug("round 1 completed", ...)
```
**Suggestion:** Use Debug for protocol details, Info for significant events, Error for failures.

#### 3. TypeScript Any Usage
**Issue:** Several places use `any` type:
```typescript
const result = ed25519_FROST.commit(secret) as any
```
**Suggestion:** Define proper types for the @noble/curves FROST API responses.

### Missing Edge Cases or Error Handling

#### 1. WebSocket Reconnection
**Issue:** If the WebSocket closes mid-signing, the promise may hang.
**Current Fix:** The diff shows `onclose` handler was added.
**Suggestion:** Verify the handler properly rejects pending promises.

#### 2. Worker Termination During Signing
**Issue:** If the worker terminates (due to timeout) while a signing operation is in progress, the request will fail.
**Suggestion:** Add explicit handling in frost-client.ts to detect worker termination and provide a clear error.

#### 3. Database Transaction for Registration - ✅ FIXED
~~**Issue:** Registration creates multiple database records without a transaction.~~

**Fix Applied:**
- Created `db.RegisterUserWithSSHCA()` for new user registration (user + credential + SSH CA in one transaction)
- Created `db.AddCredentialToExistingUser()` for existing user credential addition
- Both functions use `tx.Begin()` / `tx.Commit()` with rollback on error

### Suggestions for Improvement

#### 1. Add Health Check for FROST Worker
Create a lightweight "ping" message to verify the worker is responsive without performing cryptographic operations.

#### 2. ~~Certificate Caching~~ (Not needed)
~~For hosts where multiple connections are made quickly, consider caching valid certificates.~~
**Reconsidered:** The worker already holds the decrypted share for 30 minutes, so generating new certificates is fast (just a WebSocket round-trip). Fresh certificates per connection is better for security (unique serials, audit trail).

#### 3. Better Error Messages for Users
Current errors like "failed to compute server partial signature" are technical. Add user-friendly alternatives.

#### 4. Metrics/Telemetry
Add instrumentation for:
- Certificate issuance latency
- Worker initialization time
- Authentication method used (certificate vs password)

## Code Review TODO

### HIGH Priority
- [x] ~~HIGH: Fix potential race condition where client share is stored unencrypted before frontend encrypts it (webauthn.go)~~ ✅ FIXED
- [x] ~~HIGH: Audit aes.ts for zero-byte salt issue noted in ROADMAP.md~~ ✅ FIXED
- [x] ~~HIGH: Add database transaction for registration flow (user + ssh_ca)~~ ✅ FIXED
- [x] ~~HIGH: Remove `web/devsesh` binary from git (add to .gitignore)~~ ✅ FIXED

### MEDIUM Priority
- [ ] MEDIUM: Add validation for extracted scalar in frost.ts (non-zero, within range)
- [ ] MEDIUM: Add integration test for rate limiting (10+ certs in 1 minute)
- [ ] MEDIUM: Add integration test verifying cert_audit_log entries
- [ ] MEDIUM: Document TBS data calculation in handler.go with reference to SSH spec
- [x] ~~MEDIUM: Split handler.go into smaller files (http handlers, websocket, signing)~~ ✅ FIXED
- [ ] MEDIUM: Add proper TypeScript types for @noble/curves FROST API (remove `as any`)
- [x] ~~MEDIUM: Extract zeroMemory() to shared utility (currently duplicated)~~ ✅ FIXED

### LOW Priority
- [ ] LOW: Standardize error message casing (lowercase recommended)
- [ ] LOW: Add comment explaining direct requestCert call after initWorker in SSHTerminal.tsx
- [ ] LOW: Add component tests for WorkerStatusIndicator
- [ ] LOW: Add unit test for computeFingerprint() function
- [ ] LOW: Consider state machine for WebAuthnDialog lifecycle

### FUTURE
- [x] ~~FUTURE: Implement certificate caching~~ - Not needed; worker already holds decrypted share
- [ ] FUTURE: Add metrics/telemetry for certificate issuance
- [ ] FUTURE: Consider WebSocket connection pooling
- [ ] FUTURE: Add user-friendly error messages with technical details in logs
- [ ] FUTURE: Run Phase 14 final validation with all tests
