# Objective

Allow adding a new passkey to an existing user. Allow encrypting a user's master key using each passkey's PRF (multi recipient encryption).

This is needed so that clients can safely store encrypted data on the server. If the server is compromised, the data cannot be decrypted without the user's passkeys.

# Flow

- User opens browser on machine B (Mb) and navigates to the `Register passkey page`
- Mb creates a new `passkey_enrollment` and displays the 8-character code on screen (formatted as XXXX-XXXX)
- User is informed to stay on the page until the process is complete
- User on machine A (Ma), already logged in, navigates to the `Add passkey page`
- User enters the enrollment code on Ma

A websocket connection is then established between Ma and Mb using the server as a proxy. When Ma connects with a valid JWT, the server links the enrollment to that user. The channel is secured using SPAKE2 (a PAKE protocol) with the enrollment code as the shared password. This ensures end-to-end encryption that the server cannot intercept.

**SPAKE2 Key Exchange:**
1. Both Ma and Mb derive SPAKE2 parameters from the enrollment code
2. Mb sends SPAKE2 message B (pB = w*N + Y) over WebSocket
3. Ma sends SPAKE2 message A (pA = w*M + X) over WebSocket
4. Both parties compute the shared secret K from the exchange
5. Both derive an encryption key from K using HKDF
6. All subsequent messages are encrypted with the derived key (AES-256-GCM)

**Encrypted Channel Communication:**
- Ma: Requests master key from server. Decrypts it using PRF-derived key. Encrypts it with the SPAKE2-derived session key and sends to Mb.
- Mb: Receives encrypted master key. Decrypts it with the session key. Then encrypts it again using its webauthn PRF.

Finally, Mb sends its webauthn credentials along with the encrypted master key and the `passkey_enrollment` code to the server so that it is registered accordingly.

**Security Properties:**
- The server only relays encrypted messages; it cannot decrypt them without knowing the enrollment code
- An attacker who doesn't know the code cannot participate in the key exchange (SPAKE2 will fail)
- Shoulder-surfing the code on Mb is useless without also having an authenticated session on Ma
- Brute-forcing the code requires both guessing the code AND being logged into the victim's account
- The 8-character code provides ~41 bits of entropy (36^8), which is sufficient given the authentication requirement on Ma

# Pages

## Add passkey page

This page is accessed by Machine A (the user who is already logged in and wants to add a new passkey from a different device).

**Requirements:**
* User must be authenticated with a valid JWT token [req.ebg0n8]
* Page displays an input field for the 8-character code (accepts with or without hyphen) [req.lnezjk]
* Page displays the url that should be visited on Machine B to generate a code [req.xg8m17]
* Page displays a warning: "Only enter codes from devices YOU control" [req.08hb37]
* "Link device" button to initiate the process [req.dk5jee]
* When code is submitted: [req.sm41hl]
  * Strips hyphen from input and validates format (8 alphanumeric characters) [req.40vbd1]
  * Initiates WebAuthn authentication to verify current user identity [req.iw7vre]
  * Uses WebAuthn PRF extension to derive the master key decryption key [req.eejh3t]
  * Opens WebSocket connection to `/api/v1/auth/passkeys/enrollment/{code}` with JWT token [req.jt9sgz]
  * Server links the enrollment to the authenticated user [req.g3ff0v]
* SPAKE2 handshake: [req.erqla1]
  * Derives SPAKE2 parameters from the enrollment code [req.smsrbz]
  * Receives SPAKE2 message B from Mb [req.kbqskn]
  * Sends SPAKE2 message A to Mb [req.11y9dp]
  * Computes shared secret and derives session encryption key [req.xuf7hi]
  * If SPAKE2 fails (wrong code), display error and allow retry [req.elmvhg]
* After SPAKE2 completes: [req.989f5h]
  * Requests encrypted master key from server [req.qjp17z]
  * Decrypts master key using PRF-derived key [req.36fdlg]
  * Encrypts master key with SPAKE2-derived session key (AES-256-GCM) [req.kx0axx]
  * Sends encrypted master key over WebSocket [req.1e8lhh]
* Shows success message when registration completes [req.tr1031]
* User can cancel the process at any time [req.naf7y6]

## Register passkey page

This page is accessed by Machine B (the user who wants to register a new passkey on a different device).

**Requirements:**
* Page is accessible without authentication (public route) [req.j5182j]
* Page displays a "Start" button to begin the process [req.vgsxxk]
* When clicked: [req.0czjkd]
  * Calls endpoint to create a new `passkey_enrollment` record [req.ofsosx]
  * Displays the 8-character alphanumeric code prominently on screen, formatted with hyphen (e.g., `A1B2-C3D4`) [req.wj9f9q]
  * Shows a status indicator ("Waiting for other device...") [req.bnv3m1]
  * Opens WebSocket connection to `/api/v1/auth/passkeys/enrollment/{code}` [req.zbesi6]
