# Passkey Encryption Implementation Checklist

## Phase 1: Database Schema & Migrations

- [ ] Create migration `sql/00010_create_passkey_enrollments_table.sql` for `passkey_enrollments` table
- [ ] Create migration `sql/00011_add_encrypted_master_key.sql` to add `encrypted_master_key` column to `webauthn_credentials`
- [ ] Add `PasskeyEnrollment` struct to `internal/db/queries.go`
- [ ] Add `EncryptedMasterKey` field to `WebAuthnCredential` struct in `internal/db/queries.go`
- [ ] Implement `CreatePasskeyEnrollment(db, code, expiresAt)` [req.ofsosx]
- [ ] Implement `GetPasskeyEnrollment(db, code)` to fetch enrollment by code
- [ ] Implement `LinkEnrollmentToUser(db, code, userID)` [req.d7zh06]
- [ ] Implement `CompleteEnrollment(db, code)` to mark enrollment as completed
- [ ] Implement `SaveCredentialWithMasterKey(db, cred, encryptedMasterKey)`
- [ ] Implement `GetCredentialWithMasterKey(db, userID)` to fetch credential with encrypted master key
- [ ] Modify `SaveCredential` to support optional `encrypted_master_key`
- [ ] Modify `GetCredentialsByUserID` to include `encrypted_master_key` field

**Testing:**
- [ ] Run migrations: `go run ./cmd/devsesh migrate`
- [ ] Verify tables exist: `sqlite3 <db_path> ".schema passkey_enrollments"` and `sqlite3 <db_path> ".schema webauthn_credentials"`
- [ ] Write unit tests for new database functions in `internal/db/queries_test.go`

---

## Phase 2: Backend Enrollment Endpoints

- [ ] Create `internal/auth/enrollment.go` with:
  - [ ] `generateEnrollmentCode()` - Generate 8-character alphanumeric code [req.ofsosx]
  - [ ] `CreateEnrollmentHandler(db)` - POST `/api/v1/auth/passkeys/enrollment` [req.ofsosx, req.j5182j, req.5h2z1o]
  - [ ] `EnrollmentBeginHandler(db, wa, cs)` - POST `/api/v1/auth/passkeys/enrollment/{code}/begin` [req.5wwa85]
  - [ ] `EnrollmentCompleteHandler(db, wa, cs)` - POST `/api/v1/auth/passkeys/enrollment/{code}/complete` [req.juesne]
  - [ ] `GetMasterKeyHandler(db)` - GET `/api/v1/auth/master-key` [req.qjp17z]
- [ ] Modify `RegisterFinishHandler` in `internal/auth/webauthn.go` to accept and store `encrypted_master_key` [req.qhyidm, req.hmhedi, req.9vhwsv, req.wemf9m]
- [ ] Register new routes in `internal/server/server.go`:
  - [ ] `POST /api/v1/auth/passkeys/enrollment`
  - [ ] `POST /api/v1/auth/passkeys/enrollment/{code}/begin`
  - [ ] `POST /api/v1/auth/passkeys/enrollment/{code}/complete`
  - [ ] `GET /api/v1/auth/master-key`

**Testing:**
- [ ] Test enrollment code generation (check format, uniqueness, entropy)
- [ ] Test `POST /api/v1/auth/passkeys/enrollment` returns valid code
- [ ] Test enrollment expiry (5 minutes) [req.5h2z1o]
- [ ] Test `GET /api/v1/auth/master-key` requires authentication
- [ ] Write integration tests for enrollment endpoints

---

## Phase 3: Backend WebSocket Handler

- [ ] Create `internal/auth/enrollment_ws.go` with:
  - [ ] `enrollmentClient` struct for WebSocket client
  - [ ] `enrollmentPair` struct for Machine A/B pair
  - [ ] `EnrollmentHub` struct for managing enrollment connections
  - [ ] `NewEnrollmentHub()` constructor
  - [ ] `EnrollmentWebSocketHandler(db, hub, jwtSecret)` [req.trer79, req.np0vt2]
    - [ ] Handle Machine B connection (no JWT) [req.zbesi6]
    - [ ] Handle Machine A connection (with JWT) [req.jt9sgz]
    - [ ] Validate Machine B connected before allowing Machine A [req.o16rm6]
    - [ ] Link enrollment to user when Machine A connects [req.g3ff0v]
    - [ ] Limit to two connections per code [req.trer79]
    - [ ] Relay messages between machines [req.a0z799]
    - [ ] Terminate connection on verification failure [req.5yd9a7]
  - [ ] Message read/write pumps
  - [ ] Cleanup on disconnect
