import { test, expect, BrowserContext, Page } from '@playwright/test';
import { startServer, stopServer, ServerInstance } from '../../helpers/server';
import { setupVirtualAuthenticator } from '../../helpers/webauthn';
import { registerUser, loginUser } from '../../helpers/auth';
import { getUserIdByEmail, getCredentialCountForUser, waitForEnrollmentSuccess } from '../../helpers/enrollment';

test.describe('Passkey Enrollment Flow', () => {
  test('Full passkey enrollment flow between two devices', async ({ browser }) => {
    const server = await startServer();
    const testEmail = `enrollment-test-${Date.now()}@example.com`;
    let machineAContext: BrowserContext | null = null;
    let machineBContext: BrowserContext | null = null;
    let machineAPage: Page | null = null;
    let machineBPage: Page | null = null;

    try {
      machineAContext = await browser.newContext();
      machineBContext = await browser.newContext();

      machineAPage = await machineAContext.newPage();
      machineBPage = await machineBContext.newPage();

      // Add console listeners early to capture all logs
      machineAPage.on('console', msg => {
        console.log(`Machine A [${msg.type()}]:`, msg.text());
      });
      machineBPage.on('console', msg => {
        console.log(`Machine B [${msg.type()}]:`, msg.text());
      });

      await setupVirtualAuthenticator(machineAContext, machineAPage);
      await setupVirtualAuthenticator(machineBContext, machineBPage);

      await registerUser(machineAPage, server.url, testEmail);
      const token = await loginUser(machineAPage, server.url, testEmail);

      // Start enrollment on Machine B FIRST (Mb must connect before Ma)
      await machineBPage.goto(`${server.url}/passkeys/enroll`);
      await expect(machineBPage.getByRole('heading', { name: 'Register Passkey' })).toBeVisible();

      const startButton = machineBPage.getByRole('button', { name: 'Start Enrollment' });
      await expect(startButton).toBeVisible();
      await startButton.click();

      // Wait for enrollment code to appear and WebSocket to be established
      const codeElement = machineBPage.locator('p.text-3xl');
      await expect(codeElement).toBeVisible({ timeout: 5000 });
      const codeText = await codeElement.textContent();
      if (!codeText) {
        throw new Error('Enrollment code not found');
      }
      const cleanCode = codeText.replace(/-/g, '');

      // Wait for WebSocket connection on Machine B
      await expect(machineBPage.locator('text=/Waiting for other device|Performing key exchange|Creating passkey/')).toBeVisible({ timeout: 5000 });

      // Now navigate Machine A to the add page and enter the code
      await machineAPage.goto(`${server.url}/passkeys/add`);
      await expect(machineAPage.getByRole('heading', { name: 'Add Passkey' })).toBeVisible();
      
      // Wait for the page to be fully loaded and token to be available
      await machineAPage.waitForLoadState('domcontentloaded');
      await machineAPage.waitForTimeout(1000);
      
      // Verify token is available before proceeding
      const tokenBefore = await machineAPage.evaluate(() => window.localStorage.getItem('token'));
      console.log('Token before entering code:', tokenBefore ? 'present' : 'null');
      console.log('Token value (first 50 chars):', tokenBefore?.substring(0, 50) || 'N/A');
      console.log('Token value length:', tokenBefore?.length || 0);
      
      // Test the auth-begin endpoint directly with the token
      console.log('Testing with token:', tokenBefore);
      console.log('Token header (first part before .):', tokenBefore?.split('.')[0]);
      
      const directTestResponse = await machineAPage.request.post(`${server.url}/api/v1/auth/passkeys/auth-begin`, {
        headers: {
          'Authorization': `Bearer ${tokenBefore}`
        }
      });
      console.log('Direct auth-begin test status:', directTestResponse.status());
      console.log('Direct auth-begin test body:', await directTestResponse.text());
      
      // Test a different protected endpoint to compare
      const listPasskeysResponse = await machineAPage.request.get(`${server.url}/api/v1/auth/passkeys`, {
        headers: {
          'Authorization': `Bearer ${tokenBefore}`
        }
      });
      console.log('List passkeys test status:', listPasskeysResponse.status());
      console.log('List passkeys test body:', await listPasskeysResponse.text());
      
      const formattedCode = cleanCode.length > 4
        ? cleanCode.slice(0, 4) + '-' + cleanCode.slice(4)
        : cleanCode;

      const codeInput = machineAPage.locator('input[id="code"]');
      await expect(codeInput).toBeVisible();
      await codeInput.fill(formattedCode);

      const linkButton = machineAPage.getByRole('button', { name: 'Link Device' });
      await expect(linkButton).toBeVisible();
      await machineAPage.waitForLoadState('networkidle');
      
      // Add response listener before clicking
      const responses: string[] = [];
      machineAPage.on('response', response => {
        if (response.url().includes('/api/v1')) {
          responses.push(`${response.status()} ${response.url()}`);
        }
      });
      
      // Add console listener for the debug logs
      machineAPage.on('console', msg => {
        console.log(`Machine A [${msg.type()}]:`, msg.text());
      });
      
      // Try clicking with force and waiting for network
      await linkButton.click({ force: true });

      // Machine B now waits for an explicit user gesture before running the
      // WebAuthn ceremony (transient-activation fix for Safari/iOS): after the
      // handshake + master-key transfer it shows a "Create Passkey" button.
      // Assert that gesture step exists and drive it.
      const createPasskeyButton = machineBPage.getByRole('button', { name: 'Create Passkey' });
      await expect(createPasskeyButton).toBeVisible({ timeout: 15000 });
      await createPasskeyButton.click();

      // Wait a bit and check for responses
      await machineAPage.waitForTimeout(3000);
      
      console.log('API responses after click:', responses);
      console.log('Current URL after click:', machineAPage.url());
      
      // Check if the page navigated (indicating auth error and redirect)
      if (machineAPage.url().includes('/login')) {
        console.log('Page redirected to /login - this indicates authentication failure');
      }
      
      // Wait a moment for the WebAuthn authentication to complete
      await machineAPage.waitForTimeout(2000);
      
      // Debug: Check page state in detail
      const pageState = await machineAPage.evaluate(() => {
        const errorEl = document.querySelector('.text-red-500');
        const statusCards = document.querySelectorAll('.p-3');
        const cards = Array.from(statusCards).map(c => ({ text: c.textContent, classes: c.className }));
        return {
          url: window.location.href,
          errorElText: errorEl ? errorEl.textContent : null,
          errorElClasses: errorEl ? errorEl.className : null,
          cards: cards,
          statusText: Array.from(document.querySelectorAll('p')).filter(p => p.textContent?.includes('error') || p.textContent?.includes('Error')).map(p => p.textContent)
        };
      });
      console.log('Page state after click:', JSON.stringify(pageState, null, 2));
      
      // Debug: capture state after clicking
      const pageContentAfterClick = await machineAPage.content();
      console.log('Machine A has "Verifying" text:', pageContentAfterClick.includes('Verifying'));
      console.log('Machine A has "Connecting" text:', pageContentAfterClick.includes('Connecting'));
      console.log('Machine A has "error" text:', pageContentAfterClick.toLowerCase().includes('error'));
      
      // Debug: capture console logs and network errors
      machineAPage.on('console', msg => {
        console.log(`Machine A [${msg.type()}]:`, msg.text());
      });
      machineBPage.on('console', msg => {
        console.log(`Machine B [${msg.type()}]:`, msg.text());
      });

      machineAPage.on('response', response => {
        if (response.status() >= 400) {
          console.log(`Machine A HTTP ${response.status()}: ${response.url()}`);
        }
      });

      // Wait for the enrollment process to complete
      // Poll for success or error status instead of using helper
      const maxWait = 30000;
      const startTime = Date.now();
      let success = false;
      let errorStatus = false;
      
      while (Date.now() - startTime < maxWait) {
        const successEl = machineAPage.locator('text=Passkey added successfully!');
        const errorEl = machineAPage.locator('.p-3.rounded-md.text-red');
        
        if (await successEl.isVisible({ timeout: 100 }).catch(() => false)) {
          success = true;
          break;
        }
        
        if (await errorEl.isVisible({ timeout: 100 }).catch(() => false)) {
          errorStatus = true;
          break;
        }
        
        await machineAPage.waitForTimeout(500);
      }
      
      // Debug: capture state
      const localStorageData = await machineAPage.evaluate(() => {
        return {
          token: !!window.localStorage.getItem('token'),
          user: window.localStorage.getItem('user')
        };
      });
      console.log('Machine A localStorage:', JSON.stringify(localStorageData));
      
      const pageContent = await machineAPage.content();
      console.log('Machine A page has success text:', pageContent.includes('Passkey added successfully'));
      console.log('Machine A page has error text:', pageContent.includes('error'));
      
      if (errorStatus) {
        const errorText = await machineAPage.locator('.text-red-500').allTextContents();
        console.log('Machine A error text (text-red-500):', errorText);
        throw new Error('Enrollment failed: ' + errorText.join(', '));
      }
      
      expect(success).toBe(true);

      const userId = await getUserIdByEmail(server.dbPath, testEmail);
      if (userId === null) {
        throw new Error('User not found in database');
      }

      const credentialCount = await getCredentialCountForUser(server.dbPath, userId);
      expect(credentialCount).toBeGreaterThan(0);

    } finally {
      if (machineAContext) {
        await machineAContext.close();
      }
      if (machineBContext) {
        await machineBContext.close();
      }
      await stopServer(server);
    }
  });
});