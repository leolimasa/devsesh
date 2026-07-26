import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import {
  spawnDevseshStart,
  waitForSessionInApi,
  waitForSessionFile,
  killTmuxSession,
  updateSessionYamlFile,
  sendTmuxCommand,
} from '../helpers/session';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * End-to-end coverage for the desktop session detail panel (feature 0016):
 *   - the Details tab renders the session fields correctly,
 *   - the panel header shows the session name + live status,
 *   - the Sessions tab lists every session with index/status,
 *   - websocket 'meta' events update the RIGHT field (viewed session and the
 *     matching list row, not others), with no page reload,
 *   - clicking a session in the Sessions tab loads its detail URL.
 *
 * The panel is desktop-only (`hidden md:block`); Playwright's default 1280px
 * viewport renders it, so no viewport override is needed.
 */
test.describe('Session detail panel (desktop)', () => {
  test('Details tab shows fields; websocket updates the Status field and panel header live', async ({ page }) => {
    const server = await startServer();
    const testEmail = `test-${Date.now()}@example.com`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-panel-details-'));
    const configPath = path.join(tempDir, 'config.yml');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    let sessionId: string | null = null;
    let tmuxSessionName: string | null = null;
    try {
      const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);

      tmuxSessionName = `panel-details-${Date.now()}`;
      const proc = spawnDevseshStart(tmuxSessionName, configPath, sessionDir, server.url);
      proc.process.on('error', (err) => console.log('Session process error:', err));

      sessionId = await waitForSessionFile(sessionDir, 15000);
      await waitForSessionInApi(server.url, token, tmuxSessionName, 60000);

      // Open the detail page once and keep it open (exercise live websocket).
      await page.goto(`${server.url}/sessions/${sessionId}`);
      await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}`), { timeout: 10000 });

      const panel = page.getByTestId('session-detail-panel');
      await expect(panel).toBeVisible({ timeout: 10000 });

      // The panel no longer repeats the current session's name/status in a
      // header — that info lives in the Details tab and the Sessions list.
      await expect(page.getByTestId('panel-session-name')).toHaveCount(0);
      await expect(page.getByTestId('panel-status')).toHaveCount(0);
      // The standalone "Details" heading must also be gone from the panel
      // (exact match: the session name may itself contain "details").
      await expect(panel.getByRole('heading', { name: 'Details', exact: true })).toHaveCount(0);

      // Details tab is the default: verify the classic fields render correctly.
      await expect(page.locator('h3:text-is("Name") + p')).toHaveText(tmuxSessionName);
      await expect(page.locator('h3:text-is("Session Hash") + p')).toHaveText(sessionId!);
      await expect(page.locator('h3:text-is("Status") + p')).toHaveText('-');
      await expect(page.locator('h3:text-is("Last Ping") + p')).not.toHaveText('-');
      // Host field is populated (the paired CLI session has a host).
      await expect(page.locator('h3:text-is("Host") + p')).not.toHaveText('-');

      // Drive a status change via the session YAML -> watcher -> server -> ws
      // 'meta'. The Details "Status" field must update WITHOUT a reload.
      updateSessionYamlFile(sessionDir, sessionId!, 'status', 'deploying');
      await expect(page.locator('h3:text-is("Status") + p')).toHaveText('deploying', { timeout: 15000 });
    } finally {
      if (tmuxSessionName) await killTmuxSession(tmuxSessionName);
      await stopServer(server);
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('Sessions tab lists all sessions, updates the right one via websocket, and navigates on click', async ({ page }) => {
    const server = await startServer();
    const testEmail = `test-${Date.now()}@example.com`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-panel-sessions-'));
    const configPath = path.join(tempDir, 'config.yml');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    const tmuxNames: string[] = [];
    try {
      const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);

      // Start two independent sessions so the Sessions tab has a list.
      const nameA = `panel-a-${Date.now()}`;
      const procA = spawnDevseshStart(nameA, configPath, sessionDir, server.url);
      procA.process.on('error', (err) => console.log('Session A error:', err));
      tmuxNames.push(nameA);
      const sessionA = await waitForSessionInApi(server.url, token, nameA, 60000);
      const idA = sessionA.id;

      const nameB = `panel-b-${Date.now()}`;
      const procB = spawnDevseshStart(nameB, configPath, sessionDir, server.url);
      procB.process.on('error', (err) => console.log('Session B error:', err));
      tmuxNames.push(nameB);
      const sessionB = await waitForSessionInApi(server.url, token, nameB, 60000);
      const idB = sessionB.id;

      // View session A's detail page and open the Sessions tab.
      await page.goto(`${server.url}/sessions/${idA}`);
      await expect(page).toHaveURL(new RegExp(`/sessions/${idA}`), { timeout: 10000 });
      await expect(page.getByTestId('session-detail-panel')).toBeVisible({ timeout: 10000 });

      await page.getByRole('tab', { name: 'Sessions' }).click();

      // Both sessions are listed, each in its own row.
      const itemA = page.getByTestId(`session-item-${idA}`);
      const itemB = page.getByTestId(`session-item-${idB}`);
      await expect(itemA).toBeVisible({ timeout: 10000 });
      await expect(itemB).toBeVisible({ timeout: 10000 });
      await expect(itemA).toContainText(nameA);
      await expect(itemB).toContainText(nameB);

      // 1-based indices are rendered inside the panel (Details fields are not,
      // since the Sessions tab is active — so bare "1"/"2" are the indices).
      const panel = page.getByTestId('session-detail-panel');
      await expect(panel.getByText('1', { exact: true })).toBeVisible();
      await expect(panel.getByText('2', { exact: true })).toBeVisible();

      // Each row shows an activity indicator (green when active, gray otherwise).
      await expect(itemA.locator('[aria-label="active"], [aria-label="inactive"]')).toHaveCount(1);

      // Both status sublines start empty.
      await expect(itemA.locator('[data-status]')).toHaveText('-');
      await expect(itemB.locator('[data-status]')).toHaveText('-');

      // Update ONLY session B's status via YAML -> ws 'meta'. The list must
      // update B's subline live and leave A's untouched (right field only).
      updateSessionYamlFile(sessionDir, idB, 'status', 'running-b');
      await expect(itemB.locator('[data-status]')).toHaveText('running-b', { timeout: 15000 });
      await expect(itemA.locator('[data-status]')).toHaveText('-');

      // Trigger real terminal activity on B and confirm its dot flips to active.
      await sendTmuxCommand(nameB, 'echo panel-noise');
      await expect(itemB.locator('[aria-label="active"]')).toHaveCount(1, { timeout: 15000 });

      // Clicking session B's row loads B's detail URL, and B becomes the
      // highlighted (current) row in the Sessions list.
      await itemB.click();
      await expect(page).toHaveURL(new RegExp(`/sessions/${idB}`), { timeout: 10000 });
      await expect(page.getByTestId(`session-item-${idB}`)).toHaveAttribute('aria-current', 'true', { timeout: 10000 });
    } finally {
      for (const name of tmuxNames) await killTmuxSession(name);
      await stopServer(server);
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
