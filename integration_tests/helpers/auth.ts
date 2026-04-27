import { Page } from '@playwright/test';
import { setupVirtualAuthenticator } from './webauthn';
import { expect } from '@playwright/test';

/**
 * Register a new user via the web interface.
 * @param page - Playwright page object
 * @param serverUrl - Base server URL
 * @param email - Email address for registration
 */
export async function registerUser(page: Page, serverUrl: string, email: string): Promise<void> {
  // Navigate to registration page
  await page.goto(`${serverUrl}/register`);
  await expect(page).toHaveURL(/\/register$/);

  // Check if registration page is displayed
  await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();

  // Enter email address
  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toBeVisible();
  await emailInput.fill(email);

  // Submit the form
  const submitButton = page.locator('button[type="submit"]');
  await expect(submitButton).toBeVisible();
  await submitButton.click();

  // Store email for later use during login
  await page.evaluate((email) => {
    window.localStorage.setItem('pending_email', email);
  }, email);

  // Wait for registration to complete (WebAuthn popup will be handled automatically by virtual authenticator)
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

  // Verify we're on login page
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
}

/**
 * Login an existing user and return the JWT token.
 * @param page - Playwright page object
 * @param serverUrl - Base server URL
 * @param email - Email address for login
 * @returns JWT token from localStorage
 */
export async function loginUser(page: Page, serverUrl: string, email: string): Promise<string> {
  // Navigate to login page
  await page.goto(`${serverUrl}/login`);
  await expect(page).toHaveURL(/\/login$/);

  // Check if login page is displayed
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();

  // Enter email address
  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toBeVisible();
  await emailInput.fill(email);

  // Submit the form
  const submitButton = page.locator('button[type="submit"]');
  await expect(submitButton).toBeVisible();
  await submitButton.click();

  // Wait for login to complete (can go to /pair or /dashboard)
  await expect(page).toHaveURL(/\/(pair|dashboard)/, { timeout: 10000 });

  // Extract JWT token and user from localStorage (app uses 'token' and 'user' keys)
  const token = await page.evaluate(() => window.localStorage.getItem('token'));
  if (!token) {
    throw new Error('JWT token not found in localStorage after login');
  }
  // Also need to store user info for AuthContext
  await page.evaluate(() => {
    const storedUser = window.localStorage.getItem('user');
    if (!storedUser) {
      // Create minimal user info if not present
      const email = window.localStorage.getItem('pending_email') || 'unknown';
      window.localStorage.setItem('user', JSON.stringify({ email, token: window.localStorage.getItem('token') }));
    }
  });
  return token;
}