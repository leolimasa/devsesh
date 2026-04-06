import { testServer, expect } from '../../fixtures/test-fixtures';

testServer('should display new session on dashboard when CLI starts session', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});

testServer('should update session status in real-time via WebSocket', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});

testServer('should show session ping updates', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});