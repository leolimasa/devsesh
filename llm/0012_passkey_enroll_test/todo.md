# Todo

## Project Status

- 🟡 Phase 1: Helper Functions - IMPLEMENTED
- 🟡 Phase 2: Integration Test Implementation - IMPLEMENTED
- 🟡 Phase 3: Final Verification - IMPLEMENTED

## Phase 1: Helper Functions

- [x] Add `getUserIdByEmail(dbPath: string, email: string): Promise<number | null>` function to `integration_tests/helpers/enrollment.ts`
- [x] Add `getCredentialCountForUser(dbPath: string, userId: number): Promise<number>` function to `integration_tests/helpers/enrollment.ts`
- [x] Add `waitForEnrollmentSuccess(page: Page): Promise<void>` function to `integration_tests/helpers/enrollment.ts`
- [x] Run existing integration tests to ensure no regressions: `cd integration_tests && npm test`

## Phase 2: Integration Test Implementation

- [x] Create test file `integration_tests/tests/enrollment/passkey-enrollment-flow.spec.ts`
- [x] Implement test setup: start server [req.waqmh7, req.vfgfyp]
- [x] Create Machine A BrowserContext using `browser.newContext()` [req.waqmh7]
- [x] Create Machine B BrowserContext using `browser.newContext()` (completely independent) [req.vfgfyp]
- [x] Set up virtual WebAuthn authenticator with PRF support for Machine A [req.zc5j3w]
- [x] Set up virtual WebAuthn authenticator with PRF support for Machine B [req.iixgv6]
- [x] Machine A: Register new user and login [req.bntuym]
- [x] Machine A: Navigate to `/passkeys/add` and verify page displays [req.9vznsw]
- [x] Machine A: Keep page open for WebSocket communication [req.dt9rcc]
- [x] Machine B: Navigate to `/passkeys/enroll` and start enrollment [req.xkxlj6]
- [x] Machine B: Capture the displayed enrollment code
- [x] Machine B: Keep page open for WebSocket communication [req.jjspag]
- [x] Machine A: Switch back to existing page [req.80uc34]
- [x] Machine A: Enter enrollment code from Machine B [req.gnqik5]
- [x] Machine A: Click "Link Device" button
- [x] Wait for enrollment process to complete [req.y9alku]
- [x] Verify success message is displayed on Machine A [req.qhcoja]
- [x] Verify Machine B's passkey exists in database with `encrypted_master_key` [req.tu068q]
- [x] Implement test cleanup: close contexts and stop server
- [x] Run the new integration test: `cd integration_tests && npm test -- --grep "passkey enrollment flow"`

## Phase 3: Final Verification

- [x] Run all unit tests: `nix develop --command go test ./...`
- [x] Run all integration tests: `cd integration_tests && npm test`
- [x] Correct any bugs present on the existing code that prevent the integration test from passing
- [x] Verify all tests pass
