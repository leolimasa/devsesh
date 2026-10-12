import { test, expect, Page } from '@playwright/test';
import { startServer, stopServer, ServerInstance } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import { spawnDevseshStart, waitForSessionInApi, killTmuxSession } from '../helpers/session';
import { startSSHContainer, stopSSHContainer, createTmuxSession, SSHContainer } from '../helpers/ssh-container';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * "Connecting" is slow and sometimes never finishes. Two causes, both about how the
 * browser's SSH connections live and die when you move around the app:
 *
 * 1. Opening a session from the dashboard (or any route change that remounts the
 *    terminal) tore every SSH connection down and then built a brand new one for
 *    the next session: a new WebSocket, the server dialing the host, a new
 *    certificate (FROST signing) and a new unlock. Several seconds each time, even
 *    for sessions on the SAME host. Switching inside the Sessions pane already
 *    reused the connection; going through the dashboard did not.
 *
 * 2. The browser runs one SSH handshake at a time (a global lock) and holds it
 *    while it waits for the unlock to be answered. Leaving the page mid-unlock
 *    closed the socket but not that wait, so the next session's connect sat at
 *    "Connecting" until the old wait timed out (up to 60 s, or forever for a
 *    password prompt).
 *
 * Both run against one sshd container; the server's proxy log tells us how many
 * connections the browser actually opened.
 */

const CONTAINER_NAME = 'devsesh-reuse-test';
// A port no other spec uses (2222-2226, 2231-2235 are taken).
const CONTAINER_PORT = 2236;

interface Ctx {
  server: ServerInstance;
  container: SSHContainer;
  tempDir: string;
  sessionDir: string;
  names: string[];
  ids: string[];
  stats: { opens: number; closes: number; refused: number };
}

async function clickButtonWithText(page: Page, text: string) {
  await page.evaluate((t) => {
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent?.includes(t)) {
        (btn as HTMLButtonElement).click();
        return;
      }
    }
  }, text);
}

// Wait for the unlock dialog (or the password field) to show up. Returns false if
// it does not appear within `timeout`.
async function unlockPromptAppears(page: Page, timeout: number): Promise<boolean> {
  const usePassword = page.locator('button:has-text("Use Password Instead")');
  const passwordInput = page.locator('input[type="password"]');
  return Promise.race([
    usePassword.waitFor({ state: 'visible', timeout }).then(() => true),
    passwordInput.waitFor({ state: 'visible', timeout }).then(() => true),
  ]).catch(() => false);
}

// Answer the unlock prompt with the container's password.
async function unlockWithPassword(page: Page, timeout = 15000): Promise<boolean> {
  if (!(await unlockPromptAppears(page, timeout))) return false;
  const passwordInput = page.locator('input[type="password"]');
  if (!(await passwordInput.isVisible().catch(() => false))) {
    await clickButtonWithText(page, 'Use Password Instead');
    await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
  }
  await passwordInput.fill('testpass');
  await passwordInput.press('Enter');
  return true;
}

const connected = (page: Page) => page.getByText('Connected', { exact: true });

