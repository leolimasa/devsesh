# Code Review: Passkey Encryption Implementation

## Summary

This implementation adds cross-device passkey enrollment with master key encryption, allowing users to securely add passkeys from new devices using SPAKE2 for key exchange and AES-256-GCM for encrypted master key transfer between machines.

## Requirements Coverage

| Requirement | Status | Implementation Details |
|-------------|--------|------------------------|
| [req.ebg0n8] User must be authenticated | ✅ | `AddPasskeyPage.tsx` checks for JWT token and uses it for WebSocket connection |
| [req.lnezjk] Code input field (with/without hyphen) | ✅ | `handleCodeChange` and `formatCode` in `AddPasskeyPage.tsx` handle hyphen formatting |
| [req.xg8m17] Display URL for Machine B | ✅ | Shows `{serverUrl}/passkeys/enroll` in the page |
| [req.08hb37] Warning about device control | ✅ | "Only enter codes from devices YOU control" warning displayed |
| [req.dk5jee] "Link device" button | ✅ | Button implemented with proper states |
| [req.sm41hl] Code submission flow | ✅ | `handleSubmit` implements the full flow |
| [req.40vbd1] Strip hyphen and validate format | ✅ | Regex validation `/^[A-Z0-9]{8}$/` |
| [req.iw7vre] WebAuthn authentication | ✅ | Uses `auth-begin` and `auth-finish` endpoints |
| [req.eejh3t] PRF extension for key derivation | ✅ | `deriveMasterKeyFromPrf` used |
| [req.jt9sgz] WebSocket with JWT | ✅ | `getEnrollmentWebSocketURL` includes token |
| [req.g3ff0v] Server links enrollment to user | ✅ | `LinkEnrollmentToUser` called in WebSocket handler |
| [req.erqla1] SPAKE2 handshake | ✅ | `spake2Init` and `spake2Finish` implemented |
| [req.smsrbz] Derive SPAKE2 params from code | ✅ | Password used directly in SPAKE2 |
| [req.kbqskn] Receive SPAKE2 message B | ✅ | Handled in `ws.onmessage` |
| [req.11y9dp] Send SPAKE2 message A | ✅ | Sent via WebSocket |
| [req.xuf7hi] Compute shared secret | ✅ | `spake2Finish` returns shared secret |
| [req.elmvhg] SPAKE2 failure handling | ⚠️ | Error handling exists but no specific "wrong code" detection |
| [req.989f5h] Master key transfer | ✅ | `handleMasterKeyTransfer` logic in `AddPasskeyPage.tsx` |
| [req.qjp17z] Request encrypted master key | ✅ | `getMasterKey()` API call |
| [req.36fdlg] Decrypt master key with PRF | ✅ | `decryptWithKey(prfKeyDerived, ...)` |
| [req.kx0axx] Encrypt with session key | ✅ | `encryptWithKey(key, decryptedMasterKey)` |
| [req.1e8lhh] Send encrypted payload | ✅ | WebSocket `encrypted_payload` message |
| [req.tr1031] Success message | ✅ | Status "success" shown |
| [req.naf7y6] Cancel button | ✅ | `handleCancel` implemented |
| [req.j5182j] Public route access | ✅ | `/passkeys/enroll` route not wrapped in `ProtectedRoute` |
| [req.vgsxxk] Start button | ✅ | "Start Enrollment" button |
| [req.ofsosx] Create enrollment record | ✅ | `CreateEnrollmentHandler` and `createPasskeyEnrollment` |
| [req.wj9f9q] Display code with hyphen | ✅ | `{code.slice(0, 4)}-{code.slice(4)}` |
| [req.bnv3m1] Status indicator | ✅ | "Waiting for other device..." etc. |
| [req.5h2z1o] 5-minute expiry and countdown | ✅ | `enrollmentExpiry = 5 * time.Minute` and countdown timer |
| [req.zbesi6] WebSocket without token | ✅ | Machine B connects without token |
| [req.b1kyz5] SPAKE2 as party B | ✅ | `spake2InitB` |
| [req.5b4xmi] Send SPAKE2 message B | ✅ | Sent on `ws.onopen` |
| [req.fu4k2k] Receive SPAKE2 message A | ✅ | Handled in message handler |
| [req.i3gm0t] Derive session key | ✅ | `deriveKey(result.sharedSecret, ...)` |
| [req.mz1e0l] Master key received | ✅ | `encrypted_payload` handling |
| [req.otuasv] Decrypt with session key | ✅ | `decryptWithKey(sessionKeyRef.current!, ...)` |
| [req.5wwa85] Get credential options | ✅ | `enrollmentBegin(code)` |
| [req.014tfk] WebAuthn credential creation with PRF | ⚠️ | Partially - PRF extension requested but retrieval logic is complex |
| [req.fwfejn] Encrypt master key with new PRF | ⚠️ | Logic exists but relies on PRF being available |
| [req.juesne] Complete enrollment | ✅ | `enrollmentComplete()` |
| [req.q9gwaf] Success/error feedback | ✅ | Status states handle this |
| [req.7z0811] Redirect to login | ✅ | `navigate("/login")` after 2 seconds |
| [req.e11s51] Cancel button | ✅ | `handleCancel` implemented |
| [req.trer79] Only two connections per code | ✅ | Server enforces in WebSocket handler |
| [req.np0vt2] Mb first, Ma second | ✅ | Server checks `pair.machineB == nil` before allowing Ma |
| [req.d7zh06] Link enrollment to user | ✅ | `db.LinkEnrollmentToUser` |
| [req.o16rm6] Reject Ma if Mb not present | ✅ | "machine B must connect first" error |
| [req.5yd9a7] Terminate on verification failure | ⚠️ | Connection closed on errors but no explicit SPAKE2 verification |
| [req.a0z799] Encrypted messages after SPAKE2 | ✅ | Server relays messages blindly |
| [req.qhyidm] PRF extension in registration | ⚠️ | PRF extension not explicitly requested in `RegisterPage.tsx` |
| [req.hmhedi] Generate random master key | ✅ | `generateMasterKey()` |
| [req.9vhwsv] Encrypt master key with PRF | ⚠️ | `RegisterPage.tsx` just encodes master key, doesn't encrypt with PRF |
| [req.wemf9m] Send encrypted master key | ✅ | `registerFinish(..., encryptedMasterKey)` |
| [req.dwfami] Use @noble/curves | ✅ | Imported in `spake2.ts` |
| [req.43fwpo] RFC 9382 compliance | ❌ | Implementation is a simplified version, not RFC-compliant |
| [req.a71c6e] hash-to-curve for M and N | ❌ | Uses simple SHA256, not hash-to-curve |
| [req.lkx4qh] Careful implementation | ⚠️ | Implementation works but needs security review |

