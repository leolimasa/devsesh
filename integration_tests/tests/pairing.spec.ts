import { test, expect } from '@playwright/test';
import { startServer, stopServer, cleanupTestConfig } from '../helpers/server';
import { setupVirtualAuthenticator } from '../helpers/webauthn';
import { registerUser } from '../helpers/auth';
import { spawnDevseshLogin, extractPairingCode, waitForCliSuccess } from '../helpers/cli';
import { enterPairingCode } from '../helpers/pairing';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

test.describe('Pairing Integration Test', () => {
  test('CLI pairing flow works end-to-end', async ({ page }) => {
    const server = await startServer();
    const testEmail = `test-${Date.now()}@example.com`;
    const tempDir = os.tmpdir();
    const configPath = path.join(tempDir, `devsesh-test-config-${Date.now()}.yml`);

    try {
      // Set up virtual WebAuthn authenticator
      await setupVirtualAuthenticator(page);

      // Verify server is reachable
      const response = await page.request.get(`${server.url}/api/v1/auth/status`);
      console.log('Server status from browser:', response.status());

      // Register a new user
      await registerUser(page, server.url, testEmail);

      // Login the user to get a valid JWT for the pairExchange call
      await page.goto(`${server.url}/login`);
      await page.locator('input[type="email"]').fill(testEmail);
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
      
      // Debug: check the user's token
      let token = await page.evaluate(() => window.localStorage.getItem('token'));
      console.log('User token after login:', token ? 'present' : 'MISSING');
      
      // Navigate to pair page (don't use page.goto, this might lose context)
      await page.evaluate(() => window.location.href = '/pair');
      await expect(page).toHaveURL(/\/pair/, { timeout: 5000 });
      
      // Verify we still have the token after navigating
      token = await page.evaluate(() => window.localStorage.getItem('token'));
      console.log('User token after navigating to /pair:', token ? 'present' : 'MISSING');

      // Spawn devsesh login command
      const cliProcess = spawnDevseshLogin(server.url, configPath);

      // Debug: check if process started at all
      cliProcess.process.on('error', (err) => {
        console.log('CLI process error:', err);
      });
      
      // Debug: wait and log output
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('CLI stdout:', cliProcess.stdout);
      console.log('CLI stderr:', cliProcess.stderr);
      console.log('CLI process pid:', cliProcess.process.pid);

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
      await enterPairingCode(page, server.url, pairingCode);

      // Wait for CLI process to complete successfully
      await waitForCliSuccess(cliProcess);

      // Verify config file was created with valid JWT
      expect(fs.existsSync(configPath)).toBeTruthy();
      const configContent = fs.readFileSync(configPath, 'utf8');
      expect(configContent).toContain('jwt_token:');
      
      // Extract JWT from config and verify it's not empty
      const jwtMatch = configContent.match(/jwt_token:\s*(\S+)/);
      expect(jwtMatch).toBeTruthy();
      expect(jwtMatch?.[1].length).toBeGreaterThan(0);

    } finally {
      // Clean up
      await stopServer(server);
      cleanupTestConfig(configPath);
    }
  });
});