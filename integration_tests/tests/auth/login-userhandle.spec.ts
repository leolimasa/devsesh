import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../../helpers/server';
import { setupVirtualAuthenticator } from '../../helpers/webauthn';
import { registerUser } from '../../helpers/auth';
import { getUserIdByEmail } from '../../helpers/enrollment';

/**
 * Regression test for the iOS passkey login failure.
 *
 * Discoverable (resident) credentials always return a `userHandle` on
 * assertion. @simplewebauthn/browser v9 hands that back as a *UTF-8 string*,
 * but the server (go-webauthn) expects it base64url-encoded and rejected the
 * whole assertion ("illegal base64 data at input byte 0") — so login always
 * failed on iPhone with "invalid credential". LoginPage now re-encodes
 * userHandle to base64url before sending.
 *
 * Chromium's virtual authenticator only returns a userHandle for *resident*
 * credentials, and the app never requests resident keys, so a normal login
 * never reproduces this. We register normally (which stores the credential's
 * public key server-side), then re-inject the *same* credential — keypair
 * preserved so signatures still verify — as resident with a userHandle equal to
 * the server's WebAuthnID (the ASCII user id), exactly what iOS would return.
 */
test.describe('Authentication - Login with discoverable credential (userHandle)', () => {
  test('login succeeds when the authenticator returns a userHandle', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER:', msg.type(), msg.text()));

    const server = await startServer();
    const testEmail = `userhandle-${Date.now()}@example.com`;

    try {
      const { cdpSession, authenticatorId } = await setupVirtualAuthenticator(page);

      // Register normally: stores the server-side credential (public key) and a
      // non-resident credential in the virtual authenticator.
      await registerUser(page, server.url, testEmail);

      const userId = await getUserIdByEmail(server.dbPath, testEmail);
      if (userId === null) {
        throw new Error('user not found in database after registration');
      }

      // Grab the credential the app just created so we can re-inject it with the
      // same keypair (otherwise server-side signature verification would fail).
      const { credentials } = await cdpSession.send('WebAuthn.getCredentials', { authenticatorId }) as {
        credentials: Array<{ credentialId: string; privateKey: string; rpId?: string; signCount: number }>;
      };
      expect(credentials.length).toBeGreaterThan(0);
      const cred = credentials[0];

      // Server WebAuthnID = ASCII user id (e.g. "1"); CDP wants the raw bytes as base64.
      const userHandleB64 = Buffer.from(String(userId), 'utf-8').toString('base64');

      // Promote to a resident credential with a userHandle, like an iOS passkey.
      await cdpSession.send('WebAuthn.removeCredential', { authenticatorId, credentialId: cred.credentialId });
      await cdpSession.send('WebAuthn.addCredential', {
        authenticatorId,
        credential: {
          credentialId: cred.credentialId,
          isResidentCredential: true,
          rpId: cred.rpId,
          privateKey: cred.privateKey,
          userHandle: userHandleB64,
          signCount: cred.signCount,
        },
      });

      // Capture the login-finish payload to prove the client sends a base64url
      // userHandle (the fix), not a raw UTF-8 string.
      let sentUserHandle: string | undefined;
      page.on('request', req => {
        if (req.url().includes('/api/v1/auth/login/finish')) {
          try {
            const body = JSON.parse(req.postData() || '{}');
            sentUserHandle = body?.credential?.response?.userHandle;
          } catch {
            /* ignore */
          }
        }
      });

      // Simulate logout.
      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());

      // Log in with the resident credential.
      await page.goto(`${server.url}/login`);
      await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
      await page.locator('input[type="email"]').fill(testEmail);
      await page.locator('button[type="submit"]').click();

      // With the fix, login parses + verifies and redirects away from /login.
      await expect(page).toHaveURL(/\/(pair|dashboard)/, { timeout: 10000 });

      // The authenticator must actually have returned a userHandle (otherwise the
      // bug isn't being exercised), and it must have been sent base64url-encoded.
      expect(sentUserHandle, 'login-finish should carry a userHandle').toBeDefined();
      expect(sentUserHandle!).toMatch(/^[A-Za-z0-9_-]+$/);
      // "1" (0x31) round-trips: base64url decodes back to the ASCII user id.
      const decoded = Buffer.from(
        sentUserHandle!.replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      ).toString('utf-8');
      expect(decoded).toBe(String(userId));
    } finally {
      await stopServer(server);
    }
  });
});