## Implementation Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Database Schema & Migrations | ✅ | Tables and queries implemented |
| Phase 2: Backend Enrollment Endpoints | ✅ | All handlers implemented |
| Phase 3: Backend WebSocket Handler | ✅ | Message relay works |
| Phase 4: Frontend Crypto Utilities | ⚠️ | SPAKE2 simplified, not RFC-compliant |
| Phase 5: Frontend API Functions | ✅ | All functions added |
| Phase 6: Modify Registration Page | ⚠️ | PRF encryption not properly implemented |
| Phase 7: Add Passkey Page (Machine A) | ✅ | Full flow implemented |
| Phase 8: Register Passkey Page (Machine B) | ✅ | Full flow implemented |
| Phase 9: Integration Tests | ⚠️ | Basic tests, WebAuthn not testable |
| Phase 10: Documentation & Cleanup | ⚠️ | Incomplete per todo.md |

## Todo Status

### Completed (per todo.md and code review)
- All database migrations and queries
- All backend endpoints
- WebSocket handler (core functionality)
- Frontend crypto utilities (basic functionality)
- All API functions
- Registration page modifications
- AddPasskeyPage implementation
- RegisterPasskeyPage implementation
- Integration test setup

### Still Pending
- [ ] Message relay verification [req.a0z799] - code exists but unchecked item in todo
- [ ] Terminate connection on verification failure [req.5yd9a7] - unchecked
- [ ] Message read/write pumps - unchecked (though implemented)
- [ ] Cleanup on disconnect - unchecked (though implemented)
- [ ] Add EnrollmentHub to Server struct - unchecked (implemented)
- [ ] Verify PRF extension in WebAuthn request
- [ ] Review and remove debug logging
- [ ] Ensure error messages don't leak sensitive information
- [ ] Final security review

## Unit Test Coverage

