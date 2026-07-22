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
export interface VirtualAuthenticatorOptions {
  // Simulate a synced/backup-eligible passkey (iCloud Keychain, Google Password
  // Manager) which always sets BE=1 (and usually BS=1) in authenticator data.
  backupEligible?: boolean;
  backupState?: boolean;
}

export async function setupVirtualAuthenticator(
  pageOrContext: Page | BrowserContext,
  page?: Page,
  options?: VirtualAuthenticatorOptions,
): Promise<VirtualAuthenticatorResult> {
  // Determine the page to use for CDP session
  const targetPage = page || (pageOrContext as Page);
  const context = 'context' in pageOrContext ? (pageOrContext as Page).context() : pageOrContext as BrowserContext;

  // Use CDP API directly - the high-level Playwright API doesn't support hasPrf
  const cdpSession = await context.newCDPSession(targetPage);

  await cdpSession.send('WebAuthn.enable');

  // Only include the backup keys when requested so existing callers keep their
  // exact previous behavior (and don't depend on newer CDP fields).
  const authenticatorOptions: Record<string, unknown> = {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    hasPrf: true, // Enable PRF (hmac-secret) extension
  };
  if (options?.backupEligible !== undefined) {
    authenticatorOptions.defaultBackupEligibility = options.backupEligible;
  }
  if (options?.backupState !== undefined) {
    authenticatorOptions.defaultBackupState = options.backupState;
  }

  const result = await cdpSession.send('WebAuthn.addVirtualAuthenticator', {
    options: authenticatorOptions,
  });

  return {
    cdpSession,
    authenticatorId: result.authenticatorId,
  };
}
