import { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Creates a passkey enrollment from Machine B (the device that will register a new passkey).
 * @param page - Playwright page object
 * @param serverUrl - Base server URL
 * @returns The enrollment code (without hyphen)
 */
export async function startEnrollment(page: Page, serverUrl: string): Promise<string> {
  await page.goto(`${serverUrl}/passkeys/enroll`);
  await expect(page.getByRole('heading', { name: 'Register Passkey' })).toBeVisible();

  // Click Start Enrollment button
  const startButton = page.getByRole('button', { name: 'Start Enrollment' });
  await expect(startButton).toBeVisible();
  await startButton.click();

  // Wait for code to be displayed
  const codeElement = page.locator('text=/^[A-Z0-9]{4}-[A-Z0-9]{4}$/');
  await expect(codeElement).toBeVisible({ timeout: 5000 });

  // Extract code from the display (format: XXXX-XXXX)
  const codeText = await codeElement.textContent();
  if (!codeText) {
    throw new Error('Enrollment code not found');
  }

  // Return code without hyphen
  return codeText.replace(/-/g, '');
}

/**
 * Fills in the enrollment code on Machine A and clicks Link Device.
 * @param page - Playwright page object
 * @param serverUrl - Base server URL
 * @param code - 8-character enrollment code (will be formatted with hyphen)
 */
export async function enterEnrollmentCode(page: Page, serverUrl: string, code: string): Promise<void> {
  await page.goto(`${serverUrl}/passkeys/add`);
  await expect(page.getByRole('heading', { name: 'Add Passkey' })).toBeVisible();

  // Enter the code (format: XXXX-XXXX)
  const formattedCode = code.length > 4 
    ? code.slice(0, 4) + '-' + code.slice(4) 
    : code;
  
  const codeInput = page.locator('input[id="code"]');
  await expect(codeInput).toBeVisible();
  await codeInput.fill(formattedCode);

  // Click Link Device button
  const linkButton = page.getByRole('button', { name: 'Link Device' });
  await expect(linkButton).toBeVisible();
  await linkButton.click();
}

/**
 * Gets the encrypted master key from the server.
 * @param serverUrl - Base server URL
 * @param token - JWT token
 * @returns The encrypted master key
 */
export async function getEncryptedMasterKey(serverUrl: string, token: string): Promise<string> {
  const response = await fetch(`${serverUrl}/api/v1/auth/master-key`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get master key: ${response.status}`);
  }

  const data = await response.json();
  return data.encrypted_master_key;
}

/**
 * Creates a passkey enrollment via API (for testing without UI).
 * @param serverUrl - Base server URL
 * @returns The enrollment code
 */
export async function createEnrollmentAPI(serverUrl: string): Promise<string> {
  const response = await fetch(`${serverUrl}/api/v1/auth/passkeys/enrollment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to create enrollment: ${response.status}`);
  }

  const data = await response.json();
  return data.code;
}

/**
 * Checks if an enrollment code exists in the database.
 * @param dbPath - Path to the SQLite database
 * @param code - Enrollment code to check
 * @returns True if the enrollment exists and is not completed
 */
export async function checkEnrollmentInDB(dbPath: string, code: string): Promise<boolean> {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  
  try {
    const result = db.prepare(
      'SELECT completed FROM passkey_enrollments WHERE code = ?'
    ).get(code);
    
    return result !== undefined && result.completed === 0;
  } finally {
    db.close();
  }
}

/**
 * Checks if a credential with encrypted_master_key exists for a user.
 * @param dbPath - Path to the SQLite database
 * @param userId - User ID to check credentials for
 * @returns True if a credential with encrypted master key exists
 */
export async function checkCredentialWithMasterKey(dbPath: string, userId: number): Promise<boolean> {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  
  try {
    const result = db.prepare(
      'SELECT encrypted_master_key FROM webauthn_credentials WHERE user_id = ? AND encrypted_master_key IS NOT NULL'
    ).get(userId);
    
    return result !== undefined;
  } finally {
    db.close();
  }
}