| Requirement | Unit Test Coverage |
|-------------|-------------------|
| [req.ofsosx] Enrollment code generation | ❌ No direct unit tests |
| [req.dwfami] @noble/curves SPAKE2 | ❌ No unit tests for SPAKE2 |
| [req.kx0axx] AES-256-GCM encryption | ❌ No unit tests for aes.ts |
| [req.otuasv] AES-256-GCM decryption | ❌ No unit tests for aes.ts |
| [req.eejh3t] PRF key derivation | ❌ No unit tests for prf.ts |
| [req.hmhedi] Master key generation | ❌ No unit tests for prf.ts |

**Requirements without unit tests:**
- All crypto utility functions (spake2.ts, aes.ts, prf.ts)
- Enrollment code generation
- Database query functions (only db_test.go exists but limited coverage)

## Integration Test Coverage

| Requirement | Integration Test |
|-------------|-----------------|
| [req.vgsxxk] Start button | ✅ `cross-device.spec.ts` |
| [req.wj9f9q] Code display format | ✅ `cross-device.spec.ts` |
| [req.bnv3m1] Status indicator | ✅ `cross-device.spec.ts` |
| [req.5h2z1o] Countdown timer | ✅ `cross-device.spec.ts` |
| [req.08hb37] Warning message | ⚠️ Partial in `cross-device.spec.ts` |
| [req.xg8m17] URL display | ⚠️ Partial in `cross-device.spec.ts` |
| [req.40vbd1] Invalid code validation | ⚠️ Limited due to auth |
| [req.o16rm6] Ma rejected without Mb | ⚠️ Limited test |
| [req.e11s51] Cancel button | ✅ `cross-device.spec.ts` |
| [req.ofsosx] Enrollment creation | ✅ `registration-with-masterkey.spec.ts` |
| [req.j5182j] Unauthenticated access | ✅ `security.spec.ts` |
| [req.5h2z1o] 5-minute expiry | ✅ `security.spec.ts` |
| [req.trer79] Two connections per code | ⚠️ Limited test |

**Requirements without integration tests:**
- [req.erqla1] Full SPAKE2 handshake flow
- [req.989f5h] Master key transfer flow
- [req.qhyidm] PRF extension in registration
- [req.014tfk] WebAuthn credential creation with PRF
- [req.7z0811] Redirect after success
- Most end-to-end flows requiring actual WebAuthn

## Code Review

### Critical Issues

#### 1. SPAKE2 Implementation is Not RFC 9382 Compliant [SECURITY - HIGH]

**Location:** `web/src/lib/crypto/spake2.ts`

**Issue:** The SPAKE2 implementation is a simplified version that does not follow RFC 9382. It uses XOR operations and SHA256 hashing instead of proper elliptic curve operations with hash-to-curve for M and N points.

**Current code:**
```typescript
function computePublicElement(passwordHash: Uint8Array, scalar: Uint8Array, point: Uint8Array): Uint8Array {
  const result = new Uint8Array(64)
  for (let i = 0; i < 32; i++) {
    result[i] = scalar[i] ^ point[i]
  }
  // ...
  return sha256(result)
}
```

**Security implications:**
- This is not cryptographically secure SPAKE2
- No protection against offline dictionary attacks
- The "shared secret" is deterministic given the password, making it trivially computable

**Recommendation:**
1. Implement proper SPAKE2 using elliptic curve operations from `@noble/curves`
2. Use hash-to-curve (RFC 9380) to derive M and N points on P-256
3. Implement the actual SPAKE2 protocol:
   - Party A: pA = x*G + w*M
   - Party B: pB = y*G + w*N
   - Shared key derived from scalar multiplication
4. Consider using an existing SPAKE2 implementation or getting the custom implementation audited

#### 2. RegisterPage.tsx Does Not Actually Encrypt Master Key with PRF [SECURITY - HIGH]

**Location:** `web/src/pages/RegisterPage.tsx:35-40`

**Issue:** The registration page generates a master key but only base64-encodes it, not encrypting it with the PRF-derived key.

**Current code:**
```typescript
const masterKey = generateMasterKey()
const encryptedMasterKey = encodeBase64(masterKey)
await registerFinish(email, credential, encryptedMasterKey)
```

**Expected behavior per requirements [req.9vhwsv]:**
- Client should encrypt the master key using the PRF-derived key
- The stored value should be ciphertext, not plaintext

