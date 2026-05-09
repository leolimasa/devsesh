# Code Review: Phase 4b - WebSocket Handler & Routes

## Summary

This change implements the WebSocket handler for FROST certificate signing and registers three new routes (`/api/v1/sshca/public-key`, `/api/v1/sshca/client-share`, `/api/v1/sshca/sign`) in the server.

## Requirements Coverage

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| [req.5kl1v5] WebSocket signing protocol | Implemented | `SigningWebSocketHandler()` in `handler.go:137-160` uses WebSocket for real-time FROST protocol |
| [req.o9pemq] JWT authentication | Implemented | JWT middleware applied to all three routes in `server.go:101-103` |
| [req.hs8zrm] Host ownership validation | Implemented | `handleRequestCert()` validates `host.UserID != client.userID` at `handler.go:229` |
| [req.wdalb2] Server builds TBS data | Implemented | `handleRequestCert()` calls `CreateTBSCertificate()` at `handler.go:270` |
| [req.5xcc6i] Round 1 commitment exchange | Implemented | `handleRound1()` at `handler.go:303-366` generates server commitment via `ServerRound1()` |
| [req.o3lf24] Round 2 partial signatures | Implemented | `handleRound2()` at `handler.go:368-421` computes server partial signature via `ServerRound2()` |
| [req.jki5t0] Server returns certificate | Implemented | `handleRound2()` aggregates signatures and returns final certificate at `handler.go:467-481` |
| [req.tie4zq] 60-second session timeout | Implemented | `SessionManager` uses 60-second default expiry; `readPump` sets 60-second read deadline |
| [req.3zw1de] Session abort on failure | Implemented | `cleanup()` deletes session and zeros FROST state at `handler.go:473-483` |
| [req.9e2ob6] Immediate retry support | Implemented | Client can send new `request_cert` message anytime |
| [req.23hk63] CA public key download | Implemented | `PublicKeyHandler()` at `handler.go:81-105` |
| [req.zp9nw1] Rate limiting | Implemented | Rate limiter checked at `handler.go:217-221` |
| [req.xj6amw] Audit logging | Implemented | `logCertIssuance()` called on success and failure throughout handler |

## Implementation Progress

### Phase 4b: WebSocket Handler & Routes

| Item | Status |
|------|--------|
| `internal/ssh/ca/handler.go` WebSocket handler | Done |
| JWT authentication on connection | Done |
| Host ownership validation | Done |
| Handle `request_cert` message | Done |
| Handle `round1` message | Done |
| Handle `round2` message | Done |
| Send final certificate | Done |
| Session timeout handling | Done |
| Error cleanup | Done |
| Retry support | Done |
| `GET /api/v1/sshca/public-key` route | Done |
| `GET /api/v1/sshca/client-share` route | Done |
| `WS /api/v1/sshca/sign` route | Done |

## Todo Status

| Phase | Status |
|-------|--------|
| Phase 1: Database Schema & Go Dependencies | Committed |
| Phase 2: FROST Key Generation & Certificate Building | Committed |
| Phase 3: Session Management & Rate Limiting | Implemented |
| Phase 3.5: Add Verification Shares to KeyShares | Implemented |
| Phase 4a: FROST Signing Protocol (frost.go) | Implemented |
| Phase 4b: WebSocket Handler & Routes | Implemented (this change) |
| Phase 5: User Registration Integration | Not Started |
| Phase 6-14 | Not Started |

## Unit Test Coverage

