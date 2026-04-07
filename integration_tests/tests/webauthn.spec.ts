import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../helpers/server';
import { setupVirtualAuthenticator } from '../helpers/webauthn';

test('virtual authenticator can be set up without errors', async ({ page }) => {
  const server = await startServer();
  page.setExtraHTTPHeaders({});

  try {
    const { cdpSession, authenticatorId } = await setupVirtualAuthenticator(page);
    expect(authenticatorId).toBeDefined();
    expect(cdpSession).toBeDefined();
  } finally {
    await stopServer(server);
  }
});