async function setup(page: Page, label: string, sessions: number): Promise<Ctx> {
  const server = await startServer();
  const stats = { opens: 0, closes: 0, refused: 0 };
  server.process.stdout?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) {
      if (line.includes('SSH proxy connection attempt') && line.includes('status=success')) stats.opens++;
      if (line.includes('SSH proxy connection attempt') && line.includes('status=failure')) stats.refused++;
      if (line.includes('SSH proxy websocket closed')) stats.closes++;
    }
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `devsesh-reuse-${label}-`));
  const container = await startSSHContainer({ name: CONTAINER_NAME, port: CONTAINER_PORT });
  const configPath = path.join(tempDir, 'config.yml');
  const sessionDir = path.join(tempDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  const token = await setupPairedCli(page, server.url, `reuse-${label}-${Date.now()}@example.com`, configPath, sessionDir);
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const hosts = await (await fetch(`${server.url}/api/v1/hosts`, { headers: auth })).json();
  await fetch(`${server.url}/api/v1/hosts/${hosts[0].id}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ label: hosts[0].label, hostname: 'localhost', ssh_user: 'testuser', ssh_port: container.port }),
  });

  // Several sessions on the one host, each with a real tmux session in the container.
  const names: string[] = [];
  const ids: string[] = [];
  for (let i = 0; i < sessions; i++) {
    const name = `reuse-${label}-${i}-${Date.now()}`;
    names.push(name);
    spawnDevseshStart(name, configPath, sessionDir, server.url, true);
    ids.push((await waitForSessionInApi(server.url, token, name, 60000)).id);
    createTmuxSession(CONTAINER_NAME, name);
  }
  return { server, container, tempDir, sessionDir, names, ids, stats };
}

async function teardown(ctx: Ctx | undefined) {
  if (!ctx) return;
  for (const n of ctx.names) await killTmuxSession(n, ctx.sessionDir);
  await stopSSHContainer(ctx.container);
  await stopServer(ctx.server);
  fs.rmSync(ctx.tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

async function openFromDashboard(page: Page, ctx: Ctx, i: number) {
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
  await page.locator(`tbody a[href="/sessions/${ctx.ids[i]}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${ctx.ids[i]}`), { timeout: 10000 });
}

async function backToDashboard(page: Page) {
  await page.getByLabel('Back to dashboard').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
}

test.describe('SSH connection reuse', () => {
  test('opening sessions from the dashboard reuses the connection to the same host', async ({ page }) => {
    test.setTimeout(5 * 60 * 1000);
    let ctx: Ctx | undefined;
    try {
      ctx = await setup(page, 'nav', 3);
      await page.goto(`${ctx.server.url}/dashboard`);

      // First open: a real connection and an unlock.
      await openFromDashboard(page, ctx, 0);
      expect(await unlockWithPassword(page)).toBe(true);
      await expect(connected(page)).toBeVisible({ timeout: 30000 });
      expect(ctx.stats.opens).toBe(1);

      // Leave and open the other two sessions (same host), then the first again.
      for (const i of [1, 2, 0]) {
        await backToDashboard(page);
        await openFromDashboard(page, ctx, i);
        // Reused: no unlock prompt, and Connected straight away.
        await expect(connected(page)).toBeVisible({ timeout: 10000 });
        expect(await unlockPromptAppears(page, 500), `session ${i} asked to unlock again`).toBe(false);
      }

      // One host, one connection, however often we moved around.
      expect(ctx.stats.opens, `server saw ${ctx.stats.opens} connections for one host`).toBe(1);
      expect(ctx.stats.refused).toBe(0);
    } finally {
      await teardown(ctx);
    }
  });

  test('leaving a session while the unlock prompt is open does not block the next connection', async ({ page }) => {
    test.setTimeout(5 * 60 * 1000);
    let ctx: Ctx | undefined;
    try {
      ctx = await setup(page, 'leave', 2);
      await page.goto(`${ctx.server.url}/dashboard`);

      // Open a session and walk away without answering the unlock prompt.
      await openFromDashboard(page, ctx, 0);
      expect(await unlockPromptAppears(page, 20000)).toBe(true);
      // The dialog is modal, so leave the way a user can: the browser Back button.
      await page.goBack();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // The next session must reach its own unlock prompt promptly. Before the fix
      // the abandoned handshake kept the browser's connect lock for up to 60 s, so
      // this one sat at "Connecting" with no prompt.
      const started = Date.now();
      await openFromDashboard(page, ctx, 1);
      const appeared = await unlockPromptAppears(page, 15000);
      expect(appeared, `no unlock prompt after ${Math.round((Date.now() - started) / 1000)} s: stuck at Connecting`).toBe(true);

      // And answering it connects.
      expect(await unlockWithPassword(page)).toBe(true);
      await expect(connected(page)).toBeVisible({ timeout: 30000 });
    } finally {
      await teardown(ctx);
    }
  });
});
