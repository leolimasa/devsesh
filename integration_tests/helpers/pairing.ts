import { Page, expect } from '@playwright/test';

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