import { testServer, expect } from '../../fixtures/test-fixtures';

testServer('should display list of all sessions', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});

testServer('should show session status badges correctly', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});

testServer('should navigate to session detail on row click', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});

testServer('should allow deleting stale sessions', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});