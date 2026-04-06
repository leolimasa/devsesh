import { BrowserContext, CDPSession } from '@playwright/test';

export interface VirtualAuthenticatorConfig {
  protocol: 'ctap2' | 'u2f';
  transport: 'internal' | 'usb' | 'ble' | 'nfc';
  hasUserVerification: boolean;
  isUserVerified: boolean;
}

const defaultConfig: VirtualAuthenticatorConfig = {
  protocol: 'ctap2',
  transport: 'internal',
  hasUserVerification: true,
  isUserVerified: true,
};

let authenticatorId: string | null = null;

export async function setupVirtualAuthenticator(
  context: BrowserContext,
  config: VirtualAuthenticatorConfig = defaultConfig
): Promise<CDPSession> {
  const cdp = await context.newCDPSession(context.pages()[0]);
  
  await cdp.send('WebAuthn.enable');
  
  const result = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: config,
  });
  
  authenticatorId = result.authenticatorId;
  
  return cdp;
}

export async function removeVirtualAuthenticator(cdp: CDPSession): Promise<void> {
  if (authenticatorId) {
    try {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', {
        authenticatorId,
      });
    } catch {
    }
    authenticatorId = null;
  }
  
  try {
    await cdp.send('WebAuthn.disable');
  } catch {
  }
}