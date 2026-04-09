import { Page, expect } from '@playwright/test';
import { setupVirtualAuthenticator } from './webauthn';
import { registerUser } from './auth';
import { spawnDevseshLogin, extractPairingCode, waitForCliSuccess } from './cli';

/**
 * Enter a pairing code in the web interface.
 * @param page - Playwright page object
 * @param serverUrl - Base server URL
 * @param code - Pairing code to enter
 */
export async function enterPairingCode(page: Page, serverUrl: string, code: string): Promise<void> {
  // Navigate to pairing page if not already there (use full URL to stay in same context)
  await page.goto(`${serverUrl}/pair`);
  await expect(page).toHaveURL(/\/pair$/);

  // Wait for the pairing code input field to be visible
  const codeInput = page.locator('input[placeholder="ABC123"]');
  await expect(codeInput).toBeVisible();

  // Debug: log current page state
  console.log('Current URL before entering code:', page.url());

  // Fill in the code
  await codeInput.fill(code);

  // Click the submit/pair button
  const submitButton = page.locator('button:has-text("Pair Device")');
  await expect(submitButton).toBeVisible();
  await submitButton.click();

  // Wait for success confirmation OR redirect to dashboard
  await Promise.race([
    expect(page.getByText('Device paired successfully', { exact: false })).toBeVisible({ timeout: 10000 }),
    expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 }),
  ]);
}

/**
 * Set up a fully paired CLI with an authenticated user.
 * This is a convenience function that combines:
 * - Setting up virtual authenticator
 * - Registering a new user
 * - Logging in the user
 * - Pairing the CLI with the server
 *
 * @param page - Playwright page object
 * @param serverUrl - Base server URL
 * @param email - Email address for registration
 * @param configPath - Path to store the CLI config file
 * @returns JWT token for API calls
 */
export async function setupPairedCli(
  page: Page,
  serverUrl: string,
  email: string,
  configPath: string,
  sessionDir?: string
): Promise<string> {
  // Set up virtual WebAuthn authenticator
  await setupVirtualAuthenticator(page);

  // Register a new user
  await registerUser(page, serverUrl, email);

  // Login the user to get a valid JWT
  await page.goto(`${serverUrl}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

  // Get JWT token from localStorage
  const token = await page.evaluate(() => window.localStorage.getItem('token'));
  if (!token) {
    throw new Error('JWT token not found in localStorage after login');
  }

  // Navigate to pair page
  await page.evaluate(() => window.location.href = '/pair');
  await expect(page).toHaveURL(/\/pair/, { timeout: 5000 });

  // Spawn devsesh login command
  const cliProcess = spawnDevseshLogin(serverUrl, configPath, sessionDir);

  // Wait for pairing code in CLI output
  let pairingCode: string | null = null;
  const timeout = 15000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    pairingCode = extractPairingCode(cliProcess.stdout);
    if (pairingCode) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  if (!pairingCode) {
    throw new Error('Pairing code not found in CLI output');
  }

  // Enter pairing code in web interface
  await enterPairingCode(page, serverUrl, pairingCode);

  // Wait for CLI process to complete successfully
  await waitForCliSuccess(cliProcess);

  return token;
}
