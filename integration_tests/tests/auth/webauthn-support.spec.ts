import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../../helpers/server';

test.describe('WebAuthn Support Detection', () => {
  test('shows warning when WebAuthn is not supported on register page', async ({ page }) => {
    const server = await startServer();

    try {
      // Intercept page load to remove PublicKeyCredential before the app runs
      await page.addInitScript(() => {
        // @ts-expect-error - Intentionally removing WebAuthn support for testing
        delete window.PublicKeyCredential;
      });

      await page.goto(`${server.url}/register`);

      // Verify the warning banner is displayed
      await expect(page.getByText('WebAuthn is not supported')).toBeVisible();
      await expect(page.getByText('Passkeys require a secure context')).toBeVisible();

      // Verify the submit button is disabled
      const submitButton = page.locator('button[type="submit"]');
      await expect(submitButton).toBeDisabled();

    } finally {
      await stopServer(server);
    }
  });

  test('shows warning when WebAuthn is not supported on login page', async ({ page }) => {
    const server = await startServer();

    try {
      // Intercept page load to remove PublicKeyCredential before the app runs
      await page.addInitScript(() => {
        // @ts-expect-error - Intentionally removing WebAuthn support for testing
        delete window.PublicKeyCredential;
      });

      await page.goto(`${server.url}/login`);

      // Verify the warning banner is displayed
      await expect(page.getByText('WebAuthn is not supported')).toBeVisible();
      await expect(page.getByText('Passkeys require a secure context')).toBeVisible();

      // Verify the submit button is disabled
      const submitButton = page.locator('button[type="submit"]');
      await expect(submitButton).toBeDisabled();

    } finally {
      await stopServer(server);
    }
  });

  test('does NOT show warning when WebAuthn is supported on register page', async ({ page }) => {
    const server = await startServer();

    try {
      // No init script - keep WebAuthn available (it is on localhost)
      await page.goto(`${server.url}/register`);

      // Verify the warning banner is NOT displayed
      await expect(page.getByText('WebAuthn is not supported')).not.toBeVisible();

      // Verify the submit button is enabled
      const submitButton = page.locator('button[type="submit"]');
      await expect(submitButton).toBeEnabled();

    } finally {
      await stopServer(server);
    }
  });

  test('does NOT show warning when WebAuthn is supported on login page', async ({ page }) => {
    const server = await startServer();

    try {
      // No init script - keep WebAuthn available (it is on localhost)
      await page.goto(`${server.url}/login`);

      // Verify the warning banner is NOT displayed
      await expect(page.getByText('WebAuthn is not supported')).not.toBeVisible();

      // Verify the submit button is enabled
      const submitButton = page.locator('button[type="submit"]');
      await expect(submitButton).toBeEnabled();

    } finally {
      await stopServer(server);
    }
  });
});
