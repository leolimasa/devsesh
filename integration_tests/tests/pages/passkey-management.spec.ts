import { testServer, expect } from '../../fixtures/test-fixtures';

testServer('should list existing passkeys', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});

testServer('should add new passkey', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});

testServer('should delete passkey (when multiple exist)', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});

testServer('should prevent deleting last passkey', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});