* Code expires after 5 minutes; page shows expiration countdown [req.5h2z1o]
* SPAKE2 handshake (when Ma connects): [req.weg5pl]
  * Derives SPAKE2 parameters from the enrollment code [req.b1kyz5]
  * Sends SPAKE2 message B to Ma [req.5b4xmi]
  * Receives SPAKE2 message A from Ma [req.fu4k2k]
  * Computes shared secret and derives session encryption key [req.i3gm0t]
* When encrypted master key is received: [req.mz1e0l]
  * Decrypts master key using SPAKE2-derived session key (AES-256-GCM) [req.otuasv]
  * Calls `POST /api/v1/auth/passkeys/enrollment/{code}/begin` to get credential creation options [req.5wwa85]
  * Initiates WebAuthn credential creation with PRF extension using the options [req.014tfk]
  * Encrypts master key using the new passkey's PRF-derived key [req.fwfejn]
  * Calls `POST /api/v1/auth/passkeys/enrollment/{code}/complete` with credential + encrypted master key [req.juesne]
* Shows success/error feedback [req.q9gwaf]
* On success, redirects to login page or dashboard [req.7z0811]
* User can cancel the process at any time [req.e11s51]

# Endpoints

## Create Passkey Enrollment
- **Endpoint:** `POST /api/v1/auth/passkeys/enrollment`
- **Authentication:** None (public route, called by Mb)
- **Description:** Create a new passkey enrollment code for cross-device passkey registration.
- **Response:**
```json
{
  "code": "A1B2C3D4"
}
```
- **Notes:**
  - Enrollment codes are 8 alphanumeric characters (A-Z, 0-9)
  - When displayed to user, format with hyphen: `A1B2-C3D4`
  - Codes expire in 5 minutes
  - Enrollment is not linked to a user until Ma connects with JWT

## Passkey Enrollment WebSocket
- **Endpoint:** `GET /api/v1/auth/passkeys/enrollment/{code}`
- **Description:** WebSocket endpoint for SPAKE2 key exchange and encrypted master key transfer between Machine A and Machine B.
- **Query Parameters:** `token` - JWT token (required for Machine A only)
- **Connection Order:** Mb connects first (no authentication). Ma connects second with JWT, which links the enrollment to the authenticated user.

**SPAKE2 Handshake Messages:**

- **Message Format (Machine B -> Machine A) - SPAKE2 Step 1:**
```json
{
  "type": "spake2_b",
  "message": "base64-encoded-spake2-message-B"
}
```

- **Message Format (Machine A -> Machine B) - SPAKE2 Step 2:**
```json
{
  "type": "spake2_a",
  "message": "base64-encoded-spake2-message-A"
}
```

**Encrypted Channel Messages (after SPAKE2 completes):**

- **Message Format (Machine A -> Machine B) - Encrypted Master Key:**
```json
{
  "type": "encrypted_payload",
  "nonce": "base64-encoded-nonce",
  "ciphertext": "base64-encoded-aes-gcm-ciphertext"
}
```

The `ciphertext` contains the master key encrypted with the SPAKE2-derived session key using AES-256-GCM.

- **Message Format (Machine B -> Machine A) - Confirmation:**
```json
{
  "type": "encrypted_payload",
  "nonce": "base64-encoded-nonce",
  "ciphertext": "base64-encoded-aes-gcm-ciphertext"
}
```

The `ciphertext` contains `{"status": "received"}` to confirm successful decryption.

- **Notes:**
  * Only two connections allowed per code (one for each machine) [req.trer79]
  * Mb connects first; Ma connects second with JWT [req.np0vt2]
  * When Ma connects, server links the enrollment to Ma's user account [req.d7zh06]
  * Server rejects Ma connection if Mb not present (enrollment must be waiting) [req.o16rm6]
  * If SPAKE2 verification fails on either side, connection is terminated [req.5yd9a7]
  * All messages after SPAKE2 are encrypted; server cannot read them [req.a0z799]

## Passkey Enrollment Begin
- **Endpoint:** `POST /api/v1/auth/passkeys/enrollment/{code}/begin`
- **Description:** Get WebAuthn credential creation options for the enrollment (called from Machine B).
- **Response:** WebAuthn credential creation options (PublicKeyCredentialCreationOptions)
- **Notes:** The server uses the enrollment code to look up the user and generate appropriate options.

## Passkey Enrollment Complete
- **Endpoint:** `POST /api/v1/auth/passkeys/enrollment/{code}/complete`
- **Description:** Complete the passkey registration (called from Machine B).
- **Request Body:**
```json
{
  "credential": {
    "id": "credential-id",
    "rawId": "base64-encoded-raw-id",
    "response": {
      "attestationObject": "base64-encoded-attestation-object",
      "clientDataJSON": "base64-encoded-client-data"
    },
    "type": "public-key"
  },
  "encrypted_master_key": "base64-encoded-encrypted-key"
}
```
- **Response:** HTTP 201 Created on success

