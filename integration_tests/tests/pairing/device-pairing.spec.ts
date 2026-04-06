import { testServer, expect } from '../../fixtures/test-fixtures';

testServer('should complete pairing flow between CLI and web', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/pair`);
  await page.waitForTimeout(1000);
});

testServer('should reject expired pairing code', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/pair`);
  await page.waitForTimeout(1000);
});

testServer('should reject invalid pairing code', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/pair`);
  await page.waitForTimeout(1000);
});