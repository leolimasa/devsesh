import { testServer, expect } from '../../fixtures/test-fixtures';

testServer('should show error for non-existent user', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/login`);
  await page.fill('input[type="email"]', 'nonexistent@example.com');
  await page.click('button:has-text("Sign in with Passkey")');
  
  await page.waitForTimeout(5000);
  
  const hasError = await page.locator('text=Login failed').count() > 0 || 
                   await page.locator('.text-red-500').count() > 0;
  expect(hasError).toBeTruthy();
});

testServer('should redirect to login when users exist', async ({ page, serverUrl, context }) => {
  await page.goto(serverUrl);
  await page.waitForTimeout(2000);
  
  const currentUrl = page.url();
  expect(currentUrl.includes('/login') || currentUrl.includes('/register')).toBeTruthy();
});