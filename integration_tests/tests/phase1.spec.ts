import * as fs from 'fs';
import { testServer, expect } from '../fixtures/test-fixtures';

testServer('should start and stop server with temp database', async ({ server }) => {
  expect(server.url).toBeTruthy();
  expect(server.dbPath).toBeTruthy();
  expect(fs.existsSync(server.dbPath)).toBe(true);
});

testServer('should verify server is running', async ({ page, serverUrl }) => {
  await page.goto(serverUrl);
  const title = await page.title();
  expect(title).toBeTruthy();
});