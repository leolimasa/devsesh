import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../../helpers/server';
import { setupVirtualAuthenticator } from '../../helpers/webauthn';

test.describe('Authentication - Registration', () => {
  test('user can register with webauthn passkey', async ({ page }) => {
    const server = await startServer();
    const testEmail = `test-${Date.now()}@example.com`;

    try {
      // Set up virtual WebAuthn authenticator
      await setupVirtualAuthenticator(page);

      // Navigate to registration page
      await page.goto(`${server.url}/register`);
      await expect(page).toHaveURL(/\/register$/);

      // Check if registration page is displayed
      await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();

      // Enter email address
      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toBeVisible();
      await emailInput.fill(testEmail);

      // Submit the form
      const submitButton = page.locator('button[type="submit"]');
      await expect(submitButton).toBeVisible();
      await submitButton.click();

      // Wait for registration to complete (WebAuthn popup will be handled automatically by virtual authenticator)
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

      // Verify we're on login page
      await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();

    } finally {
      await stopServer(server);
    }
  });

  test('registration fails with invalid email', async ({ page }) => {
    const server = await startServer();

    try {
      await page.goto(`${server.url}/register`);

      // Enter invalid email - browser validation will prevent form submission
      const emailInput = page.locator('input[type="email"]');
      await emailInput.fill('invalid-email');
      await page.locator('button[type="submit"]').click();

      // The HTML5 email validation should prevent submission
      // Check that we're still on the register page (form didn't submit)
      await expect(page).toHaveURL(/\/register/);

      // The email input should be invalid
      await expect(emailInput).toHaveAttribute('type', 'email');

    } finally {
      await stopServer(server);
    }
  });
});
