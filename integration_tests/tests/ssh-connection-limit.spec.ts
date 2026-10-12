import { test, expect, Page } from '@playwright/test';
import { startServer, stopServer, ServerInstance } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import { spawnDevseshLogin, extractPairingCode, waitForCliSuccess } from '../helpers/cli';
import { spawnDevseshStart, waitForSessionInApi, killTmuxSession } from '../helpers/session';
import { startSSHContainer, stopSSHContainer, SSHContainer } from '../helpers/ssh-container';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Regression test for the "devsesh is unstable when switching sessions" report.
 *
 * What the server logs showed: the SSH proxy allows a user at most
 * DEVSESH_SSH_MAX_CONNECTIONS (default 5) WebSocket connections at once. The
 * browser keeps one pooled SSH connection per HOST and never lets go of them
 * while the tab is open, so after visiting sessions on five hosts every slot is
 * taken. Opening a session on a sixth host is then refused, and the refusal
 * reaches the browser as a bare dropped socket (the server writes an HTTP error
 * after the WebSocket upgrade, which goes nowhere). The terminal cannot tell why,
 * so it cycles Connecting -> Error and keeps retrying (re-asking for the SSH
 * unlock each time) and never gets in.
 *
 * The fix: the browser now bounds its pool (web/wasm/sshclient/pool.go): at most 3
 * connections, always fewer than the server's default limit of 5, and idle ones are
 * released when the user switches host. A refused connection is therefore never
 * needed, even with the server at its default.
 *
 * The test pairs one CLI per host (six hosts, all backed by one sshd container),
 * starts one session on each, then opens them one after another in a single tab,
 * the way a user switches sessions. All six must connect with no refusal, and going
 * back to the first host (whose connection was released) must reconnect.
 */

const CONTAINER_NAME = 'devsesh-connlimit-test';
// A port no other spec uses (2222-2226, 2231-2233 are taken).
const CONTAINER_PORT = 2234;
const HOST_COUNT = 6;

interface HostSession {
  hostId: number;
  sessionId: string;
  sessionName: string;
  sessionDir: string;
}

// Same trick as ssh-e2e: the Radix overlay intercepts normal clicks, so click via evaluate.
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

// Drive the unlock dialog to a password login if the terminal asks for one.
// Returns true when a password was submitted.
async function unlockWithPassword(page: Page, timeout = 20000): Promise<boolean> {
  const usePassword = page.locator('button:has-text("Use Password Instead")');
  const passwordInput = page.locator('input[type="password"]');
  const first = await Promise.race([
    usePassword.waitFor({ state: 'visible', timeout }).then(() => 'dialog' as const),
    passwordInput.waitFor({ state: 'visible', timeout }).then(() => 'password' as const),
  ]).catch(() => null);
  if (!first) return false;
  if (first === 'dialog') {
    await clickButtonWithText(page, 'Use Password Instead');
    await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
  }
  await passwordInput.fill('testpass');
  await passwordInput.press('Enter');
  return true;
}

// The top bar shows one of: Connecting..., Authenticating..., Connected, Error, Disconnected.
async function statusText(page: Page): Promise<string> {
  const known = ['Connecting...', 'Authenticating...', 'Connected', 'Error', 'Disconnected'];
  for (const s of known) {
    if (await page.getByText(s, { exact: true }).first().isVisible().catch(() => false)) return s;
  }
  return 'unknown';
}