- [ ] Add `EnrollmentHub` to `Server` struct in `internal/server/server.go`
- [ ] Register WebSocket route: `GET /api/v1/auth/passkeys/enrollment/{code}`

**Testing:**
- [ ] Test WebSocket connection as Machine B (no token)
- [ ] Test WebSocket connection as Machine A (with token)
- [ ] Test Machine A rejected if Machine B not connected [req.o16rm6]
- [ ] Test message relay between machines
- [ ] Test connection cleanup on disconnect
- [ ] Write integration tests for WebSocket enrollment

---

## Phase 4: Frontend Crypto Utilities

- [ ] Install `@noble/curves` dependency: `npm install @noble/curves`
- [ ] Create `web/src/lib/crypto/spake2.ts` [req.dwfami, req.43fwpo, req.a71c6e, req.lkx4qh]:
  - [ ] `deriveSpake2Params(password: string)` - Derive M and N points [req.smsrbz, req.b1kyz5]
  - [ ] `spake2Init(password: string, isPartyA: boolean)` - Initialize SPAKE2 state
  - [ ] `spake2Finish(state, otherPublicElement)` - Compute shared secret [req.xuf7hi, req.i3gm0t]
  - [ ] Export `Spake2State` and `Spake2Result` types
- [ ] Create `web/src/lib/crypto/aes.ts`:
  - [ ] `encrypt(key, plaintext)` - AES-256-GCM encryption [req.kx0axx]
  - [ ] `decrypt(key, nonce, ciphertext)` - AES-256-GCM decryption [req.otuasv]
  - [ ] `deriveKey(sharedSecret, info)` - HKDF key derivation
- [ ] Create `web/src/lib/crypto/prf.ts`:
  - [ ] `getPrfSalt()` - Return fixed PRF salt
  - [ ] `deriveMasterKeyFromPrf(prfOutput)` - Derive encryption key from PRF [req.eejh3t]
  - [ ] `generateMasterKey()` - Generate random 256-bit master key [req.hmhedi]

**Testing:**
- [ ] Write unit tests for SPAKE2 (test both parties derive same secret)
- [ ] Write unit tests for AES-256-GCM (encrypt/decrypt roundtrip)
- [ ] Write unit tests for HKDF key derivation
- [ ] Write unit tests for PRF helpers
- [ ] Run: `npm test` in `web/` directory

---

## Phase 5: Frontend API Functions

- [ ] Add types to `web/src/types/api.ts`:
  - [ ] `PasskeyEnrollment` interface
  - [ ] `EnrollmentMessage` interface
- [ ] Add functions to `web/src/lib/api.ts`:
  - [ ] `createPasskeyEnrollment()` [req.ofsosx]
  - [ ] `enrollmentBegin(code)` [req.5wwa85]
  - [ ] `enrollmentComplete(code, credential, encryptedMasterKey)` [req.juesne]
  - [ ] `getMasterKey()` [req.qjp17z]
  - [ ] `getEnrollmentWebSocketURL(code, token?)`
- [ ] Modify `registerFinish()` to include `encrypted_master_key` parameter [req.wemf9m]

**Testing:**
- [ ] Verify API function types are correct
- [ ] Test API calls against running server (manual or integration test)

---

## Phase 6: Modify Registration Page

- [ ] Modify `web/src/pages/RegisterPage.tsx` [req.qhyidm]:
  - [ ] Enable WebAuthn PRF extension in credential creation options
  - [ ] Generate random master key on registration [req.hmhedi]
  - [ ] Encrypt master key with PRF-derived key [req.9vhwsv]
  - [ ] Pass `encrypted_master_key` to `registerFinish()` [req.wemf9m]

**Testing:**
- [ ] Register a new user with passkey
- [ ] Verify credential stored with encrypted_master_key in database
- [ ] Verify PRF extension is enabled in WebAuthn request

---

## Phase 7: Add Passkey Page (Machine A)

