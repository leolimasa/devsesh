import { test, expect, Page } from '@playwright/test';
import { startServer, stopServer, ServerInstance } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import { spawnDevseshStart, killTmuxSession, waitForSessionInApi } from '../helpers/session';
import {
  startSSHContainer as startContainer,
  stopSSHContainer as stopContainer,
  execInContainerAsRoot,
  hasTmuxSession,
  SSHContainer,
} from '../helpers/ssh-container';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// The "New session" button prompts for a host + name, then runs
// `devsesh start <name>` on that host over the SAME SSH machinery the Restart
// button uses (an autoRestart SSHTerminal). These tests drive both entry points
// end-to-end and assert the effect where we can observe it: a brand-new tmux
// session appears IN THE CONTAINER (the test "host"). The container can't reach
// the localhost-bound test server, so — like session-restart.spec.ts — we verify
// creation at the tmux level rather than via server registration.

const CONTAINER_NAME = 'devsesh-newsession-test';
// A port not shared with any other spec (ssh-e2e/quick-keys 2222, ssh-ca-e2e
// 2223/2224/2225/2233, restart 2231) so a leaked container can't collide.
const CONTAINER_PORT = 2232;

interface Ctx {
  server: ServerInstance;
  token: string;
  hostId: number;
  tempDir: string;
  container: SSHContainer;
  // Present only when the test pre-registers a session to view.
  hostSessionId?: string;
  hostSessionName?: string;
  hostDevseshProcess?: any;
  pingInterval?: NodeJS.Timeout | null;
}

// Base setup: a paired CLI whose (single) host points at an SSH container, plus a
// devsesh config inside the container so a `devsesh start` issued over SSH passes
// the "logged in" gate. The container's server URL is deliberately unreachable —
// `devsesh start`'s server lookup fails non-fatally and it still creates the tmux
// session locally, which is exactly what we assert.
async function setupBase(page: Page): Promise<Ctx> {
  const server = await startServer();
  const testEmail = `newsession-${Date.now()}@example.com`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-newsession-'));
  const configPath = path.join(tempDir, 'config.yml');
  const sessionDir = path.join(tempDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  const container = await startContainer({ name: CONTAINER_NAME, port: CONTAINER_PORT });

  const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);

  const hostsRes = await fetch(`${server.url}/api/v1/hosts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const hosts = await hostsRes.json();
  const hostId = hosts[0].id;
  await fetch(`${server.url}/api/v1/hosts/${hostId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      label: `newsession-host-${Date.now()}`,
      hostname: 'localhost',
      ssh_user: 'testuser',
      ssh_port: container.port,
    }),
  });

  execInContainerAsRoot(
    CONTAINER_NAME,
    `sh -c 'mkdir -p /home/testuser/.devsesh && printf "server_url: http://127.0.0.1:1\\njwt_token: dummy\\n" > /home/testuser/.devsesh/config.yml && chown -R testuser:testuser /home/testuser/.devsesh && chmod 600 /home/testuser/.devsesh/config.yml'`,
  );

  return { server, token, hostId, tempDir, container };
}

