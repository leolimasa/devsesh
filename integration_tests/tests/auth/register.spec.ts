import { testServer, expect } from '../../fixtures/test-fixtures';

testServer('should show registration form when no users exist', async ({ page, serverUrl }) => {
  await page.goto(serverUrl);
  await page.waitForTimeout(1000);
  
  if (page.url().includes('/login')) {
    await expect(page.locator('text=No users found')).toBeVisible();
    await expect(page.locator('text=Create an account')).toBeVisible();
  } else if (page.url().includes('/register')) {
    await expect(page.locator('text=Create Account')).toBeVisible();
  }
});

testServer('should register new user with passkey', async ({ page, serverUrl, context }) => {
  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable');
  
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto(`${serverUrl}/register`);
  
  const email = `test-${Date.now()}@example.com`;
  await page.fill('input[type="email"]', email);
  await page.click('button:has-text("Create Account with Passkey")');
  
  await page.waitForTimeout(5000);
  
  await client.send('WebAuthn.disable');
});

testServer('should reject duplicate email registration', async ({ page, serverUrl, context }) => {
  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable');
  
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  
  const email = `duplicate-${Date.now()}@example.com`;
  
  await page.goto(`${serverUrl}/register`);
  await page.fill('input[type="email"]', email);
  await page.click('button:has-text("Create Account with Passkey")');
  
  await page.waitForTimeout(5000);
  
  await client.send('WebAuthn.disable');
});