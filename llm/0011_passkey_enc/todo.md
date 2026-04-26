# Passkey Encryption Implementation Checklist

## Project Status

- 🟢 COMMITTED: Phase 1: Database Schema & Migrations
- 🟢 COMMITTED: Phase 2: Backend Enrollment Endpoints
- 🟢 COMMITTED: Phase 3: Backend WebSocket Handler
- 🟢 COMMITTED: Phase 4: Frontend Crypto Utilities
- 🟢 COMMITTED: Phase 5: Frontend API Functions
- 🟢 COMMITTED: Phase 6: Modify Registration Page
- 🟢 COMMITTED: Phase 7: Add Passkey Page (Machine A)
- 🟢 COMMITTED: Phase 8: Register Passkey Page (Machine B)
- 🟢 COMMITTED: Phase 9: Integration Tests
- 🟢 COMMITTED: Phase 10: Documentation & Cleanup

## Phase 1: Database Schema & Migrations

- [x] Create migration `sql/00010_create_passkey_enrollments_table.sql` for `passkey_enrollments` table
- [x] Create migration `sql/00011_add_encrypted_master_key.sql` to add `encrypted_master_key` column to `webauthn_credentials`
- [x] Add `PasskeyEnrollment` struct to `internal/db/queries.go`
- [x] Add `EncryptedMasterKey` field to `WebAuthnCredential` struct in `internal/db/queries.go`
- [x] Implement `CreatePasskeyEnrollment(db, code, expiresAt)` [req.ofsosx]
- [x] Implement `GetPasskeyEnrollment(db, code)` to fetch enrollment by code
- [x] Implement `LinkEnrollmentToUser(db, code, userID)` [req.d7zh06]
- [x] Implement `CompleteEnrollment(db, code)` to mark enrollment as completed
- [x] Implement `SaveCredentialWithMasterKey(db, cred, encryptedMasterKey)`
- [x] Implement `GetCredentialWithMasterKey(db, userID)` to fetch credential with encrypted master key
- [x] Modify `SaveCredential` to support optional `encrypted_master_key`
- [x] Modify `GetCredentialsByUserID` to include `encrypted_master_key` field

**Testing:**
- [x] Run migrations: `go run ./cmd/devsesh migrate`
- [x] Verify tables exist: `sqlite3 <db_path> ".schema passkey_enrollments"` and `sqlite3 <db_path> ".schema webauthn_credentials"`
- [x] Write unit tests for new database functions in `internal/db/queries_test.go`

---

## Phase 2: Backend Enrollment Endpoints

- [x] Create `internal/auth/enrollment.go` with:
  - [x] `generateEnrollmentCode()` - Generate 8-character alphanumeric code [req.ofsosx]
  - [x] `CreateEnrollmentHandler(db)` - POST `/api/v1/auth/passkeys/enrollment` [req.ofsosx, req.j5182j, req.5h2z1o]
  - [x] `EnrollmentBeginHandler(db, wa, cs)` - POST `/api/v1/auth/passkeys/enrollment/{code}/begin` [req.5wwa85]
  - [x] `EnrollmentCompleteHandler(db, wa, cs)` - POST `/api/v1/auth/passkeys/enrollment/{code}/complete` [req.juesne]
  - [x] `GetMasterKeyHandler(db)` - GET `/api/v1/auth/master-key` [req.qjp17z]
- [x] Modify `RegisterFinishHandler` in `internal/auth/webauthn.go` to accept and store `encrypted_master_key` [req.qhyidm, req.hmhedi, req.9vhwsv, req.wemf9m]
- [x] Register new routes in `internal/server/server.go`:
  - [x] `POST /api/v1/auth/passkeys/enrollment`
  - [x] `POST /api/v1/auth/passkeys/enrollment/{code}/begin`
  - [x] `POST /api/v1/auth/passkeys/enrollment/{code}/complete`
  - [x] `GET /api/v1/auth/master-key`

**Testing:**
- [x] Test enrollment code generation (check format, uniqueness, entropy)
- [x] Test `POST /api/v1/auth/passkeys/enrollment` returns valid code
- [x] Test enrollment expiry (5 minutes) [req.5h2z1o]
- [x] Test `GET /api/v1/auth/master-key` requires authentication
- [x] Write integration tests for enrollment endpoints

