# Code Review: Passkey Encryption Implementation

## Summary

This implementation adds cross-device passkey enrollment with master key encryption, allowing users to securely add passkeys from new devices using a custom SPAKE2-like protocol for key exchange and AES-256-GCM for encrypted master key transfer between machines.

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
| [req.erqla1] SPAKE2 handshake | ⚠️ | Implemented but not RFC 9382 compliant (see Code Review) |
| [req.smsrbz] Derive SPAKE2 params from code | ✅ | Password used in SPAKE2 key derivation |
| [req.kbqskn] Receive SPAKE2 message B | ✅ | Handled in `ws.onmessage` |
| [req.11y9dp] Send SPAKE2 message A | ✅ | Sent via WebSocket |
| [req.xuf7hi] Compute shared secret | ✅ | `spake2Finish` returns shared secret via ECDH |
| [req.elmvhg] SPAKE2 failure handling | ✅ | Error handling with retry support in UI |
| [req.989f5h] Master key transfer | ✅ | Master key transfer flow implemented |
| [req.qjp17z] Request encrypted master key | ✅ | `getMasterKey()` API call |
| [req.36fdlg] Decrypt master key with PRF | ✅ | `decrypt(prfKeyDerived, ...)` with versioned format |
| [req.kx0axx] Encrypt with session key | ✅ | `encrypt(key, decryptedMasterKey)` |
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
| [req.5b4xmi] Send SPAKE2 message B | ✅ | Sent after peer_connected notification |
| [req.fu4k2k] Receive SPAKE2 message A | ✅ | Handled in message handler |
| [req.i3gm0t] Derive session key | ✅ | `deriveKey(result.sharedSecret, ...)` |
| [req.mz1e0l] Master key received | ✅ | `encrypted_payload` handling |
| [req.otuasv] Decrypt with session key | ✅ | `decrypt(sessionKeyRef.current!, ...)` |
| [req.5wwa85] Get credential options | ✅ | `enrollmentBegin(code)` |
| [req.014tfk] WebAuthn credential creation with PRF | ✅ | PRF extension requested with proper ArrayBuffer salt |
| [req.fwfejn] Encrypt master key with new PRF | ✅ | `encrypt(prfKey, masterKeyRef.current)` |
| [req.juesne] Complete enrollment | ✅ | `enrollmentComplete()` |
| [req.q9gwaf] Success/error feedback | ✅ | Status states handle this |
| [req.7z0811] Redirect to login | ✅ | `navigate("/login")` after 2 seconds |
| [req.e11s51] Cancel button | ✅ | `handleCancel` implemented with proper cleanup |
| [req.trer79] Only two connections per code | ✅ | Server enforces in WebSocket handler |
| [req.np0vt2] Mb first, Ma second | ✅ | Server checks `pair.machineB == nil` before allowing Ma |
| [req.d7zh06] Link enrollment to user | ✅ | `db.LinkEnrollmentToUser` |
| [req.o16rm6] Reject Ma if Mb not present | ✅ | "machine B must connect first" error |
| [req.5yd9a7] Terminate on verification failure | ✅ | Connection closed on errors |
| [req.a0z799] Encrypted messages after SPAKE2 | ✅ | Server relays messages blindly |
| [req.qhyidm] PRF extension in registration | ✅ | PRF extension properly requested with ArrayBuffer salt |
| [req.hmhedi] Generate random master key | ✅ | `generateMasterKey()` |
| [req.9vhwsv] Encrypt master key with PRF | ✅ | `RegisterPage.tsx` properly encrypts with PRF-derived key |
| [req.wemf9m] Send encrypted master key | ✅ | `registerFinish(..., encryptedMasterKey)` |
| [req.dwfami] Use @noble/curves | ⚠️ | Uses `@noble/hashes` for HKDF but not `@noble/curves` for EC ops |
| [req.43fwpo] RFC 9382 compliance | ❌ | Implementation uses XOR-based blinding, not RFC-compliant SPAKE2 |
| [req.a71c6e] hash-to-curve for M and N | ❌ | Uses simple SHA256, not hash-to-curve |
| [req.lkx4qh] Careful implementation | ⚠️ | Implementation works but needs security review |

## Implementation Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Database Schema & Migrations | ✅ | Tables and queries implemented |
| Phase 2: Backend Enrollment Endpoints | ✅ | All handlers implemented |
| Phase 3: Backend WebSocket Handler | ✅ | Message relay works, proper cleanup |
| Phase 4: Frontend Crypto Utilities | ⚠️ | SPAKE2 functional but not RFC-compliant |
| Phase 5: Frontend API Functions | ✅ | All functions added |
| Phase 6: Modify Registration Page | ✅ | PRF encryption properly implemented |
| Phase 7: Add Passkey Page (Machine A) | ✅ | Full flow implemented |
| Phase 8: Register Passkey Page (Machine B) | ✅ | Full flow implemented, confirmation encrypted |
| Phase 9: Integration Tests | ⚠️ | Basic tests, WebAuthn E2E not testable |
| Phase 10: Documentation & Cleanup | ⚠️ | Debug logging still present |

