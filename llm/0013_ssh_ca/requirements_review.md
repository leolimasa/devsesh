# Requirements Review: SSH CA with FROST Threshold Signatures

## Overview

The proposal describes an SSH Certificate Authority using FROST (Flexible Round-Optimized Schnorr Threshold) signatures, where the CA private key is split between the server and client. This is a compelling approach that avoids single points of compromise for the CA key.

---

## Security Analysis

### Strengths

1. **No Single Point of Compromise for CA Key**: The threshold signature design means neither the server nor client alone can sign certificates. An attacker must compromise both to forge certificates.

2. **Short-Lived Certificates (1 minute)**: Excellent choice. Minimizes the window of opportunity if a certificate is somehow leaked. Also eliminates need for revocation infrastructure.

3. **WebWorker Isolation**: Keeping the client share in a WebWorker with no main thread access provides defense-in-depth against XSS attacks. Even if the main application is compromised, the share cannot be directly exfiltrated.

4. **Time-Limited WebWorker (30 minutes)**: Reduces exposure window. After timeout, re-authentication is required.

5. **WebAuthn PRF for Master Key**: Hardware-backed authentication with PRF extension is a strong approach for deriving encryption keys.

### Concerns & Questions

#### 1. FROST Algorithm Variant and Parameters

The document doesn't specify:
- Which FROST variant (FROST-Ed25519, FROST-secp256k1, etc.)? SSH certificates typically use Ed25519.
- What is the threshold? The document implies 2-of-2 (both server and client required), which should be explicit.
- What library/implementation will be used? FROST is relatively new and implementations vary in maturity.

**Recommendation**: Specify the exact FROST variant, threshold parameters (t-of-n), and implementation library. Consider FROST-Ed25519 for SSH compatibility.

#### 2. Share Generation and Distribution

> "The threshold signatures will be created every time a user is created, along with the public certificate."

This implies key generation happens on the server. Questions:
- How is the client's share securely transmitted to be encrypted and stored?
- Is Distributed Key Generation (DKG) used, or does the server generate all shares?
- If the server generates all shares, it momentarily has access to the full private key, which undermines the security model.

**Recommendation**: Use FROST-DKG (distributed key generation) where neither party ever sees the complete key. The server should never possess the client's share in unencrypted form.

#### 3. Client Share Storage Location

> "The client's share will also be stored in the database, but encrypted with the master key."

Since the master key is derived from WebAuthn PRF (hardware-backed, not a password), offline brute-force attacks against the encrypted share are not feasible. The PRF output is cryptographically random and requires the physical authenticator to derive.

Storing the encrypted share server-side is actually convenient - it allows the user to access their share from any browser with their authenticator, rather than being tied to a specific browser's localStorage.

#### 4. Master Key Derivation Details

Questions:
- What key derivation function is used after WebAuthn PRF output?
- Is the PRF output stretched (e.g., with HKDF)?
- Is the encryption authenticated (AEAD)?

**Recommendation**: Specify the encryption scheme (e.g., XChaCha20-Poly1305 or AES-256-GCM) and key derivation path from PRF output.

#### 5. WebWorker API Security

> "The webworker will expose an api for signing requests."

The WebWorker API is a critical attack surface. Concerns:
- What prevents the main thread from requesting signatures for arbitrary certificates?
- Is there any rate limiting or validation within the WebWorker?
- How does the WebWorker verify it's signing a legitimate certificate request?

**Recommendation**: The WebWorker should implement validation logic (e.g., certificate principal must match authenticated user, validity period constraints). Don't rely solely on the main thread or server for validation.

#### 6. Server-Side Share Protection

> "The server will store its share in the database."

In a 2-of-2 threshold scheme, the server share alone is cryptographically useless - an attacker cannot forge signatures without the client share. Since the client share requires the physical WebAuthn authenticator to decrypt, a database breach does not compromise the CA.

No additional encryption of the server share is necessary; the threshold property provides the protection.

#### 7. Certificate Content Validation

Not addressed:
- What principals can be included in certificates?
- What extensions/options are permitted?
- Who validates that the user should have access to the requested principal?

**Recommendation**: Add explicit validation rules. The server should validate that the user is authorized for the requested certificate parameters before participating in the signing protocol.

#### 8. Replay and Race Conditions

- Can a signing request be replayed?
- What happens if multiple WebWorkers/tabs are opened?
- How are concurrent signing requests handled?

**Recommendation**: Include nonces in the signing protocol. Define behavior for multi-tab scenarios.

#### 9. Recovery and Rotation

Not addressed:
- How are shares rotated if compromise is suspected?
- What happens if the client loses access (device lost, WebAuthn credential deleted)?
- Is there a recovery mechanism?

**Recommendation**: Define share rotation procedure and recovery flows. Consider whether the CA keypair can be re-generated without affecting trust anchors on target machines.

---

## Design Strategy Analysis

### Architecture Clarity

The document provides a good high-level vision but needs more detail in several areas:

1. **Protocol Flow**: A sequence diagram showing the exact message flow during certificate signing would clarify the design.

2. **Trust Boundaries**: Explicitly define what each component trusts and doesn't trust (server, main thread, WebWorker, WASM module).

3. **Failure Modes**: What happens when:
   - WebWorker times out mid-connection?
   - Server is unreachable?
   - FROST protocol fails (network partition during signing)?

### Implementation Complexity

FROST is a complex protocol. Consider:
- **Testing Strategy**: How will the cryptographic implementation be validated?
- **Fallback Mechanism**: Is there a degraded mode of operation?
- **Audit Scope**: This is security-critical code that should be audited.

### Missing Details

1. **SSH Certificate Fields**: What user principal, validity period, and extensions will certificates contain?

2. **Host Certificate Support**: The document only mentions user authentication. Will the CA also sign host certificates?

3. **Audit Logging**: Certificate issuance should be logged for security monitoring.

4. **Rate Limiting**: Prevent abuse of certificate generation.

---

## Recommended Additions to Requirements

1. Specify FROST variant, threshold parameters, and implementation library
2. Define DKG protocol for initial share generation
3. Add validation rules for certificate content
4. Define WebWorker API with security constraints
5. Specify encryption scheme for client share
6. Add audit logging requirements
7. Define rate limiting requirements
8. Document recovery/rotation procedures
9. Add sequence diagrams for key flows

---

## Summary

The core concept is sound and addresses real security concerns about CA key management. The combination of threshold signatures, short-lived certificates, and WebAuthn-protected client shares is a strong design pattern.

The main gaps are:
1. **Key generation model** - needs DKG to maintain the security properties
2. **Validation logic** - who ensures certificates are issued appropriately
3. **Protocol details** - specific algorithms, message formats, error handling

These should be addressed before implementation to ensure the security properties claimed are actually achieved.