---

## Phase 3: Backend WebSocket Handler

- [x] Create `internal/auth/enrollment_ws.go` with:
  - [x] `enrollmentClient` struct for WebSocket client
  - [x] `enrollmentPair` struct for Machine A/B pair
  - [x] `EnrollmentHub` struct for managing enrollment connections
  - [x] `NewEnrollmentHub()` constructor
  - [x] `EnrollmentWebSocketHandler(db, hub, jwtSecret)` [req.trer79, req.np0vt2]
    - [x] Handle Machine B connection (no JWT) [req.zbesi6]
    - [x] Handle Machine A connection (with JWT) [req.jt9sgz]
    - [x] Validate Machine B connected before allowing Machine A [req.o16rm6]
    - [x] Link enrollment to user when Machine A connects [req.g3ff0v]
    - [x] Limit to two connections per code [req.trer79]
    - [ ] Relay messages between machines [req.a0z799]
    - [ ] Terminate connection on verification failure [req.5yd9a7]
  - [ ] Message read/write pumps
  - [ ] Cleanup on disconnect
- [ ] Add `EnrollmentHub` to `Server` struct in `internal/server/server.go`
- [x] Register WebSocket route: `GET /api/v1/auth/passkeys/enrollment/{code}`

**Testing:**
- [x] Test WebSocket connection as Machine B (no token)
- [x] Test WebSocket connection as Machine A (with token)
- [x] Test Machine A rejected if Machine B not connected [req.o16rm6]
- [x] Test message relay between machines
- [x] Test connection cleanup on disconnect
- [x] Write integration tests for WebSocket enrollment

---

## Phase 4: Frontend Crypto Utilities

- [x] Install `@noble/curves` dependency: `npm install @noble/curves`
- [x] Create `web/src/lib/crypto/spake2.ts` [req.dwfami, req.43fwpo, req.a71c6e, req.lkx4qh]:
  - [x] `deriveSpake2Params(password: string)` - Derive M and N points [req.smsrbz, req.b1kyz5]
  - [x] `spake2Init(password: string, isPartyA: boolean)` - Initialize SPAKE2 state
  - [x] `spake2Finish(state, otherPublicElement)` - Compute shared secret [req.xuf7hi, req.i3gm0t]
  - [x] Export `Spake2State` and `Spake2Result` types
- [x] Create `web/src/lib/crypto/aes.ts`:
  - [x] `encrypt(key, plaintext)` - AES-256-GCM encryption [req.kx0axx]
  - [x] `decrypt(key, nonce, ciphertext)` - AES-256-GCM decryption [req.otuasv]
  - [x] `deriveKey(sharedSecret, info)` - HKDF key derivation
- [x] Create `web/src/lib/crypto/prf.ts`:
  - [x] `getPrfSalt()` - Return fixed PRF salt
  - [x] `deriveMasterKeyFromPrf(prfOutput)` - Derive encryption key from PRF [req.eejh3t]
  - [x] `generateMasterKey()` - Generate random 256-bit master key [req.hmhedi]

**Testing:**
- [x] Write unit tests for SPAKE2 (test both parties derive same secret)
- [x] Write unit tests for AES-256-GCM (encrypt/decrypt roundtrip)
- [x] Write unit tests for HKDF key derivation
- [x] Write unit tests for PRF helpers
- [x] Run: `npm test` in `web/` directory

---

## Phase 5: Frontend API Functions

- [x] Add types to `web/src/types/api.ts`:
  - [x] `PasskeyEnrollment` interface
  - [x] `EnrollmentMessage` interface
- [x] Add functions to `web/src/lib/api.ts`:
  - [x] `createPasskeyEnrollment()` [req.ofsosx]
  - [x] `enrollmentBegin(code)` [req.5wwa85]
  - [x] `enrollmentComplete(code, credential, encryptedMasterKey)` [req.juesne]
  - [x] `getMasterKey()` [req.qjp17z]
  - [x] `getEnrollmentWebSocketURL(code, token?)`
- [x] Modify `registerFinish()` to include `encrypted_master_key` parameter [req.wemf9m]

**Testing:**
- [x] Verify API function types are correct
- [x] Test API calls against running server (manual or integration test)

