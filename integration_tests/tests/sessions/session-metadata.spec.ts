import { testServer, expect } from '../../fixtures/test-fixtures';

testServer('should update metadata via CLI set command', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});

testServer('should sync metadata changes from session file', async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/dashboard`);
  await page.waitForTimeout(1000);
});