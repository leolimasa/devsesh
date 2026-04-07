import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../helpers/server';

test('server starts and stops successfully', async () => {
  const server = await startServer();
  expect(server.url).toBeDefined();
  expect(server.port).toBeGreaterThan(0);

  const response = await fetch(`${server.url}/api/v1/auth/status`);
  expect(response.ok).toBe(true);

  const data = await response.json();
  expect(data).toHaveProperty('exists');

  await stopServer(server);
});