**Recommendation:**
1. Request PRF extension during WebAuthn registration
2. Get PRF output after credential creation
3. Use `deriveMasterKeyFromPrf` to get the encryption key
4. Use `encryptWithKey` to encrypt the master key
5. Store the encrypted result (nonce + ciphertext)

```typescript
// Example fix
const credential = await startRegistration(options)
const extResults = credential.getClientExtensionResults?.()
if (extResults?.prf?.results?.first) {
  const prfKey = await deriveMasterKeyFromPrf(new Uint8Array(extResults.prf.results.first))
  const { nonce, ciphertext } = await encryptWithKey(prfKey, masterKey)
  const encryptedMasterKey = new Uint8Array(12 + ciphertext.length)
  encryptedMasterKey.set(nonce, 0)
  encryptedMasterKey.set(ciphertext, 12)
  await registerFinish(email, credential, encodeBase64(encryptedMasterKey))
}
```

#### 3. Modulo Bias in Enrollment Code Generation [SECURITY - MEDIUM]

**Location:** `internal/auth/enrollment.go:33`

**Issue:** Using modulo on random bytes introduces bias:
```go
code[i] = enrollmentCodeChars[int(bytes[i])%len(enrollmentCodeChars)]
```

Since 256 % 36 = 4, characters at indices 0-3 (A, B, C, D) are slightly more likely.

**Recommendation:**
Use rejection sampling:
```go
func generateEnrollmentCode() (string, error) {
    code := make([]byte, enrollmentCodeLen)
    charsLen := byte(len(enrollmentCodeChars))
    for i := 0; i < enrollmentCodeLen; {
        b := make([]byte, 1)
        if _, err := rand.Read(b); err != nil {
            return "", err
        }
        // Reject values that would cause bias (256 - 256%36 = 252)
        if b[0] < 252 {
            code[i] = enrollmentCodeChars[b[0]%charsLen]
            i++
        }
    }
    return string(code), nil
}
```

### Moderate Issues

#### 4. WebSocket CheckOrigin Always Returns True [SECURITY - MEDIUM]

**Location:** `internal/auth/enrollment_ws.go:18-20`

**Issue:**
```go
CheckOrigin: func(r *http.Request) bool {
    return true
}
```

This allows cross-origin WebSocket connections, which could enable CSRF-style attacks.

**Recommendation:**
```go
CheckOrigin: func(r *http.Request) bool {
    origin := r.Header.Get("Origin")
    // Check against allowed origins from config
    return origin == "" || origin == cfg.AllowedOrigin
}
```

#### 5. EnrollmentBeginHandler Generates Random PRF Salt But Doesn't Store It

**Location:** `internal/auth/enrollment.go:117-130`

**Issue:** A random PRF salt is generated and sent in the response, but the client is expected to use a fixed salt (`devsesh-master-key-v1`). This mismatch could cause issues.

**Recommendation:**
Either:
1. Remove the random salt generation and use the fixed salt consistently
2. Or store the salt and ensure both sides use the same value

#### 6. No Timeout on WebSocket Read Operations

**Location:** `internal/auth/enrollment_ws.go:196`

**Issue:** The read deadline is set to 60 seconds, but if no messages are received, the connection stays open indefinitely consuming resources.

**Recommendation:**
Add overall enrollment timeout:
```go
// Add enrollment timeout
enrollmentTimeout := time.NewTimer(5 * time.Minute)
defer enrollmentTimeout.Stop()

select {
case <-enrollmentTimeout.C:
    c.conn.WriteMessage(websocket.CloseMessage,
        websocket.FormatCloseMessage(websocket.CloseNormalClosure, "enrollment timeout"))
    return
default:
    // Continue normal processing
}
```

#### 7. sessionKey State Management Issue in AddPasskeyPage

**Location:** `web/src/pages/AddPasskeyPage.tsx:231-240`

**Issue:** `sessionKey` state might not be updated by the time the encrypted_payload handler runs due to React's asynchronous state updates.

```typescript
setSessionKey(key)
// ...later in another message handler:
const decrypted = await decryptWithKey(sessionKey!, nonce, ciphertext)
```

**Recommendation:**
Use `useRef` for the session key (like `RegisterPasskeyPage.tsx` does):
```typescript
const sessionKeyRef = useRef<Uint8Array | null>(null)
// In handler:
sessionKeyRef.current = key
// Later:
const decrypted = await decryptWithKey(sessionKeyRef.current!, nonce, ciphertext)
```

