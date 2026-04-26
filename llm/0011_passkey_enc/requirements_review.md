# Requirements Review: Passkey Enrollment & Master Key Encryption

**Document reviewed:** requirements.md
**Review date:** 2026-04-25

---

## Executive Summary

The design proposes a cross-device passkey enrollment flow that uses WebSocket-based key exchange to share a master key between devices. While the general approach is sound, there are **critical security vulnerabilities** in the current design that could allow an attacker to register their own passkey and gain access to the user's encrypted data.

---

## Critical Security Issues

### 1. Man-in-the-Middle Attack via Malicious Server

**Severity: Critical**

The server acts as a relay between Machine A and Machine B. Since there's no end-to-end authentication of the public key, a compromised server (or malicious insider) can:

1. Receive Mb's public key
2. Substitute its own public key when forwarding to Ma
3. Receive the encrypted master key from Ma (encrypted to attacker's key)
4. Decrypt the master key
5. Re-encrypt with Mb's actual public key and forward

**Impact:** Complete compromise of the master key.

**Recommendation:** Implement a verification step where Machine A displays a fingerprint of the received public key that the user must verify matches what Machine B displays. Alternatively, use a PAKE (Password-Authenticated Key Exchange) protocol where the enrollment code serves as the shared secret.

### 2. Unauthenticated Machine B Enables Code-Based Attacks

**Severity: Critical**

Machine B is completely unauthenticated. Anyone who obtains or guesses the 6-character code can:

1. Connect to the WebSocket endpoint
2. Send their own public key
3. Receive the encrypted master key
4. Decrypt it with their private key
5. Register their own passkey via the `/begin` and `/complete` endpoints

**Attack vectors:**
- Shoulder surfing the code
- Social engineering ("What's that code on your screen?")
- Brute forcing (discussed below)
- Network interception if code is transmitted

**Recommendation:** Require Ma to confirm on-screen when Mb connects, showing some identifier. Better: use a cryptographic binding like SRP or SPAKE2 where the code is used as a password.

### 3. Insufficient Code Entropy

**Severity: High**

A 6-character alphanumeric code (assuming A-Z0-9) provides only ~31 bits of entropy (36^6 = ~2.2 billion combinations). With a 5-minute window:

- At 100 requests/second: 30,000 attempts possible
- At 1,000 requests/second: 300,000 attempts possible

Without rate limiting, an attacker who knows a user is enrolling could have a non-trivial chance of guessing the code.

**Recommendation:**
- Implement aggressive rate limiting per IP and globally
- Use longer codes (8-10 characters) or include lowercase letters
- Add exponential backoff after failed attempts
- Consider requiring case-sensitive codes

### 4. Race Condition on WebSocket Connection

**Severity: High**

The spec states "Only two connections allowed per code" but doesn't define:
- What happens if an attacker connects before the legitimate Machine B?
- How does the server distinguish between Ma and Mb?
- Can an attacker lock out the legitimate user?

**Recommendation:** Define explicit connection ordering - Ma must connect first (verified by JWT), and only then accept Mb's connection. Include mechanism to reject/reset if wrong party connects.

### 5. No Cryptographic Binding Between Enrollment and Credential

**Severity: Medium**

The enrollment code is used to look up the user for credential creation, but there's no cryptographic proof that the credential being registered is from the same session that received the master key.

A sophisticated attacker could potentially:
1. Intercept the encrypted master key
2. Fail to complete enrollment
3. Later, when a new enrollment starts, complete registration with a credential bound to the intercepted key

**Recommendation:** Include a session-specific challenge in the WebSocket exchange that must be signed by the new credential during registration.

---

## Design Flaws

### 6. WebAuthn PRF Extension Support

**Severity: High**

WebAuthn PRF extension is not universally supported. The document doesn't address:
- What happens if Machine A's passkey doesn't support PRF?
- What happens if Machine B's new passkey doesn't support PRF?
- How to detect PRF support before starting the flow?

**Recommendation:** Add explicit checks for PRF support. Define fallback behavior or clear error messaging. Consider requiring PRF support as a prerequisite for using this feature.

### 7. No Rate Limiting Specification

**Severity: Medium**

The document doesn't specify rate limiting for:
- Enrollment code creation (`POST /api/v1/auth/passkeys/enrollment`)
- WebSocket connection attempts
- Code validation attempts
- `/begin` and `/complete` endpoint calls

**Recommendation:** Define explicit rate limits for all enrollment-related endpoints. Consider per-user, per-IP, and global limits.

### 8. Master Key Exposed in Browser Memory

**Severity: Medium**

The master key exists in plaintext in browser memory on Machine A during the re-encryption step. This is vulnerable to:
- Browser extensions
- XSS attacks (if any exist)
- Memory inspection attacks
- Browser vulnerabilities

**Recommendation:** Acknowledge this limitation in the security model. Ensure strict CSP policies. Consider whether the decryption/re-encryption could happen in a Web Worker for slight isolation.

### 9. Incomplete State Machine for WebSocket

**Severity: Medium**

The document doesn't define:
- Handling of disconnections mid-flow
- Timeout behavior for idle connections
- Recovery after partial completion
- What happens if Ma disconnects after sending encrypted key but before Mb completes

**Recommendation:** Define explicit state machine with all transitions, timeouts, and error handling.

### 10. Schema: Ambiguous Completion Status

**Severity: Low**

The `completed` boolean doesn't distinguish between:
- Successfully completed
- Expired
- Cancelled by user
- Failed due to error

**Recommendation:** Use an enum status field: `pending`, `completed`, `expired`, `cancelled`, `failed`.

---

## Missing Considerations

### 11. Audit Logging

No mention of security audit logging for:
- Enrollment creation
- WebSocket connections (with source IPs)
- Failed attempts
- Successful completions

**Recommendation:** Define comprehensive audit logging requirements.

### 12. Concurrent Enrollment Prevention

What happens if a user starts multiple enrollments simultaneously? Can this be exploited?

**Recommendation:** Either prevent concurrent enrollments or define explicit behavior.

### 13. Legacy Credential Migration

For users with existing passkeys (NULL `encrypted_master_key`):
- How do they generate and set up a master key?
- What features are unavailable to them?

**Recommendation:** Define migration flow for legacy credentials.

### 14. Forward Secrecy

If WebSocket traffic is logged and the ephemeral X25519 private key is later compromised, historical exchanges could be decrypted.

**Recommendation:** Document this limitation. Consider whether this is acceptable given the threat model.

---

## Suggested Protocol Improvements

### Option A: PAKE-Based Exchange

Use the 6-character code as input to a PAKE protocol (SPAKE2, OPAQUE, or SRP):

1. Both parties derive a shared secret from the code
2. Channel is end-to-end encrypted, server cannot MITM
3. Wrong code results in authentication failure, not silent success

### Option B: Visual Verification

1. Mb generates key pair, derives a 4-word fingerprint (like Signal safety numbers)
2. Mb displays fingerprint on screen
3. Ma receives public key, derives same fingerprint, displays it
4. User verbally/visually confirms both match before proceeding
5. Ma only sends encrypted master key after user confirmation

### Option C: QR Code Direct Exchange

1. Ma generates a QR code containing:
   - Enrollment code
   - Ma's own ephemeral public key
   - HMAC over Ma's public key using enrollment code as key
2. Mb scans QR code, verifies HMAC, uses Ma's public key for direct encryption
3. Avoids server relay entirely for the key material

---

## Summary Table

| Issue | Severity | Category |
|-------|----------|----------|
| MITM via server | Critical | Security |
| Unauthenticated Machine B | Critical | Security |
| Insufficient code entropy | High | Security |
| WebSocket race condition | High | Security |
| PRF support not addressed | High | Design |
| No enrollment-credential binding | Medium | Security |
| No rate limiting spec | Medium | Security |
| Master key in memory | Medium | Security |
| Incomplete WebSocket state machine | Medium | Design |
| Ambiguous completion status | Low | Design |

---

## Recommendation

**Do not proceed with implementation** until the Critical severity issues are addressed. The current design allows an attacker with knowledge of the enrollment code to register their own passkey and gain full access to the user's encrypted data.

At minimum, implement Option B (Visual Verification) to prevent server-side MITM and provide user confirmation of the correct device receiving the key. Consider Option A (PAKE) for the strongest security guarantees.
