# Implementation Plan

This document describes how to implement the passkey enrollment integration test as specified in requirements.md.

## Overview

Create a single comprehensive integration test that tests the full cross-device passkey enrollment flow by using two separate Playwright BrowserContexts (Machine A and Machine B), each with their own virtual WebAuthn authenticator.

---

## Test File

### File: `integration_tests/tests/enrollment/passkey-enrollment-flow.spec.ts` (create)

#### Test: `Full passkey enrollment flow between two devices`

A single test that covers the complete enrollment workflow with two separate browser contexts:

**Test Setup:**
- Start the server using `startServer()` [req.waqmh7, req.vfgfyp]
- Create two independent `BrowserContext` instances using `browser.newContext()` - one for Machine A, one for Machine B [req.waqmh7, req.vfgfyp]
- Create a page for each context
- Set up virtual WebAuthn authenticators with PRF support for each context using `setupVirtualAuthenticator()` [req.zc5j3w, req.iixgv6]

**Machine A Setup:** [req.bntuym]
- Navigate to `/register` and register a new user with a unique email
- Navigate to `/login` and login to get authenticated
- Navigate to `/passkeys/add` and verify the page displays [req.9vznsw]
- Keep the page open (do not close or navigate away) [req.dt9rcc]

**Machine B Enrollment Start:** [req.xkxlj6]
- Navigate to `/passkeys/enroll`
- Click "Start Enrollment" button
- Wait for and capture the displayed enrollment code (format: `XXXX-XXXX`)
- Keep the page open for WebSocket communication [req.jjspag]

**Machine A Code Entry:** [req.80uc34, req.gnqik5]
- Switch back to Machine A's page
- Enter the enrollment code from Machine B into the code input field
- Click "Link Device" button to initiate the SPAKE2 handshake and master key transfer

**Wait and Verify:** [req.y9alku]
- Wait for the enrollment process to complete (WebSocket communication, SPAKE2 handshake, credential creation)
- On Machine A: Verify success message is displayed [req.qhcoja]
- Verify Machine B's passkey has been added to the database by checking `webauthn_credentials` table for a new credential with `encrypted_master_key` [req.tu068q]

**Test Cleanup:**
- Close both browser contexts
- Stop the server

**Implementation Details:**
- Use `expect().toBeVisible({ timeout: X })` with appropriate timeouts for WebSocket-dependent steps
- Use direct database queries via `better-sqlite3` to verify credential creation
- The virtual authenticators will automatically handle WebAuthn ceremonies without user interaction
- Use `page.waitForTimeout()` sparingly, prefer `expect` assertions with timeouts for reliability

---

## Helper Updates

### File: `integration_tests/helpers/enrollment.ts` (modify)

#### Function: `waitForEnrollmentSuccess(page: Page): Promise<void>`

Wait for the enrollment success message to appear on Machine A's add passkey page.

- Locate the success message element on the page
- Use `expect().toBeVisible()` with a reasonable timeout (10-15 seconds)
- Return once success is confirmed or throw if timeout

#### Function: `getCredentialCountForUser(dbPath: string, userId: number): Promise<number>`

Get the number of credentials with `encrypted_master_key` for a user.

- Open database connection using `better-sqlite3`
- Query `webauthn_credentials` table for credentials where `user_id` matches and `encrypted_master_key IS NOT NULL`
- Return the count
- Close database connection in finally block

#### Function: `getUserIdByEmail(dbPath: string, email: string): Promise<number | null>`

Look up a user ID by email address for database verification.

- Open database connection using `better-sqlite3`
- Query `users` table for the user with the given email
- Return the user ID or null if not found
- Close database connection in finally block

---

## Test Assertions Summary

The test will verify:

1. Machine A can register and login successfully [req.bntuym]
2. Machine A can navigate to `/passkeys/add` page [req.9vznsw]
3. Machine B can start enrollment and display code [req.xkxlj6]
4. Machine A can enter the code and initiate linking [req.gnqik5]
5. The enrollment completes with a success message [req.qhcoja]
6. A new credential with `encrypted_master_key` exists in the database for Machine B [req.tu068q]