## Todo Status

### Completed
- All database migrations and queries
- All backend endpoints with proper validation
- WebSocket handler with proper cleanup and origin checking
- Frontend crypto utilities (functional implementation)
- All API functions
- Registration page with proper PRF encryption
- AddPasskeyPage with PRF-based master key transfer
- RegisterPasskeyPage with proper encrypted confirmation
- Integration test setup with basic coverage

### Still Pending
- [ ] RFC 9382 compliant SPAKE2 implementation [req.43fwpo]
- [ ] hash-to-curve for M and N points [req.a71c6e]
- [ ] Review and remove debug logging (`console.log` statements)
- [ ] Ensure error messages don't leak sensitive information
- [ ] Final security review

## Unit Test Coverage

| Requirement | Unit Test Coverage |
|-------------|-------------------|
| [req.ofsosx] Enrollment code generation | ❌ No direct unit tests for `generateEnrollmentCode()` |
| [req.dwfami] SPAKE2 with @noble/curves | ❌ No unit tests for spake2.ts |
| [req.kx0axx] AES-256-GCM encryption | ❌ No unit tests for aes.ts |
| [req.otuasv] AES-256-GCM decryption | ❌ No unit tests for aes.ts |
| [req.eejh3t] PRF key derivation | ❌ No unit tests for prf.ts |
| [req.hmhedi] Master key generation | ❌ No unit tests for prf.ts |

**Requirements without unit tests:**
- All frontend crypto utility functions (spake2.ts, aes.ts, prf.ts)
- Enrollment code generation function
- Database query functions (db_test.go exists but has limited coverage)
- Master key versioning/parsing functions

## Integration Test Coverage

| Requirement | Integration Test | File |
|-------------|-----------------|------|
| [req.vgsxxk] Start button | ✅ | `cross-device.spec.ts` |
| [req.wj9f9q] Code display format | ✅ | `cross-device.spec.ts` |
| [req.bnv3m1] Status indicator | ✅ | `cross-device.spec.ts` |
| [req.5h2z1o] Countdown timer | ✅ | `cross-device.spec.ts`, `security.spec.ts` |
| [req.08hb37] Warning message | ⚠️ Partial | `cross-device.spec.ts` |
| [req.xg8m17] URL display | ⚠️ Partial | `cross-device.spec.ts` |
| [req.40vbd1] Invalid code validation | ⚠️ Limited | Can't test without auth |
| [req.o16rm6] Ma rejected without Mb | ⚠️ Partial | `cross-device.spec.ts` |
| [req.e11s51] Cancel button | ✅ | `cross-device.spec.ts` |
| [req.ofsosx] Enrollment creation | ✅ | `registration-with-masterkey.spec.ts`, `security.spec.ts` |
| [req.j5182j] Unauthenticated access | ✅ | `security.spec.ts` |
| [req.5h2z1o] 5-minute expiry | ✅ | `security.spec.ts` |
| [req.trer79] Two connections per code | ⚠️ Partial | `security.spec.ts` |

**Requirements without integration tests:**
- [req.erqla1] Full SPAKE2 handshake flow (requires WebAuthn)
- [req.989f5h] Master key transfer flow (requires WebAuthn)
- [req.qhyidm] PRF extension in registration (requires WebAuthn)
- [req.014tfk] WebAuthn credential creation with PRF (requires WebAuthn)
- [req.7z0811] Redirect after success (requires WebAuthn)
- [req.36fdlg] Decrypt master key with PRF (requires WebAuthn)
- Most end-to-end flows requiring actual WebAuthn authentication

## Code Review

### Critical Issues

#### 1. SPAKE2 Implementation is Not RFC 9382 Compliant [SECURITY - HIGH]

**Location:** `web/src/lib/crypto/spake2.ts`

**Issue:** The SPAKE2 implementation uses XOR-based blinding instead of proper elliptic curve scalar multiplication with hash-to-curve derived M and N points as specified in RFC 9382.

**Current code:**
```typescript
function xorArrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ (b[i % b.length])
  }
  return result
}

// Blind the public key
const blindedPublicKey = xorArrays(publicKeyBytes, blindingFactor)
```

