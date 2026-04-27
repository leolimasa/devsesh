# Todo

## Phase 1: Helper Functions

- [ ] Add `getUserIdByEmail(dbPath: string, email: string): Promise<number | null>` function to `integration_tests/helpers/enrollment.ts`
- [ ] Add `getCredentialCountForUser(dbPath: string, userId: number): Promise<number>` function to `integration_tests/helpers/enrollment.ts`
- [ ] Add `waitForEnrollmentSuccess(page: Page): Promise<void>` function to `integration_tests/helpers/enrollment.ts`
- [ ] Run existing integration tests to ensure no regressions: `cd integration_tests && npm test`

## Phase 2: Integration Test Implementation

- [ ] Create test file `integration_tests/tests/enrollment/passkey-enrollment-flow.spec.ts`
- [ ] Implement test setup: start server [req.waqmh7, req.vfgfyp]
- [ ] Create Machine A BrowserContext using `browser.newContext()` [req.waqmh7]
- [ ] Create Machine B BrowserContext using `browser.newContext()` (completely independent) [req.vfgfyp]
- [ ] Set up virtual WebAuthn authenticator with PRF support for Machine A [req.zc5j3w]
- [ ] Set up virtual WebAuthn authenticator with PRF support for Machine B [req.iixgv6]
- [ ] Machine A: Register new user and login [req.bntuym]
- [ ] Machine A: Navigate to `/passkeys/add` and verify page displays [req.9vznsw]
- [ ] Machine A: Keep page open for WebSocket communication [req.dt9rcc]
- [ ] Machine B: Navigate to `/passkeys/enroll` and start enrollment [req.xkxlj6]
- [ ] Machine B: Capture the displayed enrollment code
- [ ] Machine B: Keep page open for WebSocket communication [req.jjspag]
- [ ] Machine A: Switch back to existing page [req.80uc34]
- [ ] Machine A: Enter enrollment code from Machine B [req.gnqik5]
- [ ] Machine A: Click "Link Device" button
- [ ] Wait for enrollment process to complete [req.y9alku]
- [ ] Verify success message is displayed on Machine A [req.qhcoja]
- [ ] Verify Machine B's passkey exists in database with `encrypted_master_key` [req.tu068q]
- [ ] Implement test cleanup: close contexts and stop server
- [ ] Run the new integration test: `cd integration_tests && npm test -- --grep "passkey enrollment flow"`

## Phase 3: Final Verification

- [ ] Run all unit tests: `nix develop --command go test ./...`
- [ ] Run all integration tests: `cd integration_tests && npm test`
- [ ] Correct any bugs present on the existing code that prevent the integration test from passing
- [ ] Verify all tests pass
