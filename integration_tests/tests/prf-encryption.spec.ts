import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../helpers/server';

test.describe('PRF Encryption Test', () => {
  test('PRF returns results during registration with eval extension', async ({ page, context }) => {
    // 1. Create virtual authenticator with PRF support
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send('WebAuthn.enable');

    const result = await cdpSession.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        hasPrf: true,
      },
    });

    console.log('Virtual authenticator created:', result.authenticatorId);

    // Start a real server for proper origin
    const server = await startServer();

    try {
      await page.goto(`${server.url}/register`);

      // Test WebAuthn registration with PRF eval extension
      const testResult = await page.evaluate(async () => {
        try {
          // Create a test credential with PRF eval extension (includes salt)
          const prfSalt = new TextEncoder().encode('devsesh-master-key-v1');

          const publicKey: PublicKeyCredentialCreationOptions = {
            challenge: new Uint8Array(32).fill(1),
            rp: { name: 'Test RP', id: window.location.hostname },
            user: {
              id: new Uint8Array(16).fill(2),
              name: 'test@example.com',
              displayName: 'Test User'
            },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: { userVerification: 'required' },
            extensions: {
              prf: {
                eval: {
                  first: prfSalt.buffer
                }
              }
            } as AuthenticationExtensionsClientInputs
          };

          console.log('Creating credential with PRF eval extension...');
          const credential = await navigator.credentials.create({ publicKey });

          if (!credential) {
            return { success: false, error: 'No credential returned' };
          }

          // Check if PRF extension is present
          const extensions = (credential as PublicKeyCredential).getClientExtensionResults();
          console.log('Extensions:', JSON.stringify(extensions, (k, v) =>
            v instanceof ArrayBuffer ? `ArrayBuffer(${v.byteLength})` : v
          ));

          const prfExt = (extensions as any).prf;

          if (!prfExt) {
            return {
              success: false,
              error: 'No PRF extension in results',
              extensions: Object.keys(extensions)
            };
          }

          // Check if PRF is enabled
          if (prfExt.enabled !== undefined) {
            console.log('PRF enabled:', prfExt.enabled);
          }

          // Check if we got results
          if (!prfExt.results?.first) {
            return {
              success: false,
              error: 'No PRF results.first returned',
              prfEnabled: prfExt.enabled,
              prfKeys: Object.keys(prfExt)
            };
          }

          // Get PRF output
          const prfOutput = prfExt.results.first instanceof ArrayBuffer
            ? new Uint8Array(prfExt.results.first)
            : new Uint8Array(prfExt.results.first);

          console.log('PRF output length:', prfOutput.length);

          return {
            success: true,
            prfOutputLength: prfOutput.length,
            prfEnabled: prfExt.enabled
          };

        } catch (error: any) {
          console.error('Test error:', error);
          return { success: false, error: error.message || String(error) };
        }
      });

      console.log('Test result:', JSON.stringify(testResult, null, 2));

      // Assertions
      expect(testResult.success).toBe(true);

      if (!testResult.success) {
        throw new Error(`PRF test failed: ${JSON.stringify(testResult)}`);
      }

      expect(testResult.prfOutputLength).toBe(32);

    } finally {
      await stopServer(server);
    }
  });
});