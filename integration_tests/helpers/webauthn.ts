import { Page } from '@playwright/test';

export interface VirtualAuthenticatorResult {
  cdpSession: import('@playwright/test').CDPSession;
  authenticatorId: string;
}

export async function setupVirtualAuthenticator(page: Page): Promise<VirtualAuthenticatorResult> {
  const cdpSession = await page.context().newCDPSession(page);

  await cdpSession.send('WebAuthn.enable');

  const result = await cdpSession.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  return {
    cdpSession,
    authenticatorId: result.authenticatorId,
  };
}