**Security implications:**
- XOR blinding of a 65-byte compressed EC point with a 32-byte hash creates predictable patterns
- The blinding factor wraps around (`b[i % b.length]`), reducing effective entropy
- This is NOT cryptographically secure SPAKE2 and may be vulnerable to offline dictionary attacks
- However, since the protocol uses proper ECDH after "unblinding", the actual shared secret derivation is secure assuming both parties use the correct password

**Mitigating factors:**
- The implementation does use proper ECDH (`crypto.subtle.deriveBits`) for the actual key exchange
- The transcript includes blinded keys and shared secret via HKDF
- The 8-character enrollment code provides ~41 bits of entropy
- Attack requires authenticated session on Machine A

**Recommendation:**
1. Implement proper SPAKE2 using `@noble/curves` for elliptic curve scalar multiplication:
```typescript
import { p256 } from '@noble/curves/p256'

// Use hash-to-curve (RFC 9380) for M and N
const M = p256.hashToCurve(new TextEncoder().encode('SPAKE2-P256-SHA256-HKDF-SHA256-M'))
const N = p256.hashToCurve(new TextEncoder().encode('SPAKE2-P256-SHA256-HKDF-SHA256-N'))

// Derive w from password
const w = hashToScalar(password)

// Party A: pA = x*G + w*M
// Party B: pB = y*G + w*N
```

2. Alternatively, document the security properties of the current implementation and accept it as a non-standard but functional key exchange given the other security constraints (authenticated Ma, short-lived codes).

---

#### 2. Debug Logging Contains Sensitive Information [SECURITY - MEDIUM]

**Location:** `web/src/pages/AddPasskeyPage.tsx:65-67`, `internal/auth/enrollment_ws.go:113`

**Issue:** Debug logging exposes token presence and other potentially sensitive information:

```typescript
console.log('[AddPasskeyPage] Token from getToken():', token ? 'present' : 'null');
console.log('[AddPasskeyPage] localStorage token:', localStorage.getItem('token'));
console.log('[AddPasskeyPage] localStorage user:', localStorage.getItem('user'));
```

```go
slog.Info("WebSocket token debug", "token_len", len(token))
```

**Recommendation:**
1. Remove all debug `console.log` statements before production:
```typescript
// Remove these lines entirely
// console.log('[AddPasskeyPage] Token from getToken():', token ? 'present' : 'null');
// console.log('[AddPasskeyPage] localStorage token:', localStorage.getItem('token'));
// console.log('[AddPasskeyPage] localStorage user:', localStorage.getItem('user'));
```

2. Change Go debug logging to use `slog.Debug` instead of `slog.Info`:
```go
slog.Debug("WebSocket connection", "has_token", len(token) > 0)
```

---

### Moderate Issues

#### 3. Origin Check Could Be More Restrictive

**Location:** `internal/auth/enrollment_ws.go:20-24`

**Issue:** The origin check allows empty origin or matching configured origin:
```go
CheckOrigin: func(r *http.Request) bool {
    origin := r.Header.Get("Origin")
    return origin == "" || origin == cfg.RPOrigin
}
```

Empty origin is allowed, which could be exploited in some scenarios.

**Recommendation:**
Consider requiring origin header for WebSocket connections:
```go
CheckOrigin: func(r *http.Request) bool {
    origin := r.Header.Get("Origin")
    if origin == "" {
        // Only allow same-origin requests (no Origin header) from browsers
        // WebSocket connections from non-browser clients may not have Origin
        return true
    }
    return origin == cfg.RPOrigin
}
```

This is acceptable given the current implementation, but document the decision.

---

#### 4. No Cleanup of Stale Enrollments

**Location:** Database/server

**Issue:** Expired enrollments are never cleaned up from the database. Over time, the `passkey_enrollments` table will accumulate stale records.

**Recommendation:**
Add a cleanup mechanism in `internal/db/maintenance.go`:
```go
func CleanupExpiredEnrollments(database *sql.DB) error {
    _, err := database.Exec(
        "DELETE FROM passkey_enrollments WHERE expires_at < ? OR completed = TRUE",
        time.Now().UTC().Format(timeFormat),
    )
    return err
}
```

Call this periodically (e.g., in the existing maintenance job) or on each new enrollment creation.

---

#### 5. WebSocket Read Deadline Not Extended on Message Receipt

**Location:** `internal/auth/enrollment_ws.go:214-218`

**Issue:** The read deadline is set to 60 seconds and only extended on pong, but not on actual message receipt:
```go
c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
c.conn.SetPongHandler(func(string) error {
    c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
    return nil
})
```

If a legitimate enrollment takes longer than 60 seconds without ping/pong, the connection will timeout.

