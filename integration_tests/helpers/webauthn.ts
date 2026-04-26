import { Page, BrowserContext } from '@playwright/test';

export interface VirtualAuthenticatorResult {
  cdpSession: import('@playwright/test').CDPSession;
  authenticatorId: string;
}

/**
 * Set up a virtual WebAuthn authenticator with PRF support.
 * Uses CDP directly since the high-level Playwright API doesn't support PRF.
 * Can accept either a Page or a BrowserContext.
 */
export async function setupVirtualAuthenticator(pageOrContext: Page | BrowserContext, page?: Page): Promise<VirtualAuthenticatorResult> {
  // Determine the page to use for CDP session
  const targetPage = page || (pageOrContext as Page);
  const context = 'context' in pageOrContext ? (pageOrContext as Page).context() : pageOrContext as BrowserContext;

  // Use CDP API directly - the high-level Playwright API doesn't support hasPrf
  const cdpSession = await context.newCDPSession(targetPage);

  await cdpSession.send('WebAuthn.enable');

  const result = await cdpSession.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true, // Enable PRF (hmac-secret) extension
    },
  });

  return {
    cdpSession,
    authenticatorId: result.authenticatorId,
  };
}
