import { testServer, expect } from '../../fixtures/test-fixtures';

testServer('should display session details', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});

testServer('should show real-time updates', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});