- [ ] Create `web/src/pages/AddPasskeyPage.tsx` [req.ebg0n8]:
  - [ ] Input field for 8-character code (accepts with/without hyphen) [req.lnezjk]
  - [ ] Display URL for Machine B [req.xg8m17]
  - [ ] Warning message about device control [req.08hb37]
  - [ ] "Link device" button [req.dk5jee]
  - [ ] Status indicators during process
  - [ ] Success/error messages [req.tr1031]
  - [ ] Cancel button [req.naf7y6]
  - [ ] Implement `handleSubmit()` [req.sm41hl, req.erqla1]:
    - [ ] Strip hyphen and validate format [req.40vbd1]
    - [ ] WebAuthn authentication with PRF extension [req.iw7vre, req.eejh3t]
    - [ ] Open WebSocket with JWT [req.jt9sgz]
    - [ ] Derive SPAKE2 parameters [req.smsrbz]
    - [ ] Receive SPAKE2 message B [req.kbqskn]
    - [ ] Send SPAKE2 message A [req.11y9dp]
    - [ ] Derive session key [req.xuf7hi]
    - [ ] Handle SPAKE2 failure with retry [req.elmvhg]
  - [ ] Implement `handleMasterKeyTransfer()` [req.989f5h]:
    - [ ] Fetch encrypted master key [req.qjp17z]
    - [ ] Decrypt with PRF-derived key [req.36fdlg]
    - [ ] Re-encrypt with session key [req.kx0axx]
    - [ ] Send over WebSocket [req.1e8lhh]
    - [ ] Wait for confirmation
    - [ ] Show success [req.tr1031]
- [ ] Add route to `web/src/App.tsx`: `/passkeys/add` (protected)
- [ ] Add "Add passkey from another device" button to `web/src/pages/PasskeyManagementPage.tsx`

**Testing:**
- [ ] Test code input validation
- [ ] Test WebSocket connection establishment
- [ ] Test error handling for invalid/expired codes
- [ ] Test cancel functionality

---

## Phase 8: Register Passkey Page (Machine B)

- [ ] Create `web/src/pages/RegisterPasskeyPage.tsx` [req.j5182j]:
  - [ ] "Start" button to begin enrollment [req.vgsxxk]
  - [ ] Display code prominently (XXXX-XXXX format) [req.wj9f9q]
  - [ ] Status indicator ("Waiting for other device...") [req.bnv3m1]
  - [ ] Expiration countdown (5 minutes) [req.5h2z1o]
  - [ ] Success/error feedback [req.q9gwaf]
  - [ ] Cancel button [req.e11s51]
  - [ ] Implement `handleStart()` [req.0czjkd]:
    - [ ] Call `createPasskeyEnrollment()` [req.ofsosx]
    - [ ] Display formatted code [req.wj9f9q]
    - [ ] Start countdown [req.5h2z1o]
    - [ ] Open WebSocket (no token) [req.zbesi6]
    - [ ] Initialize SPAKE2 as party B [req.b1kyz5]
    - [ ] Send SPAKE2 message B [req.5b4xmi]
  - [ ] Implement `handleHandshake()` [req.weg5pl]:
    - [ ] Receive SPAKE2 message A [req.fu4k2k]
    - [ ] Derive session key [req.i3gm0t]
  - [ ] Implement `handleMasterKeyReceived()` [req.mz1e0l]:
    - [ ] Decrypt with session key [req.otuasv]
    - [ ] Get credential options [req.5wwa85]
    - [ ] WebAuthn credential creation with PRF [req.014tfk]
    - [ ] Encrypt master key with new PRF [req.fwfejn]
    - [ ] Complete enrollment [req.juesne]
    - [ ] Send confirmation
    - [ ] Redirect to login [req.7z0811]
- [ ] Add route to `web/src/App.tsx`: `/passkeys/enroll` (public)

**Testing:**
- [ ] Test enrollment code generation and display
- [ ] Test countdown timer
- [ ] Test WebSocket connection as Machine B
- [ ] Test full enrollment flow with Machine A
- [ ] Test redirect on success

---

## Phase 9: Integration Tests

Create Playwright integration tests in `integration_tests/tests/enrollment/` following existing patterns (see `integration_tests/tests/auth/` for examples).

**Setup:**
- [ ] Create `integration_tests/tests/enrollment/` directory
- [ ] Create `integration_tests/helpers/enrollment.ts` with helper functions for enrollment flow

**File: `integration_tests/tests/enrollment/cross-device.spec.ts`**

```typescript
test.describe('Cross-Device Passkey Enrollment', () => { ... })
```

