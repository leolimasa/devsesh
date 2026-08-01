import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import { spawnDevseshStart, waitForSessionInApi, killTmuxSession } from '../helpers/session';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Sessions carry a user-controlled `seq` that drives display order on the
// dashboard and in the detail panel, persisted via POST /sessions/reorder
// (what the drag-and-drop UI calls on drop). The DnD interaction itself is
// covered by the useDragReorder unit test; here we prove the full stack:
// seq ordering renders, and a reorder persists across a reload.
test.describe('Session reorder', () => {
  test('sessions render in seq order and a reorder persists', async ({ page }) => {
    test.setTimeout(120000);
    const server = await startServer();
    const testEmail = `reorder-${Date.now()}@example.com`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-reorder-test-'));
    const configPath = path.join(tempDir, 'config.yml');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const names = ['reorder-one', 'reorder-two', 'reorder-three'];

    // Read the dashboard row order as a list of session ids (top to bottom).
    const rowOrder = () =>
      page.locator('tbody a[href^="/sessions/"]').evaluateAll((els) =>
        els.map((e) => (e.getAttribute('href') || '').replace('/sessions/', ''))
      );

    try {
      const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);

      // Start three sessions in a known order. seq appends, so the first created
      // gets seq 0 (top) ... the last gets seq 2 (bottom).
      const ids: string[] = [];
      for (const name of names) {
        spawnDevseshStart(name, configPath, sessionDir, server.url);
        const s = await waitForSessionInApi(server.url, token, name, 30000);
        expect(typeof s.seq).toBe('number');
        ids.push(s.id);
      }

      await page.goto(`${server.url}/dashboard`);
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });

      // Initial order is creation order (seq 0,1,2).
      expect(await rowOrder()).toEqual(ids);

      // Reorder to reverse via the same endpoint the drop handler calls.
      const reversed = [...ids].reverse();
      const status = await page.evaluate(
        async ({ url, tok, order }) => {
          const r = await fetch(`${url}/api/v1/sessions/reorder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
            body: JSON.stringify({ session_ids: order }),
          });
          return r.status;
        },
        { url: server.url, tok: token, order: reversed }
      );
      expect(status).toBe(204);

      // The new order survives a full reload (persisted seq, sorted server-side).
      await page.reload();
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });
      expect(await rowOrder()).toEqual(reversed);

      // And the API itself returns sessions in the persisted order.
      const apiOrder = await page.evaluate(
        async ({ url, tok }) => {
          const r = await fetch(`${url}/api/v1/sessions`, { headers: { Authorization: `Bearer ${tok}` } });
          const list = await r.json();
          return list.map((s: { id: string }) => s.id);
        },
        { url: server.url, tok: token }
      );
      expect(apiOrder).toEqual(reversed);
    } finally {
      for (const name of names) {
        try { killTmuxSession(name); } catch { /* ignore */ }
      }
      await stopServer(server);
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