**Recommendation:**
Extend deadline on each successful message read:
```go
for {
    _, message, err := c.conn.ReadMessage()
    if err != nil {
        break
    }
    // Extend deadline on successful read
    c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
    // ... rest of handler
}
```

---

#### 6. PRF Salt ArrayBuffer Handling

**Location:** `web/src/pages/RegisterPage.tsx:87`, `AddPasskeyPage.tsx:111`

**Issue:** The PRF salt is passed as `prfSalt.buffer`:
```typescript
prf: {
  eval: {
    first: prfSalt.buffer
  }
}
```

Since `getPrfSalt()` returns a `Uint8Array`, accessing `.buffer` on it returns the underlying `ArrayBuffer`. This is correct, but if `getPrfSalt()` returns a view of a larger buffer (it doesn't currently), this could expose more data than intended.

**Recommendation:**
Create a new ArrayBuffer to be safe:
```typescript
const prfSaltBytes = getPrfSalt()
const prfSaltBuffer = prfSaltBytes.buffer.slice(
    prfSaltBytes.byteOffset,
    prfSaltBytes.byteOffset + prfSaltBytes.byteLength
)
```

This is currently not a bug since `getPrfSalt()` creates a new buffer via `TextEncoder`, but it's a defensive practice.

---

### Minor Issues

#### 7. Inconsistent Base64 Function Usage

**Location:** Multiple frontend files

**Issue:** Base64 encoding/decoding functions are spread across multiple files:
- `encodeBase64`/`decodeBase64` exported from `prf.ts` (actually in `encoding.ts`)
- `encodeMessage`/`decodeMessage` in `spake2.ts` (wrap the same functions)
- `bufferToBase64URLString` from `@simplewebauthn/browser`

**Recommendation:**
Consolidate base64 operations in `encoding.ts` and import from there consistently:
```typescript
// In all files that need base64:
import { encodeBase64, decodeBase64, encodeBase64URL, decodeBase64URL } from '@/lib/crypto/encoding'
```

---

#### 8. Status Check in onclose Handler Uses Stale State

**Location:** `web/src/pages/AddPasskeyPage.tsx:269-274`

**Issue:** The `onclose` handler captures `status` at closure creation time, not at execution time:
```typescript
ws.onclose = () => {
    if (!completedRef.current && status !== "error") {
        setError("Connection closed unexpectedly")
        setStatus("error")
    }
}
```

**Current mitigation:** The code uses `completedRef.current` which is a ref and will have the correct value, so the primary success case works. However, `status !== "error"` may not reflect the current state.

**Recommendation:**
Use a ref for status checking in closures:
```typescript
const statusRef = useRef<Status>("idle")
// Update in setStatus calls
const updateStatus = (newStatus: Status) => {
    statusRef.current = newStatus
    setStatus(newStatus)
}

ws.onclose = () => {
    if (!completedRef.current && statusRef.current !== "error") {
        setError("Connection closed unexpectedly")
        updateStatus("error")
    }
}
```

---

#### 9. Missing TypeScript Strict Null Assertions

**Location:** Various files with `!` assertions

**Issue:** Forced unwrapping (`sessionKeyRef.current!`, `prfKeyDerived!`) without explicit guards:
```typescript
const decrypted = await decrypt(sessionKeyRef.current!, nonce, ciphertext)
```

**Recommendation:**
Add explicit checks before usage:
```typescript
if (!sessionKeyRef.current) {
    throw new Error("Session key not available")
}
const decrypted = await decrypt(sessionKeyRef.current, nonce, ciphertext)
```

This is already done in some places (e.g., `RegisterPasskeyPage.tsx:116`) but should be consistent.

---

#### 10. Error Message Reveals Internal State

**Location:** `web/src/lib/crypto/prf.ts:78`

**Issue:** Error message reveals version number:
```typescript
throw new Error(`Master key must be encrypted with PRF. Found version: ${version}`)
```

**Recommendation:**
Use a generic error message:
```typescript
throw new Error('Invalid master key format')
```

---

### Code Style Observations

1. **Consistent error handling:** The code uses a mix of `console.error` and proper error state management. Consider using a centralized error logging utility.

2. **Type assertions:** Several places use `as unknown as` type assertions. Consider defining proper types for WebAuthn extension results.

3. **Magic numbers:** Some magic numbers exist (e.g., `12` for nonce length, `32` for key length). Consider defining constants.

4. **Good practices observed:**
   - Proper use of `useRef` for values that shouldn't trigger re-renders
   - Proper cleanup in `useEffect` return functions
   - Rejection sampling for enrollment code generation (fixes modulo bias)
   - Proper origin checking in WebSocket upgrader
   - Versioned master key format for future compatibility
   - Confirmation message properly encrypted (fixed from previous review)