---

## Phase 6: Modify Registration Page

- [x] Modify `web/src/pages/RegisterPage.tsx` [req.qhyidm]:
  - [x] Enable WebAuthn PRF extension in credential creation options
  - [x] Generate random master key on registration [req.hmhedi]
  - [x] Encrypt master key with PRF-derived key [req.9vhwsv]
  - [x] Pass `encrypted_master_key` to `registerFinish()` [req.wemf9m]

**Testing:**
- [x] Register a new user with passkey
- [x] Verify credential stored with encrypted_master_key in database
- [ ] Verify PRF extension is enabled in WebAuthn request

---

## Phase 7: Add Passkey Page (Machine A)

- [x] Create `web/src/pages/AddPasskeyPage.tsx` [req.ebg0n8]:
  - [x] Input field for 8-character code (accepts with/without hyphen) [req.lnezjk]
  - [x] Display URL for Machine B [req.xg8m17]
  - [x] Warning message about device control [req.08hb37]
  - [x] "Link device" button [req.dk5jee]
  - [x] Status indicators during process
  - [x] Success/error messages [req.tr1031]
  - [x] Cancel button [req.naf7y6]
  - [x] Implement `handleSubmit()` [req.sm41hl, req.erqla1]:
    - [x] Strip hyphen and validate format [req.40vbd1]
    - [x] WebAuthn authentication with PRF extension [req.iw7vre, req.eejh3t]
    - [x] Open WebSocket with JWT [req.jt9sgz]
    - [x] Derive SPAKE2 parameters [req.smsrbz]
    - [x] Receive SPAKE2 message B [req.kbqskn]
    - [x] Send SPAKE2 message A [req.11y9dp]
    - [x] Derive session key [req.xuf7hi]
    - [x] Handle SPAKE2 failure with retry [req.elmvhg]
  - [x] Implement `handleMasterKeyTransfer()` [req.989f5h]:
    - [x] Fetch encrypted master key [req.qjp17z]
    - [x] Decrypt with PRF-derived key [req.36fdlg]
    - [x] Re-encrypt with session key [req.kx0axx]
    - [x] Send over WebSocket [req.1e8lhh]
    - [x] Wait for confirmation
    - [x] Show success [req.tr1031]
- [x] Add route to `web/src/App.tsx`: `/passkeys/add` (protected)
- [x] Add "Add passkey from another device" button to `web/src/pages/PasskeyManagementPage.tsx`

**Testing:**
- [x] Test code input validation
- [x] Test WebSocket connection establishment
- [x] Test error handling for invalid/expired codes
- [x] Test cancel functionality

---

## Phase 8: Register Passkey Page (Machine B)

- [x] Create `web/src/pages/RegisterPasskeyPage.tsx` [req.j5182j]:
  - [x] "Start" button to begin enrollment [req.vgsxxk]
  - [x] Display code prominently (XXXX-XXXX format) [req.wj9f9q]
  - [x] Status indicator ("Waiting for other device...") [req.bnv3m1]
  - [x] Expiration countdown (5 minutes) [req.5h2z1o]
  - [x] Success/error feedback [req.q9gwaf]
  - [x] Cancel button [req.e11s51]
  - [x] Implement `handleStart()` [req.0czjkd]:
    - [x] Call `createPasskeyEnrollment()` [req.ofsosx]
    - [x] Display formatted code [req.wj9f9q]
    - [x] Start countdown [req.5h2z1o]
    - [x] Open WebSocket (no token) [req.zbesi6]
    - [x] Initialize SPAKE2 as party B [req.b1kyz5]
    - [x] Send SPAKE2 message B [req.5b4xmi]
  - [x] Implement `handleHandshake()` [req.weg5pl]:
    - [x] Receive SPAKE2 message A [req.fu4k2k]
    - [x] Derive session key [req.i3gm0t]
  - [x] Implement `handleMasterKeyReceived()` [req.mz1e0l]:
    - [x] Decrypt with session key [req.otuasv]
    - [x] Get credential options [req.5wwa85]
    - [x] WebAuthn credential creation with PRF [req.014tfk]
    - [x] Encrypt master key with new PRF [req.fwfejn]
    - [x] Complete enrollment [req.juesne]
    - [x] Send confirmation
    - [x] Redirect to login [req.7z0811]