#### 8. Confirmation Message Not Actually Encrypted

**Location:** `web/src/pages/RegisterPasskeyPage.tsx:168-172`

**Issue:** The "received" confirmation is sent with an empty nonce and unencrypted:
```typescript
ws.send(JSON.stringify({
  type: "encrypted_payload",
  nonce: encodeBase64(new Uint8Array(12)), // Empty nonce!
  ciphertext: encodeBase64(new TextEncoder().encode("received")),
}))
```

This is not AES-GCM encrypted, just plain text labeled as ciphertext.

**Recommendation:**
Actually encrypt the confirmation:
```typescript
const confirmationData = new TextEncoder().encode("received")
const { nonce, ciphertext } = await encryptWithKey(sessionKeyRef.current!, confirmationData)
ws.send(JSON.stringify({
  type: "encrypted_payload",
  nonce: encodeBase64(nonce),
  ciphertext: encodeBase64(ciphertext),
}))
```

### Minor Issues

#### 9. Duplicate Encryption Functions

**Location:** `web/src/lib/crypto/prf.ts` and `web/src/lib/crypto/aes.ts`

**Issue:** `encryptWithKey`/`decryptWithKey` in `prf.ts` duplicate `encrypt`/`decrypt` in `aes.ts`.

**Recommendation:**
Remove duplicates and import from a single source.

#### 10. Missing Error Boundary for WebSocket Closure

**Location:** `web/src/pages/AddPasskeyPage.tsx:255-259`

**Issue:**
```typescript
ws.onclose = () => {
  if (status !== "error") {
    setStatus("success")
  }
}
```

This sets success on any close, even premature disconnection.

**Recommendation:**
Track whether the flow completed successfully:
```typescript
const completedRef = useRef(false)
// When actually complete:
completedRef.current = true
setStatus("success")
ws.close()

// In onclose:
ws.onclose = () => {
  if (!completedRef.current && status !== "error") {
    setError("Connection closed unexpectedly")
    setStatus("error")
  }
}
```

#### 11. WebSocket URL Construction is Redundant

**Location:** `web/src/pages/RegisterPasskeyPage.tsx:68-71`

**Issue:**
```typescript
const wsURL = getEnrollmentWebSocketURL(enrollmentCode)
const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
const fullURL = `${protocol}//${window.location.host}${wsURL}`
```

`getEnrollmentWebSocketURL` already returns a full URL with protocol.

**Recommendation:**
Just use:
```typescript
const wsURL = getEnrollmentWebSocketURL(enrollmentCode)
const ws = new WebSocket(wsURL)
```

#### 12. No Cleanup of Stale Enrollments

**Location:** Database/server

**Issue:** Expired enrollments are never cleaned up from the database.

**Recommendation:**
Add a periodic cleanup job or clean up on access:
```go
func CleanupExpiredEnrollments(db *sql.DB) error {
    _, err := db.Exec(
        "DELETE FROM passkey_enrollments WHERE expires_at < ?",
        time.Now().UTC().Format(timeFormat),
    )
    return err
}
```

#### 13. Console Logging of Errors

**Location:** Multiple frontend files

**Issue:** `console.error` and `console.warn` calls may leak information in production.

**Recommendation:**
Use a logging utility that can be configured per environment:
```typescript
import { logger } from '@/lib/logger'
logger.error("Registration error:", err)
```

### Code Style Issues

#### 14. Inconsistent Base64 Encoding/Decoding Functions

Multiple implementations exist across files:
- `encodeBase64` / `decodeBase64` in `prf.ts`
- `encodeMessage` / `decodeMessage` in `spake2.ts`
- `base64ToUint8Array` / `uint8ArrayToBase64` in `AddPasskeyPage.tsx`

**Recommendation:**
Consolidate into a single utility file.

#### 15. Missing TypeScript Strict Null Checks

**Location:** Various `!` assertions

**Issue:** Forced unwrapping (`sessionKey!`, `prfKeyDerived!`) without proper null guards.

**Recommendation:**
Add explicit checks:
```typescript
if (!sessionKeyRef.current) {
  throw new Error("Session key not available")
}
const decrypted = await decryptWithKey(sessionKeyRef.current, nonce, ciphertext)
```
