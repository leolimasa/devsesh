import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import { spawnDevseshStart, waitForSessionInApi, killTmuxSession } from '../helpers/session';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Clipboard bridge (project 0017): `devsesh copy` -> POST /clipboard -> the
 * sessions-updates websocket -> an in-browser buffer -> the "Clipboard ready"
 * pill -> a user gesture (Copy button OR the flush hotkey) writes the OS
 * clipboard.
 *
 * This verifies the MECHANICS in Chromium. WebKit's clipboard-activation rules
 * (Safari/iOS) -- the reason for the buffer + synchronous-gesture design -- can
 * NOT be reproduced here and still need manual confirmation (see the manual
 * checklist in implementation.md). To avoid headless "Document is not focused"
 * flakiness on clipboard reads, we record navigator.clipboard.writeText calls
 * and assert the app wrote the right text in the gesture (which is the property
 * that matters); paste key-mapping + bracketed paste are covered by the
 * clipboardKeyAction/SessionTopBar unit tests, and tmux copy-command wiring by
 * the Go TestConfigureClipboardRealTmux.
 */
test.describe('Clipboard bridge', () => {
  test('pill + Copy button + flush hotkey write the OS clipboard; scoped + size-capped', async ({ page, context }) => {
    test.setTimeout(120000);
    const server = await startServer();
    const email = `clip-${Date.now()}@example.com`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-clip-'));
    const configPath = path.join(tempDir, 'config.yml');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    const names: string[] = [];

    // Equivalent to `devsesh copy`: POST the raw text to the clipboard endpoint.
    const pushClipboard = (sessionId: string, text: string, token: string) =>
      page.evaluate(
        async ({ url, sessionId, text, token }) => {
          const r = await fetch(`${url}/api/v1/sessions/${sessionId}/clipboard`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8', Authorization: `Bearer ${token}` },
            body: text,
          });
          return r.status;
        },
        { url: server.url, sessionId, text, token }
      );

    const lastWrite = () => page.evaluate(() => (window as unknown as { __clipWrites: string[] }).__clipWrites?.at(-1));

    try {
      const token = await setupPairedCli(page, server.url, email, configPath, sessionDir);
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });

      // Record clipboard writes so the assertion doesn't depend on headless
      // clipboard-read focus rules. Applies to the next navigation onward.
      await page.addInitScript(() => {
        (window as unknown as { __clipWrites: string[] }).__clipWrites = [];
        const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = (t: string) => {
          (window as unknown as { __clipWrites: string[] }).__clipWrites.push(t);
          return orig(t).catch(() => undefined);
        };
      });

      const nameA = `clip-a-${Date.now()}`;
      spawnDevseshStart(nameA, configPath, sessionDir, server.url);
      names.push(nameA);
      const a = await waitForSessionInApi(server.url, token, nameA, 30000);

      const nameB = `clip-b-${Date.now()}`;
      spawnDevseshStart(nameB, configPath, sessionDir, server.url);
      names.push(nameB);
      const b = await waitForSessionInApi(server.url, token, nameB, 30000);

      await page.goto(`${server.url}/sessions/${a.id}`);
      await expect(page).toHaveURL(new RegExp(`/sessions/${a.id}`), { timeout: 10000 });
      // The clipboard pill lives in the top bar, which requires the session to
      // have a host (a paired-CLI session does).
      await expect(page.getByTestId('session-detail-panel')).toBeVisible({ timeout: 15000 });

      const pill = page.getByTestId('clipboard-pill');

      // --- Copy end-to-end: push -> pill -> click Copy -> writeText(text) ---
      expect(await pushClipboard(a.id, 'hello clipboard', token)).toBe(204);
      await expect(pill).toBeVisible({ timeout: 10000 });
      await expect(pill).toContainText('Clipboard ready');
      await page.getByTestId('clipboard-copy').click();
      await expect(async () => expect(await lastWrite()).toBe('hello clipboard')).toPass({ timeout: 5000 });

      // Pill flips to "Copied" then auto-dismisses.
      await expect(pill).toBeHidden({ timeout: 5000 });

      // --- Scoping: a push for session B shows NO pill while viewing A ---
      expect(await pushClipboard(b.id, 'for session b', token)).toBe(204);
      await page.waitForTimeout(1000);
      await expect(pill).toBeHidden();

      // --- Size cap: oversize push -> 413 ---
      expect(await pushClipboard(a.id, 'a'.repeat(256 * 1024 + 1), token)).toBe(413);

      // --- Flush hotkey: push -> focus terminal -> Ctrl+Shift+C -> writeText ---
      // Desktop Chrome on Linux uses the non-mac shortcut.
      expect(await pushClipboard(a.id, 'via hotkey', token)).toBe(204);
      await expect(pill).toBeVisible({ timeout: 10000 });
      const textarea = page.locator('.xterm-helper-textarea');
      await textarea.waitFor({ state: 'attached', timeout: 15000 });
      await textarea.focus();
      await page.keyboard.press('Control+Shift+C');
      await expect(async () => expect(await lastWrite()).toBe('via hotkey')).toPass({ timeout: 5000 });
    } finally {
      for (const n of names) {
        try { killTmuxSession(n); } catch { /* ignore */ }
      }
      await stopServer(server);
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