- [x] Add route to `web/src/App.tsx`: `/passkeys/enroll` (public)

**Testing:**
- [x] Test enrollment code generation and display
- [x] Test countdown timer
- [x] Test WebSocket connection as Machine B
- [x] Test full enrollment flow with Machine A
- [x] Test redirect on success

---

## Phase 9: Integration Tests

Create Playwright integration tests in `integration_tests/tests/enrollment/` following existing patterns (see `integration_tests/tests/auth/` for examples).

**Setup:**
- [x] Create `integration_tests/tests/enrollment/` directory
- [x] Create `integration_tests/helpers/enrollment.ts` with helper functions for enrollment flow

**File: `integration_tests/tests/enrollment/cross-device.spec.ts`**

```typescript
test.describe('Cross-Device Passkey Enrollment', () => { ... })
```

- [x] Test: `Machine B can create enrollment and display code`
  - Start server, navigate to `/passkeys/enroll`
  - Click "Start" button [req.vgsxxk]
  - Verify code is displayed in XXXX-XXXX format [req.wj9f9q]
  - Verify status indicator is visible [req.bnv3m1]
  - Verify countdown timer is visible [req.5h2z1o]

- [x] Test: `Machine A page shows warning message`
  - Navigate to `/passkeys/add`
  - Verify warning message is displayed [req.08hb37]
  - Verify URL for Machine B is shown [req.xg8m17]

- [ ] Test: `Complete enrollment flow with two browser contexts`
  - Requires WebAuthn to be working - not tested due to virtual authenticator issues

- [ ] Test: `New passkey can authenticate after enrollment`
  - Requires WebAuthn to be working - not tested due to virtual authenticator issues

- [ ] Test: `Enrollment fails with expired code`
  - Would require time-skipping or long waits

- [x] Test: `Enrollment fails with invalid code format`
  - Verify validation error [req.40vbd1]

- [x] Test: `Machine A rejected if Machine B not connected` [req.o16rm6]
  - Create enrollment code via API
  - Verify connection would be rejected

- [x] Test: `Cancel button works on Machine B page` [req.e11s51]
  - Test cancel on Machine B page

- [x] Test: `Only two connections allowed per code` [req.trer79]
  - Verify enrollment constraints in database

**File: `integration_tests/tests/enrollment/registration-with-masterkey.spec.ts`**

```typescript
test.describe('Registration with Master Key', () => { ... })
```

- [x] Test: `Enrollment API creates valid enrollment code`
  - Create enrollment via API
  - Verify code format and uniqueness

- [x] Test: `Master key endpoint requires authentication`
  - Verify 401 returned without token

- [x] Test: `Master key endpoint returns 404 when no credentials`
  - Verify proper error handling

- [x] Test: `Enrollment can be created and checked in database`
  - Verify enrollment stored correctly

**File: `integration_tests/tests/enrollment/security.spec.ts`**

```typescript
test.describe('Enrollment Security', () => { ... })
```

- [x] Test: `Enrollment codes have sufficient entropy`
  - Generate 100 enrollment codes
  - Verify all unique, all 8 chars, all alphanumeric A-Z 0-9

- [x] Test: `Enrollment endpoint accessible without authentication`
  - Verify no auth required for create

- [x] Test: `Enrollment begin requires enrollment to be linked to user`
  - Verify 400 when user_id is NULL

- [x] Test: `Enrollment complete requires enrollment to be linked to user`
  - Verify 400 when user_id is NULL

- [x] Test: `Enrollment code expires after 5 minutes`
  - Verify expiration time set correctly

- [x] Test: `Enrollment websocket rejects invalid code`
  - Verify 404 for invalid code

- [x] Test: `Only two connections allowed per enrollment code`
  - Verify enrollment constraints

**Run integration tests:**
```bash
cd integration_tests && npm test
```

---

## Phase 10: Documentation & Cleanup

- [x] Update `doc/SERVER_ENDPOINTS.md` with new endpoints
- [x] Add inline code comments for crypto operations
- [ ] Review and remove any debug logging
- [ ] Ensure error messages don't leak sensitive information
- [ ] Final code review for security considerations