## Get Encrypted Master Key
- **Endpoint:** `GET /api/v1/auth/master-key`
- **Authentication:** Requires JWT token
- **Description:** Get the encrypted master key for the current user's passkey.
- **Response:**
```json
{
  "encrypted_master_key": "base64-encoded-encrypted-key"
}
```

## Register - Finish (modified)
- **Endpoint:** `POST /api/v1/auth/register/finish`
- **Description:** Complete WebAuthn registration flow (existing endpoint, modified behavior).
- **Changes:**
  * Client must use WebAuthn PRF extension during credential creation [req.qhyidm]
  * Client generates a new random master key (256-bit) [req.hmhedi]
  * Client encrypts the master key using the PRF-derived key [req.9vhwsv]
  * Client sends the encrypted master key along with the credential [req.wemf9m]
- **Request Body:**
```json
{
  "email": "user@example.com",
  "credential": {
    "id": "credential-id",
    "rawId": "base64-encoded-raw-id",
    "response": {
      "attestationObject": "base64-encoded-attestation-object",
      "clientDataJSON": "base64-encoded-client-data"
    },
    "type": "public-key"
  },
  "encrypted_master_key": "base64-encoded-encrypted-key"
}
```
- **Response:** HTTP 201 Created on success
- **Notes:** The encrypted master key is stored in the `webauthn_credentials` table alongside the new credential.

# Cryptography Implementation

**Use existing, audited cryptographic libraries. Do not implement cryptographic primitives from scratch.**

## Required Libraries

### TypeScript (Browser)

| Component    | Recommended Library              | Notes                            |
|--------------|----------------------------------|----------------------------------|
| SPAKE2       | Custom implementation (see below) | No audited JS library exists    |
| AES-256-GCM  | Web Crypto API (`crypto.subtle`) | Built-in, no dependencies needed |
| HKDF         | Web Crypto API (`crypto.subtle`) | Built-in, no dependencies needed |
| Random bytes | `crypto.getRandomValues()`       | Built-in, for nonces and codes   |

### SPAKE2 Implementation Strategy

There is no well-maintained, audited SPAKE2 library for JavaScript. Build a SPAKE2 Typescript implementation:

* Use `@noble/curves`, which is audited and provides elliptic curve primitives [req.dwfami]
* Implement SPAKE2 following [RFC 9382](https://www.rfc-editor.org/rfc/rfc9382.html) [req.43fwpo]
* Use `hash-to-curve` (RFC 9380) for deriving M and N points [req.a71c6e]
* Requires careful implementation and review [req.lkx4qh]

### Go (Server)

| Component    | Recommended Library | Notes                              |
|--------------|---------------------|------------------------------------|
| Random bytes | `crypto/rand`       | For generating enrollment codes    |

The server does not participate in SPAKE2 or decrypt any messages. It only:
- Generates enrollment codes
- Relays WebSocket messages between Ma and Mb
- Stores the final encrypted master key (which it cannot decrypt)

## Guidelines

- **No custom primitives**: Never implement AES, elliptic curve math, or hash functions manually. Use audited libraries for all primitives.
- **SPAKE2 exception**: Protocol-level SPAKE2 implementation using `@noble/curves` primitives is acceptable since no audited SPAKE2 library exists. The implementation must be reviewed.
- **Constant-time comparisons**: Use library-provided functions for comparing secrets/MACs
- **Secure random**: Always use cryptographically secure random number generators
- **Key derivation**: Use HKDF to derive the AES key from SPAKE2 output; never use raw shared secret directly
- **Nonce handling**: Generate a fresh random nonce for each AES-GCM encryption; never reuse nonces
- **Memory handling**: Clear sensitive key material from memory when no longer needed (where language permits)

## SPAKE2 Parameters

Use standard SPAKE2 parameters (M and N points) from the library defaults. Derive the password input from the enrollment code using a consistent encoding (UTF-8, uppercase, no hyphens).

# Schema changes

## passkey_enrollments

Stores pending passkey registration requests for cross-device passkey addition.

| Column     | Type     | Constraints                         |
|------------|----------|-------------------------------------|
| code       | TEXT(8)  | PRIMARY KEY                         |
| user_id    | INTEGER  | NULL, FOREIGN KEY -> users(id)      |
| expires_at | DATETIME | NOT NULL                            |
| completed  | BOOLEAN  | NOT NULL, DEFAULT FALSE             |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

**Notes:**
- Code is 8 alphanumeric characters (A-Z, 0-9), stored without hyphen
- user_id is NULL when created by Mb; set when Ma connects with JWT
- Provides ~41 bits of entropy, sufficient since exploiting requires authenticated access on Ma

## webauthn_credentials (modified)

Add new column to store the encrypted master key for each passkey:

| Column               | Type | Constraints |
|----------------------|------|-------------|
| encrypted_master_key | BLOB | NULL        |

**Notes:**
- The encrypted_master_key is NULL for legacy credentials created before this feature
- Each passkey stores the master key encrypted with that specific passkey's PRF-derived key
- This enables multi-recipient encryption where any passkey can decrypt the master key