- [ ] Test: `Machine B can create enrollment and display code`
  - Start server, navigate to `/passkeys/enroll`
  - Click "Start" button [req.vgsxxk]
  - Verify code is displayed in XXXX-XXXX format [req.wj9f9q]
  - Verify "Waiting for other device..." status [req.bnv3m1]
  - Verify countdown timer is visible [req.5h2z1o]

- [ ] Test: `Machine A can enter code and connect`
  - Register user, login, navigate to `/passkeys/add`
  - Setup virtual WebAuthn authenticator
  - Verify warning message is displayed [req.08hb37]
  - Verify URL for Machine B is shown [req.xg8m17]
  - Enter enrollment code [req.lnezjk]
  - Click "Link device" button [req.dk5jee]
  - Verify WebAuthn authentication is triggered [req.iw7vre]

- [ ] Test: `Complete enrollment flow with two browser contexts`
  - Use two Playwright browser contexts (Machine A and Machine B)
  - Machine B: Create enrollment, get code
  - Machine A: Login, enter code, trigger WebAuthn with PRF [req.eejh3t]
  - Verify SPAKE2 handshake completes [req.erqla1]
  - Machine B: Verify WebAuthn credential creation triggered [req.014tfk]
  - Verify enrollment completes successfully [req.juesne]
  - Machine B: Verify redirect to login [req.7z0811]

- [ ] Test: `New passkey can authenticate after enrollment`
  - Complete enrollment flow
  - Clear Machine B localStorage
  - Login with newly enrolled passkey
  - Verify successful authentication

- [ ] Test: `Enrollment fails with expired code`
  - Create enrollment, wait for expiry (mock time or use short timeout)
  - Try to connect from Machine A
  - Verify error is displayed [req.elmvhg]

- [ ] Test: `Enrollment fails with invalid code format`
  - Login, navigate to `/passkeys/add`
  - Enter invalid code (wrong length, special chars)
  - Verify validation error [req.40vbd1]

- [ ] Test: `Machine A rejected if Machine B not connected` [req.o16rm6]
  - Create enrollment code via API
  - Try to connect from Machine A without Machine B connected
  - Verify connection rejected

- [ ] Test: `Cancel button works on both pages`
  - Test cancel on Machine B page [req.e11s51]
  - Test cancel on Machine A page [req.naf7y6]
  - Verify WebSocket connections are cleaned up

- [ ] Test: `Only two connections allowed per code` [req.trer79]
  - Connect Machine B
  - Connect Machine A
  - Try to connect third client
  - Verify third connection rejected

**File: `integration_tests/tests/enrollment/registration-with-masterkey.spec.ts`**

```typescript
test.describe('Registration with Master Key', () => { ... })
```

- [ ] Test: `Registration stores encrypted master key`
  - Setup virtual WebAuthn authenticator
  - Register new user [req.qhyidm]
  - Verify credential created with PRF extension
  - Query database: verify `encrypted_master_key` is not NULL

- [ ] Test: `Master key endpoint returns encrypted key` [req.qjp17z]
  - Register user, login
  - Call `GET /api/v1/auth/master-key`
  - Verify response contains `encrypted_master_key`

**File: `integration_tests/tests/enrollment/security.spec.ts`**

```typescript
test.describe('Enrollment Security', () => { ... })
```

- [ ] Test: `Server cannot read encrypted messages` [req.a0z799]
  - Intercept WebSocket messages on server
  - Verify messages after SPAKE2 are encrypted (not readable JSON)

- [ ] Test: `SPAKE2 fails with wrong enrollment code`
  - Machine B creates enrollment with code X
  - Machine A tries to connect using code Y
  - Verify key derivation fails, connection terminated [req.5yd9a7]

- [ ] Test: `Enrollment requires authenticated Machine A`
  - Create enrollment from Machine B
  - Try to connect without JWT
  - Verify connection rejected

- [ ] Test: `Enrollment codes have sufficient entropy`
  - Generate 1000 enrollment codes
  - Verify all unique, all 8 chars, all alphanumeric A-Z 0-9

**Run integration tests:**
```bash
cd integration_tests && npm test
```

---

## Phase 10: Documentation & Cleanup

- [ ] Update `doc/SERVER_ENDPOINTS.md` with new endpoints
- [ ] Add inline code comments for crypto operations
- [ ] Review and remove any debug logging
- [ ] Ensure error messages don't leak sensitive information
- [ ] Final code review for security considerations
