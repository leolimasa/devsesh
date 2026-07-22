import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../../helpers/server';
import { setupVirtualAuthenticator } from '../../helpers/webauthn';

/**
 * Regression test for synced-passkey login (iCloud Keychain / Google Password
 * Manager, and any iOS passkey).
 *
 * Such passkeys always set the Backup Eligible (BE) flag in authenticator data.
 * go-webauthn rejects a login when the stored credential's BE flag differs from
 * the one presented ("Backup Eligible flag inconsistency detected during login
 * validation"). The server previously never persisted BE/BS, so it defaulted to
 * BE=false and every backup-eligible passkey failed login. We now store and
 * restore the flags.
 *
 * A backup-eligible virtual authenticator (defaultBackupEligibility=true)
 * reproduces exactly this: registration stores BE=true, and login must then
 * present BE=true consistently.
 */
test.describe('Authentication - Login with backup-eligible (synced) passkey', () => {
  test('registered backup-eligible passkey can log in', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER:', msg.type(), msg.text()));

    const server = await startServer();
    const testEmail = `backup-${Date.now()}@example.com`;

    try {
      // Backup-eligible + backed-up, exactly like an iCloud Keychain passkey.
      await setupVirtualAuthenticator(page, undefined, { backupEligible: true, backupState: true });

      // Register (stores the credential with BE=1).
      await page.goto(`${server.url}/register`);
      await page.locator('input[type="email"]').fill(testEmail);
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/(login|dashboard)/, { timeout: 15000 });

      // Simulate logout.
      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());

      // Log in with the backup-eligible passkey.
      await page.goto(`${server.url}/login`);
      await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
      await page.locator('input[type="email"]').fill(testEmail);
      await page.locator('button[type="submit"]').click();

      // With BE/BS persisted, validation passes and login completes. Without the
      // fix this stays on /login with an "invalid credential" error.
      await expect(page).toHaveURL(/\/(pair|dashboard)/, { timeout: 10000 });
    } finally {
      await stopServer(server);
    }
  });
});
