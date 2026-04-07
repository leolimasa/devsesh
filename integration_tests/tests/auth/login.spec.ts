import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../../helpers/server';
import { setupVirtualAuthenticator } from '../../helpers/webauthn';

test.describe('Authentication - Login', () => {
  test('registered user can login with webauthn passkey', async ({ page }) => {
    const server = await startServer();
    const testEmail = `test-${Date.now()}@example.com`;

    try {
      // Set up virtual WebAuthn authenticator
      await setupVirtualAuthenticator(page);

      // First, register a user
      await page.goto(`${server.url}/register`);
      await page.locator('input[type="email"]').fill(testEmail);
      await page.locator('button[type="submit"]').click();

      // Wait for registration to complete and redirect to login
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

      // Clear localStorage to simulate logout
      await page.context().clearCookies();
      await page.evaluate(() => {
        localStorage.clear();
      });

      // Navigate to login page
      await page.goto(`${server.url}/login`);
      await expect(page).toHaveURL(/\/login$/);

      // Check if login page is displayed
      await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();

      // Enter email address
      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toBeVisible();
      await emailInput.fill(testEmail);

      // Submit the form
      const submitButton = page.locator('button[type="submit"]');
      await expect(submitButton).toBeVisible();
      await submitButton.click();

      // Wait for login to complete (WebAuthn popup will be handled automatically by virtual authenticator)
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // Wait for the page to be fully loaded
      await page.waitForLoadState('networkidle');

      // Verify we're on dashboard - look for the Sessions heading
      await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible({ timeout: 5000 });

    } finally {
      await stopServer(server);
    }
  });

  test('login fails with unregistered email', async ({ page }) => {
    const server = await startServer();
    const unregisteredEmail = `unregistered-${Date.now()}@example.com`;

    try {
      await setupVirtualAuthenticator(page);
      await page.goto(`${server.url}/login`);

      // Enter unregistered email
      await page.locator('input[type="email"]').fill(unregisteredEmail);
      await page.locator('button[type="submit"]').click();

      // Should show error (text-red-500 class or similar)
      const errorElement = page.locator('.text-red-500, .text-destructive');
      await expect(errorElement).toBeVisible({ timeout: 5000 });

    } finally {
      await stopServer(server);
    }
  });

  test('login page shows registration link when no users exist', async ({ page }) => {
    const server = await startServer();

    try {
      await page.goto(`${server.url}/login`);

      // Wait for the page to load and check for users
      await page.waitForLoadState('networkidle');

      // When no users exist, the login page should show a link to register
      // The message is "No users found. Create an account"
      const registerLink = page.locator('a[href="/register"]');
      await expect(registerLink).toBeVisible({ timeout: 5000 });

    } finally {
      await stopServer(server);
    }
  });
});
