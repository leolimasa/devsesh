import { test, expect, Page } from '@playwright/test';
import { startServer, stopServer } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import { spawnDevseshStart, waitForSessionInApi, killTmuxSession } from '../helpers/session';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * PWA installability + the PWA-only Ctrl+Number session shortcut.
 *
 * The manifest/service-worker/icons are served from the embedded web bundle, so
 * this exercises the real production assets. The shortcut is gated to standalone
 * (installed-PWA) mode, which we emulate by overriding matchMedia via an init
 * script — a browser tab reserves Ctrl+Number, an installed PWA does not.
 */
test.describe('PWA', () => {
  test('serves the web app manifest, service worker and icons', async ({ page }) => {
    const server = await startServer();
    try {
      const manifestRes = await page.request.get(`${server.url}/manifest.webmanifest`);
      expect(manifestRes.status()).toBe(200);
      expect(manifestRes.headers()['content-type']).toContain('manifest');
      const manifest = await manifestRes.json();
      expect(manifest.display).toBe('standalone');
      expect(manifest.start_url).toBeTruthy();
      expect(manifest.name).toBe('devsesh');
      expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeTruthy();
      // A maskable icon is present.
      expect(manifest.icons.some((i: any) => (i.purpose || '').includes('maskable'))).toBe(true);

      const swRes = await page.request.get(`${server.url}/sw.js`);
      expect(swRes.status()).toBe(200);
      expect(swRes.headers()['content-type']).toContain('javascript');
      expect(await swRes.text()).toContain('addEventListener');

      const iconRes = await page.request.get(`${server.url}/icons/icon-192.png`);
      expect(iconRes.status()).toBe(200);
      expect(iconRes.headers()['content-type']).toContain('image/png');
    } finally {
      await stopServer(server);
    }
  });

  // Make matchMedia('(display-mode: standalone)') report true for this page,
  // simulating an installed PWA.
  async function forceStandalone(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const orig = window.matchMedia.bind(window);
      // @ts-expect-error override for test
      window.matchMedia = (q: string) =>
        q.includes('display-mode: standalone')
          ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }
          : orig(q);
    });
  }

  async function setupTwoSessions(page: Page) {
    const server = await startServer();
    const testEmail = `pwa-${Date.now()}@example.com`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-pwa-'));
    const configPath = path.join(tempDir, 'config.yml');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);

    const names = [`pwa-a-${Date.now()}`, `pwa-b-${Date.now()}`];
    for (const name of names) {
      spawnDevseshStart(name, configPath, sessionDir, server.url);
      await waitForSessionInApi(server.url, token, name, 30000);
    }
    // The sidebar order matches this API list order (both hit GET /sessions).
    const list = await (await fetch(`${server.url}/api/v1/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();

    return { server, token, tempDir, names, list };
  }

  test('Ctrl+Number switches sessions when running as an installed PWA', async ({ page }) => {
    let server: Awaited<ReturnType<typeof startServer>> | null = null;
    let tempDir = '';
    let names: string[] = [];
    try {
      await forceStandalone(page);
      const ctx = await setupTwoSessions(page);
      server = ctx.server; tempDir = ctx.tempDir; names = ctx.names;
      const firstId = ctx.list[0].id as string;
      const secondId = ctx.list[1].id as string;

      // Land on the first session.
      await page.goto(`${server.url}/sessions/${firstId}`);
      await expect(page.getByTestId('session-detail-panel')).toBeVisible({ timeout: 15000 });

      // Ctrl+2 -> the 2nd session in the list.
      await page.keyboard.press('Control+2');
      await expect(page).toHaveURL(new RegExp(`/sessions/${secondId}`), { timeout: 10000 });

      // Ctrl+1 -> back to the 1st.
      await page.keyboard.press('Control+1');
      await expect(page).toHaveURL(new RegExp(`/sessions/${firstId}`), { timeout: 10000 });
    } finally {
      for (const n of names) { try { await killTmuxSession(n); } catch { /* ignore */ } }
      if (server) await stopServer(server);
      if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('does not intercept Ctrl+Number in a normal browser tab', async ({ page }) => {
    let server: Awaited<ReturnType<typeof startServer>> | null = null;
    let tempDir = '';
    let names: string[] = [];
    try {
      // NB: no forceStandalone — this is a normal tab.
      const ctx = await setupTwoSessions(page);
      server = ctx.server; tempDir = ctx.tempDir; names = ctx.names;
      const firstId = ctx.list[0].id as string;

      await page.goto(`${server.url}/sessions/${firstId}`);
      await expect(page.getByTestId('session-detail-panel')).toBeVisible({ timeout: 15000 });

      await page.keyboard.press('Control+2');
      // The shortcut is disabled outside standalone mode: URL stays put.
      await page.waitForTimeout(1500);
      await expect(page).toHaveURL(new RegExp(`/sessions/${firstId}`));
    } finally {
      for (const n of names) { try { await killTmuxSession(n); } catch { /* ignore */ } }
      if (server) await stopServer(server);
      if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
