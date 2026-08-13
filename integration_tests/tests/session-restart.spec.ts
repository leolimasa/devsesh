import { test, expect, Page } from '@playwright/test';
import { startServer, stopServer, ServerInstance } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import { spawnDevseshStart, killTmuxSession, waitForSessionInApi } from '../helpers/session';
import {
  startSSHContainer as startContainer,
  stopSSHContainer as stopContainer,
  execInContainer,
  execInContainerAsRoot,
  hasTmuxSession,
  SSHContainer,
} from '../helpers/ssh-container';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// The Restart button re-creates a session's tmux on its host by running
// `devsesh start <name>` over the existing SSH machinery. These tests cover both
// entry points: the dashboard button (navigates into the session with restart
// intent) and the detail-pane button (runs `devsesh start` on the live SSH
// connection, re-creating a tmux session that died — the reboot scenario).

const CONTAINER_NAME = 'devsesh-restart-test';
const CONTAINER_PORT = 2223;

interface Ctx {
  server: ServerInstance;
  token: string;
  sessionId: string;
  sessionName: string;
  tempDir: string;
  devseshProcess: any;
  pingInterval: NodeJS.Timeout | null;
  container: SSHContainer | null;
}

// Minimal setup for the dashboard test: a paired CLI + a registered session. No
// SSH container needed — the dashboard button only navigates.
async function setupSessionOnly(page: Page, sessionName: string): Promise<Ctx> {
  const server = await startServer();
  const testEmail = `restart-${Date.now()}@example.com`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-restart-'));
  const configPath = path.join(tempDir, 'config.yml');
  const sessionDir = path.join(tempDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);
  const devseshProcess = spawnDevseshStart(sessionName, configPath, sessionDir, server.url);
  const found = await waitForSessionInApi(server.url, token, sessionName, 15000);

  const pingInterval = setInterval(async () => {
    try {
      await fetch(`${server.url}/api/v1/sessions/${found.id}/ping`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
  }, 2000);

  return { server, token, sessionId: found.id, sessionName, tempDir, devseshProcess, pingInterval, container: null };
}

// Full setup for the detail-pane test: an SSH container whose tmux session the
// web terminal attaches to, plus a devsesh config inside the container so a
// `devsesh start` issued over SSH can re-create that tmux session.
async function setupWithContainer(page: Page, sessionName: string): Promise<Ctx> {
  const server = await startServer();
  const testEmail = `restart-${Date.now()}@example.com`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-restart-'));
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
      label: `restart-host-${Date.now()}`,
      hostname: 'localhost',
      ssh_user: 'testuser',
      ssh_port: container.port,
    }),
  });

  // Give the container's testuser a devsesh config so a `devsesh start` run over
  // SSH passes the "logged in" gate. The server URL is deliberately unreachable
  // from the container: `devsesh start`'s server lookup fails non-fatally and it
  // still re-creates the tmux session locally — exactly the recovery we test.
  execInContainerAsRoot(
    CONTAINER_NAME,
    `sh -c 'mkdir -p /home/testuser/.devsesh && printf "server_url: http://127.0.0.1:1\\njwt_token: dummy\\n" > /home/testuser/.devsesh/config.yml && chown -R testuser:testuser /home/testuser/.devsesh && chmod 600 /home/testuser/.devsesh/config.yml'`,
  );

  const devseshProcess = spawnDevseshStart(sessionName, configPath, sessionDir, server.url);
  const found = await waitForSessionInApi(server.url, token, sessionName, 15000);

  const pingInterval = setInterval(async () => {
    try {
      await fetch(`${server.url}/api/v1/sessions/${found.id}/ping`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
  }, 2000);

  return { server, token, sessionId: found.id, sessionName, tempDir, devseshProcess, pingInterval, container };
}

async function cleanup(ctx: Ctx): Promise<void> {
  if (ctx.pingInterval) clearInterval(ctx.pingInterval);
  if (ctx.devseshProcess) killTmuxSession(ctx.sessionName);
  if (ctx.container) await stopContainer(ctx.container);
  await stopServer(ctx.server);
  fs.rmSync(ctx.tempDir, { recursive: true, force: true });
}

// Drive the auto-connect flow to a live password auth (mirrors ssh-e2e).
async function connectAndAuthenticate(page: Page, password: string): Promise<boolean> {
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
  const passwordInput = page.locator('input[type="password"]');
  const visible = await passwordInput
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return page.getByText('Connected', { exact: true }).isVisible().catch(() => false);
  await passwordInput.fill(password);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  return page
    .getByText('Connected', { exact: true })
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
}

async function waitForContainerTmux(name: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (hasTmuxSession(CONTAINER_NAME, name)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

test.describe('Session restart button', () => {
  test('dashboard restart button opens the session terminal', async ({ page }) => {
    let ctx: Ctx | null = null;
    try {
      const sessionName = `restart-dash-${Date.now()}`;
      ctx = await setupSessionOnly(page, sessionName);

      await page.goto(`${ctx.server.url}/dashboard`);
      // The desktop table row (name + a Restart button). Scope text/queries to
      // the table so the parallel md:hidden mobile card doesn't double-match.
      const table = page.locator('table');
      await expect(table.getByText(sessionName)).toBeVisible({ timeout: 15000 });

      // The desktop table row exposes a Restart button. Clicking it must
      // navigate into the session's terminal (where the restart runs).
      const restartBtn = table.getByRole('button', { name: 'Restart session' });
      await expect(restartBtn).toBeVisible();
      await restartBtn.click();

      await page.waitForURL(new RegExp(`/sessions/${ctx.sessionId}`), { timeout: 10000 });
      expect(page.url()).toContain(`/sessions/${ctx.sessionId}`);
    } finally {
      if (ctx) await cleanup(ctx);
    }
  });

  test('detail-pane restart re-creates a dead tmux session via devsesh start', async ({ page }) => {
    let ctx: Ctx | null = null;
    try {
      const sessionName = 'testsession'; // the container pre-creates this tmux session
      ctx = await setupWithContainer(page, sessionName);

      await page.goto(`${ctx.server.url}/sessions/${ctx.sessionId}`);
      await page.waitForLoadState('networkidle');
      const connected = await connectAndAuthenticate(page, 'testpass');
      expect(connected).toBe(true);

      // The desktop detail panel exposes a Restart button.
      const restartBtn = page
        .getByTestId('session-detail-panel')
        .getByRole('button', { name: 'Restart session' });
      await expect(restartBtn).toBeVisible({ timeout: 10000 });

      // Simulate the host rebooting: the tmux session dies.
      execInContainer(CONTAINER_NAME, 'tmux kill-session -t testsession');
      expect(hasTmuxSession(CONTAINER_NAME, 'testsession')).toBe(false);

      // Restart: runs `devsesh start testsession` over the SSH connection, which
      // re-creates the tmux session on the host.
      await restartBtn.click();

      const recreated = await waitForContainerTmux('testsession', 25000);
      expect(recreated, 'tmux session should be re-created by devsesh start').toBe(true);
    } finally {
      if (ctx) await cleanup(ctx);
    }
  });
});