| Requirement                                     | Unit Test                                                                                                    | Location                                      |
|-------------------------------------------------|--------------------------------------------------------------------------------------------------------------|-----------------------------------------------|
| [req.5kl1v5] WebSocket signing                  | TestWSMessageTypes, TestWSResponseTypes                                                                      | `handler_test.go:99-156`                      |
| [req.o9pemq] JWT authentication                 | TestHandler_PublicKeyHandler_Unauthorized, TestHandler_ClientShareHandler_Unauthorized                       | `handler_test.go:187-275`                     |
| [req.tie4zq] Session timeout                    | TestHandler_SessionExpiry, TestHandler_SessionExpiryAndCleanup                                               | `handler_test.go:453-584`                     |
| [req.zp9nw1] Rate limiting                      | TestRateLimiterWithHandler, TestRateLimiterDifferentUsers, TestHandler_RateLimitExceeds                      | `handler_test.go:344-522`                     |
| [req.3zw1de] Session cleanup                    | TestHandler_SessionCleanupOnDelete, TestHandler_SessionDataZeroing                                           | `handler_test.go:524-603`                     |
| [req.9e2ob6] Retry support                      | TestHandler_RetryAfterSessionFailure                                                                         | `handler_test.go:603-666`                     |
| [req.xj6amw] Audit logging                      | TestHandler_AuditLogging                                                                                     | `handler_test.go:474-503`                     |
| [req.hs8zrm] Host ownership                     | TestHandler_HostOwnershipValidation, TestHandler_HostOwnershipValidation_RejectsNonOwner                     | `handler_test.go:410-511`                     |
| [req.23hk63] CA public key download             | TestHandler_PublicKeyHandler_Success, TestHandler_PublicKeyHandler_NotFoundWhenNoCA                          | `handler_test.go:200-262`                     |
| [req.c02qrs] FROST key generation               | TestGenerateKeyShares, TestGenerateKeyShares_UniquePublicKeys                                                | `ca_test.go:10-59`                            |
| [req.v8k2fs] Verification shares                | TestGenerateKeyShares                                                                                        | `ca_test.go:10-43`                            |
| [req.umkdzs] ssh-ed25519-cert-v01 format        | TestCreateTBSCertificate, TestCreateTBSCertificate_UserKeyIsEd25519, TestCreateTBSCertificate_CAKeyIsEd25519 | `ca_test.go:61-163`                           |
| [req.zbf0si] Per-host principals                | TestCreateTBSCertificate, TestCreateTBSCertificate_WithPrincipal                                             | `ca_test.go:61-205`                           |
| [req.56dvhi] Monotonic serial numbers           | TestCreateTBSCertificate, TestCreateTBSCertificate_WithPrincipal                                             | `ca_test.go:61-205`                           |
| [req.u72wa2] Certificate validity               | TestCreateTBSCertificate_DefaultValidity, TestCreateTBSCertificate_CustomValidity                            | `ca_test.go:94-121`                           |
| [req.ey98nq] Fresh nonces                       | TestCreateTBSCertificate_NonceUniqueness, TestNoncesAreNeverReused                                           | `ca_test.go:123-132`, `frost_test.go:434-467` |
| [req.2x3a51] permit-pty, permit-port-forwarding | TestCreateTBSCertificate_PermitPtyAndPortForwarding                                                          | `ca_test.go:207-226`                          |
| [req.wdalb2] Server builds TBS data             | TestCreateTBSCertificate, TestFullCertificateCreationFlow                                                    | `ca_test.go:61-328`                           |
| [req.jki5t0] Certificate building               | TestBuildSignedCertificate, TestFullCertificateCreationFlow, TestSignSSHCertificate                          | `ca_test.go:228-328`, `frost_test.go:748-826` |
| [req.5xcc6i] Round 1 commitment                 | TestServerRound1_GeneratesValidCommitment, TestServerRound1_InvalidInputs                                    | `frost_test.go:11-135`                        |
| [req.o3lf24] Round 2 partial signatures         | TestServerRound2_GeneratesValidPartialSignature, TestServerRound2_InvalidInputs                              | `frost_test.go:137-284`                       |
| [req.dzym7r] Signature aggregation              | TestAggregateSignatures_ProducesValidEd25519Signature, TestAggregateSignatures_InvalidInputs                 | `frost_test.go:286-566`                       |

### Requirements WITHOUT Unit Tests

All major requirements now have unit test coverage.

### Test Quality Issues - RESOLVED

All previously identified test quality issues have been addressed:

#### 1. TestHandler_HostOwnershipValidation_RejectsNonOwner (line 454)

**Status:** FIXED - New test added that creates a host for user1, sets up SSH CA for user2, then verifies that user2 attempting to request a cert for user1's host receives an "access denied" or "not found" error response.