// Additionally register a host-side session so there is a detail page to open
// (the session-page entry point lives in that page's side panel).
async function withHostSession(page: Page, ctx: Ctx): Promise<Ctx> {
  const sessionDir = path.join(ctx.tempDir, 'sessions');
  const configPath = path.join(ctx.tempDir, 'config.yml');
  const hostSessionName = `existing-${Date.now()}`;
  const proc = spawnDevseshStart(hostSessionName, configPath, sessionDir, ctx.server.url);
  const found = await waitForSessionInApi(ctx.server.url, ctx.token, hostSessionName, 30000);
  const pingInterval = setInterval(async () => {
    try {
      await fetch(`${ctx.server.url}/api/v1/sessions/${found.id}/ping`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.token}` },
      });
    } catch {}
  }, 2000);
  return {
    ...ctx,
    hostSessionId: found.id,
    hostSessionName,
    hostDevseshProcess: proc,
    pingInterval,
  };
}

async function cleanup(ctx: Ctx): Promise<void> {
  if (ctx.pingInterval) clearInterval(ctx.pingInterval);
  if (ctx.hostDevseshProcess && ctx.hostSessionName) killTmuxSession(ctx.hostSessionName);
  await stopContainer(ctx.container);
  await stopServer(ctx.server);
  fs.rmSync(ctx.tempDir, { recursive: true, force: true });
}

// Dismiss the WebAuthn cert dialog (Radix AlertDialog) that auto-connect surfaces,
// falling back to password auth. Clicked via evaluate because the Radix overlay
// intercepts normal clicks (same trick as ssh-e2e).
async function fallBackToPassword(page: Page): Promise<boolean> {
  const usePasswordButton = page.locator('button:has-text("Use Password Instead")');
  const appeared = await usePasswordButton
    .waitFor({ state: 'visible', timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent?.includes('Use Password Instead')) {
          (btn as HTMLButtonElement).click();
          return;
        }
      }
    });
  }
  return appeared;
}

// Drive the auto-connect flow to a live password auth (mirrors ssh-e2e). The
// new-session terminal (hidden on the dashboard, visible on /sessions/new)
// renders the same WebAuthn/password modals, so this works for both. We submit
// with Enter rather than clicking Connect: the dashboard's creator terminal (and
// thus its PasswordDialog) lives in an offscreen container, and a keypress
// submit is immune to the button hit-testing that trips up there.
async function authenticate(page: Page, password: string): Promise<void> {
  await fallBackToPassword(page);
  const passwordInput = page.locator('input[type="password"]');
  const visible = await passwordInput
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return;
  await passwordInput.fill(password);
  await passwordInput.press('Enter');
}

// From an existing session's detail page, clear the terminal's auto-connect
// dialogs so the side panel (and its "New session" button) is interactable: fall
// back to password, then cancel the password prompt to drop all overlays and
// leave the terminal disconnected.
async function clearAutoConnect(page: Page): Promise<void> {
  await fallBackToPassword(page);
  const passwordInput = page.locator('input[type="password"]');
  const visible = await passwordInput
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return;
  await page.evaluate(() => {
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent?.trim() === 'Cancel') {
        (btn as HTMLButtonElement).click();
        return;
      }
    }
  });
}

// Fill in the shared New Session dialog and submit it.
async function fillNewSessionDialog(page: Page, name: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await dialog.locator('#new-session-name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
}

async function waitForContainerTmux(name: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (hasTmuxSession(CONTAINER_NAME, name)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

test.describe('New session button', () => {
  test('dashboard New session runs devsesh start on the host and creates the tmux session', async ({ page }) => {
    let ctx: Ctx | null = null;
    try {
      ctx = await setupBase(page);
      const newName = `dash-new-${Date.now()}`;
      expect(hasTmuxSession(CONTAINER_NAME, newName)).toBe(false);

      await page.goto(`${ctx.server.url}/dashboard`);
      await page.getByRole('button', { name: 'New session' }).click();
      await fillNewSessionDialog(page, newName);

      // The dashboard mounts a hidden creator terminal; authenticate its SSH.
      await authenticate(page, 'testpass');

      const created = await waitForContainerTmux(newName, 30000);
      expect(created, 'devsesh start should create the new tmux session on the host').toBe(true);
    } finally {
      if (ctx) await cleanup(ctx);
    }
  });

  test('session-page New session opens a live terminal and creates the tmux session', async ({ page }) => {
    let ctx: Ctx | null = null;
    try {
      ctx = await withHostSession(page, await setupBase(page));
      const newName = `panel-new-${Date.now()}`;
      expect(hasTmuxSession(CONTAINER_NAME, newName)).toBe(false);

      // Open the existing session's detail page (the panel hosts the button).
      await page.goto(`${ctx.server.url}/sessions/${ctx.hostSessionId}`);
      await expect(page.getByTestId('session-detail-panel')).toBeVisible({ timeout: 15000 });

      // The existing session's terminal auto-connects and pops a modal that would
      // block the panel; clear it so the "New session" button is clickable.
      await clearAutoConnect(page);

      // The side panel's "New session" button (defaults the host to this
      // session's host, i.e. the container).
      await page
        .getByTestId('session-detail-panel')
        .getByRole('button', { name: 'New session' })
        .click();
      await fillNewSessionDialog(page, newName);

      // Lands on the dedicated create page with a live terminal.
      await page.waitForURL(/\/sessions\/new/, { timeout: 10000 });
      await authenticate(page, 'testpass');

      const created = await waitForContainerTmux(newName, 30000);
      expect(created, 'devsesh start should create the new tmux session on the host').toBe(true);
    } finally {
      if (ctx) await cleanup(ctx);
    }
  });
});