test.describe('SSH connection limit', () => {
  test('opening a session on a sixth host connects instead of cycling Connecting/Error', async ({ page }) => {
    test.setTimeout(8 * 60 * 1000);

    let server: ServerInstance | undefined;
    let container: SSHContainer | undefined;
    let tempDir = '';
    const hs: HostSession[] = [];
    // Server log lines that show a connection being refused.
    let refusals = 0;

    try {
      server = await startServer();
      server.process.stdout?.on('data', (d: Buffer) => {
        for (const line of d.toString().split('\n')) {
          if (line.includes('SSH proxy connection attempt') && line.includes('status=failure')) refusals++;
        }
      });
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-connlimit-'));
      container = await startSSHContainer({ name: CONTAINER_NAME, port: CONTAINER_PORT });

      // Host 1 comes from the normal pairing helper; it also logs the browser in.
      const firstDir = path.join(tempDir, 'cli-1');
      fs.mkdirSync(path.join(firstDir, 'sessions'), { recursive: true });
      const token = await setupPairedCli(
        page,
        server.url,
        `connlimit-${Date.now()}@example.com`,
        path.join(firstDir, 'config.yml'),
        path.join(firstDir, 'sessions')
      );
      const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

      // Hosts 2..6: pair one more CLI each, to a new host row.
      for (let i = 2; i <= HOST_COUNT; i++) {
        const dir = path.join(tempDir, `cli-${i}`);
        fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
        const login = spawnDevseshLogin(server.url, path.join(dir, 'config.yml'), path.join(dir, 'sessions'));
        let code: string | null = null;
        for (let t = 0; t < 75 && !code; t++) {
          code = extractPairingCode(login.stdout);
          if (!code) await new Promise((r) => setTimeout(r, 200));
        }
        if (!code) throw new Error(`no pairing code for host ${i}`);
        const res = await fetch(`${server.url}/api/v1/auth/pair/exchange`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ code, new_host: { label: `host-${i}`, hostname: 'placeholder' } }),
        });
        if (!res.ok) throw new Error(`pair exchange for host ${i}: ${res.status} ${await res.text()}`);
        await waitForCliSuccess(login);
      }
      const allHosts: { id: number; label: string }[] = await (
        await fetch(`${server.url}/api/v1/hosts`, { headers: auth })
      ).json();
      expect(allHosts.length).toBe(HOST_COUNT);

      // Point every host at the one sshd container.
      for (const h of allHosts) {
        const r = await fetch(`${server.url}/api/v1/hosts/${h.id}`, {
          method: 'PUT',
          headers: auth,
          body: JSON.stringify({ label: h.label, hostname: 'localhost', ssh_user: 'testuser', ssh_port: container.port }),
        });
        expect(r.ok).toBe(true);
      }

      // One session per host, started by the CLI paired to that host.
      for (let i = 1; i <= HOST_COUNT; i++) {
        const dir = path.join(tempDir, `cli-${i}`);
        const name = `connlimit-${i}-${Date.now()}`;
        spawnDevseshStart(name, path.join(dir, 'config.yml'), path.join(dir, 'sessions'), server.url, true);
        const s = await waitForSessionInApi(server.url, token, name, 60000);
        hs.push({ hostId: s.host_id, sessionId: s.id, sessionName: name, sessionDir: path.join(dir, 'sessions') });
      }
      expect(new Set(hs.map((h) => h.hostId)).size).toBe(HOST_COUNT);

      // Open the sessions one after another in ONE tab, switching through the
      // Sessions pane (client-side navigation keeps the browser's connection pool).
      await page.goto(`${server.url}/sessions/${hs[0].sessionId}`);
      await expect(page.getByTestId('session-detail-panel')).toBeVisible({ timeout: 15000 });
      await page.getByRole('tab', { name: 'Sessions' }).click();

      const results: string[] = [];
      for (let i = 0; i < HOST_COUNT; i++) {
        if (i > 0) await page.getByTestId(`session-item-${hs[i].sessionId}`).click();
        await expect(page).toHaveURL(new RegExp(`/sessions/${hs[i].sessionId}`), { timeout: 10000 });
        await unlockWithPassword(page);

        // Wait for Connected, sampling the status so a Connecting/Error cycle is visible.
        const seen: string[] = [];
        let connected = false;
        for (let t = 0; t < 40 && !connected; t++) {
          const s = await statusText(page);
          if (seen[seen.length - 1] !== s) seen.push(s);
          connected = s === 'Connected';
          if (!connected) {
            // The unlock prompt comes back on every retry; answer it so the
            // connection has a chance.
            const prompt = page.locator('input[type="password"], button:has-text("Use Password Instead")').first();
            if (await prompt.isVisible().catch(() => false)) await unlockWithPassword(page, 2000);
            await page.waitForTimeout(500);
          }
        }
        // Is an unlock prompt still on screen? (A prompt that stays open after the
        // user answers it is part of the reported symptoms.)
        const promptOpen = await page.locator('input[type="password"], button:has-text("Use Password Instead")').first().isVisible().catch(() => false);
        results.push(`host ${i + 1}: ${connected ? 'connected' : 'NOT connected'} (status sequence: ${seen.join(' > ')}; unlock prompt still open: ${promptOpen})`);
        if (!connected) break;
      }

      // Every host, including the sixth, must be reachable, without the server ever
      // having to refuse a connection.
      let summary = results.join('\n') + `\nserver refused ${refusals} connection attempt(s)`;
      console.log('--- connection results ---\n' + summary);
      expect(results.length, summary).toBe(HOST_COUNT);
      expect(results[HOST_COUNT - 1], summary).toContain(': connected');
      expect(refusals, summary).toBe(0);

      // Back to the first host. Its pooled connection was released to make room, so
      // this is a fresh connection (and unlock); it must work and must not be refused.
      await page.getByTestId(`session-item-${hs[0].sessionId}`).click();
      await expect(page).toHaveURL(new RegExp(`/sessions/${hs[0].sessionId}`), { timeout: 10000 });
      await unlockWithPassword(page);
      await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30000 });
      summary += '\nback on host 1: connected';
      expect(refusals, summary).toBe(0);
    } finally {
      for (const h of hs) await killTmuxSession(h.sessionName, h.sessionDir);
      if (container) await stopSSHContainer(container);
      if (server) await stopServer(server);
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  });
});