#### 2. TestHandler_SessionDataZeroing_VerifiesActualZeroing (line 704)

**Status:** FIXED - New test added that keeps a reference to the original data slice and verifies the bytes are zeroed after session deletion.

#### 3. TestHandler_RetryAfterSessionFailure (line 603)

**Status:** FIXED - Test renamed and rewritten to actually test retry behavior. Creates a session, deletes it to simulate failure, then verifies a retry creates a new session successfully.

#### 4. TestHandler_ClientShareHandler_Success/TestHandler_PublicKeyHandler_Success

**Status:** Good tests - no changes needed.

## Integration Test Coverage

| Requirement | Integration Test |
|-------------|-----------------|
| All requirements | Not yet implemented - Phase 13 |

### Requirements WITHOUT Integration Tests

All requirements lack integration tests. Phase 13 (`ssh-ca-e2e.spec.ts`) will cover:
- [req.ancud7] User registration creates CA
- [req.vz2fg3] Container accepts CA auth
- [req.4whcli] Host without password
- [req.twjlw7] Web interface connection
- [req.xbft6g] Flag file verification

## Code Review

### 1. Security: Debug Logging Exposes JWT Secret - RESOLVED

**Status:** FIXED - The debug log statement has been removed from server.go.

### 2. Security: Hardcoded CORS Origins - RESOLVED

**Status:** FIXED - Handler now has `allowedOrigins []string` field and `NewHandler` accepts `rpOrigin string` parameter. Localhost origins are added automatically for development.

### 3. Protocol Issue: Server Does Not Aggregate Final Signature - RESOLVED

**Location:** `handler.go:402-487`

**Status:** FIXED - `handleRound2` now:
1. Receives client's partial signature in payload
2. Computes server's partial signature via `ServerRound2`
3. Aggregates both signatures via `AggregateSignatures`
4. Builds the final certificate via `BuildSignedCertificate`
5. Returns response with type `"certificate"` containing the signed certificate

### 4. Bug: Race Condition in Rate Limiter Check - RESOLVED

**Status:** FIXED - Rate limiter check moved to after host validation (line 266), so invalid requests don't consume rate limit quota.

### 5. Bug: send Channel May Block Forever - RESOLVED

**Status:** FIXED - `sendResponse` now calls `c.conn.Close()` when the channel is full (line 528).

### 6. Missing Error Handling: JSON Encode Errors - RESOLVED

**Status:** FIXED - JSON encode errors are now logged (lines 114-118).

### 7. Memory: FROST State Not Zeroed on All Exit Paths - RESOLVED

**Status:** FIXED - `ZeroSigningState(frostState)` is now called before returning on error in `handleRound1` (line 382).

### 8. Code Style: Inconsistent Response Type Names - RESOLVED

**Status:** FIXED - Response types are now consistent:
- Round 1: `"commitment"` (server's commitment)
- Round 2: `"certificate"` (final signed certificate)

### 9. Missing Feature: TBS Data Not Returned to Client - RESOLVED

**Status:** FIXED - The `session` response now includes TBS data in the `Payload` field (line 326).

### 10. Test Quality - RESOLVED

**Status:** All test quality issues have been addressed:
1. **TestHandler_HostOwnershipValidation_RejectsNonOwner** - Now tests WebSocket handler rejection
2. **TestHandler_SessionDataZeroing_VerifiesActualZeroing** - Now verifies memory zeroing
3. **TestHandler_RetryAfterSessionFailure** - Renamed and rewritten to test actual retry behavior

### 11. Performance: New Handler Per Request - NOT AN ISSUE

**Status:** Code is correct - handler is created once at server startup.

### 12. Bug: Potential Panic on Empty JWT Secret - RESOLVED

**Status:** FIXED - Debug log removed (see issue #1).

### 13. Documentation: Missing Handler Godoc Comments - RESOLVED

**Status:** FIXED - Godoc comments added to `handleRequestCert` (line 234), `handleRound1` (line 334), and `handleRound2` (line 402).
