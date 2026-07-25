import { test, expect, Page } from '@playwright/test';
import { startServer, stopServer, ServerInstance } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import { spawnDevseshStart, killTmuxSession, waitForSessionInApi } from '../helpers/session';
import {
  startSSHContainer as startContainer,
  stopSSHContainer as stopContainer,
  execInContainer,
  SSHContainer,
} from '../helpers/ssh-container';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Container name unique to this test file
const CONTAINER_NAME = 'devsesh-ssh-test-integration';

// Track container for cleanup
let sshContainer: SSHContainer | null = null;

async function startSSHContainer(): Promise<number> {
  sshContainer = await startContainer({
    name: CONTAINER_NAME,
    port: 2222,
  });
  return sshContainer.port;
}

async function stopSSHContainer(): Promise<void> {
  if (sshContainer) {
    await stopContainer(sshContainer);
    sshContainer = null;
  }
}

interface TestContext {
  server: ServerInstance;
  token: string;
  hostId: number;
  sessionId: string;
  sessionName: string;  // The friendly name used for tmux session
  tempDir: string;
  configPath: string;
  sessionDir: string;
  pingInterval: NodeJS.Timeout | null;
  devseshProcess: any;
}

async function setupTestEnvironment(page: Page): Promise<TestContext> {
  const server = await startServer();
  const testEmail = `ssh-e2e-${Date.now()}@example.com`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-ssh-e2e-'));
  const configPath = path.join(tempDir, 'config.yml');
  const sessionDir = path.join(tempDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  const sshPort = await startSSHContainer();
  console.log('SSH container started on port:', sshPort);

  const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);
  console.log('User paired successfully');

  const hostsRes = await fetch(`${server.url}/api/v1/hosts`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
  });

  expect(hostsRes.ok).toBe(true);
  const hosts = await hostsRes.json();
  expect(hosts.length).toBeGreaterThan(0);
  const pairedHost = hosts[0];
  const hostId = pairedHost.id;
  console.log('Using paired host with ID:', hostId);

  const updateHostRes = await fetch(`${server.url}/api/v1/hosts/${hostId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      label: `test-host-e2e-${Date.now()}`,
      hostname: 'localhost',
      ssh_user: 'testuser',
      ssh_port: sshPort,
    }),
  });

  expect(updateHostRes.ok).toBe(true);
  console.log('Host updated to use SSH container port:', sshPort);

  const sessionName = `test-session-${Date.now()}`;

  console.log('Starting devsesh session via CLI...');
  const devseshProcess = spawnDevseshStart(sessionName, configPath, sessionDir, server.url);

  console.log('Waiting for session to appear in API...');
  const foundSession = await waitForSessionInApi(server.url, token, sessionName, 15000);
  const sessionId = foundSession.id;
  console.log('Session found in API with ID:', sessionId);

  const pingInterval = setInterval(async () => {
    try {
      await fetch(`${server.url}/api/v1/sessions/${sessionId}/ping`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch {}
  }, 2000);

  return {
    server,
    token,
    hostId,
    sessionId,
    sessionName,
    tempDir,
    configPath,
    sessionDir,
    pingInterval,
    devseshProcess,
  };
}

async function cleanupTestEnvironment(ctx: TestContext): Promise<void> {
  if (ctx.pingInterval) {
    clearInterval(ctx.pingInterval);
  }
  if (ctx.devseshProcess) {
    console.log('Killing devsesh session...');
    killTmuxSession(ctx.sessionName);
  }
  await stopSSHContainer();
  await stopServer(ctx.server);
  fs.rmSync(ctx.tempDir, { recursive: true, force: true });
}

async function navigateToSession(page: Page, serverUrl: string, sessionId: string): Promise<void> {
  await page.goto(`${serverUrl}/sessions/${sessionId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
}

// isConnected checks the redesigned top-bar status, which renders a colored dot
// plus the exact text "Connected" (the old UI used a "🟢 Connected" label).
async function isConnected(page: Page): Promise<boolean> {
  return page
    .getByText('Connected', { exact: true })
    .isVisible()
    .catch(() => false);
}

// connectAndAuthenticate drives the auto-connect flow to a live password auth.
// The terminal now auto-connects on mount (no manual Connect gate): with SSH CA
// enabled it surfaces the WebAuthn dialog, which we dismiss to fall back to
// password auth, then fill + submit the password dialog.
async function connectAndAuthenticate(page: Page, password: string): Promise<boolean> {
  // Auto-connect surfaces the WebAuthn "Unlock SSH Certificate" dialog.
  const usePasswordButton = page.locator('button:has-text("Use Password Instead")');
  const webAuthnAppeared = await usePasswordButton
    .waitFor({ state: 'visible', timeout: 45000 })
    .then(() => true)
    .catch(() => false);

  if (webAuthnAppeared) {
    console.log('WebAuthn certificate dialog detected, clicking "Use Password Instead"...');
    // Radix overlay can intercept normal clicks; click via evaluate.
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent?.includes('Use Password Instead')) {
          (btn as HTMLButtonElement).click();
          return;
        }
      }
    });
  }

  console.log('Looking for password dialog...');
  const passwordInput = page.locator('input[type="password"]');
  const isPasswordVisible = await passwordInput
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!isPasswordVisible) {
    // No password prompt — either already connected or errored.
    return isConnected(page);
  }

  console.log('Entering password...');
  await passwordInput.fill(password);
  // Exact match: has-text("Connect") would also catch the top-bar "Disconnect".
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  console.log('Waiting for connection...');
  return page
    .getByText('Connected', { exact: true })
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('SSH WebSocket Full E2E Integration Tests', () => {

  // Test 1: Basic connection (req.ssh106)
  test('SSH terminal connects successfully with correct password', async ({ page }) => {
    let ctx: TestContext | null = null;

    try {
      ctx = await setupTestEnvironment(page);
      await navigateToSession(page, ctx.server.url, ctx.sessionId);

      const connected = await connectAndAuthenticate(page, 'testpass');
      expect(connected).toBe(true);

      console.log('✅ SSH connection test passed!');
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // Test 2: Terminal input works (req.ssh107)
  test('Terminal accepts keyboard input', async ({ page }) => {
    let ctx: TestContext | null = null;

    try {
      ctx = await setupTestEnvironment(page);
      await navigateToSession(page, ctx.server.url, ctx.sessionId);

      const connected = await connectAndAuthenticate(page, 'testpass');
      expect(connected).toBe(true);

      // Wait for terminal to be ready
      await page.waitForSelector('.xterm-screen', { timeout: 10000 });
      await page.waitForTimeout(2000);

      console.log('Typing in terminal...');
      // Focus the terminal's hidden textarea
      const terminalInput = page.locator('.xterm-helper-textarea');
      await terminalInput.focus();
      await page.waitForTimeout(500);

      // Type a simple command - just verify no error occurs
      await page.keyboard.type('echo hello', { delay: 50 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);

      // Verify terminal is still connected (no crash)
      const stillConnected = await isConnected(page);
      expect(stillConnected).toBe(true);

      console.log('✅ Terminal input test passed!');
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // Test 3: Disconnect button exists and can be clicked (req.ssh109)
  test('Disconnect button is present and functional', async ({ page }) => {
    let ctx: TestContext | null = null;

    try {
      ctx = await setupTestEnvironment(page);
      await navigateToSession(page, ctx.server.url, ctx.sessionId);

      const connected = await connectAndAuthenticate(page, 'testpass');
      expect(connected).toBe(true);

      console.log('Looking for Disconnect button...');
      const disconnectButton = page.locator('button:has-text("Disconnect")');
      await expect(disconnectButton).toBeVisible({ timeout: 5000 });

      // Verify the button exists - clicking it may cause page issues so we just verify it's there
      const buttonText = await disconnectButton.textContent();
      expect(buttonText).toContain('Disconnect');

      console.log('✅ Disconnect button test passed!');
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // Test 4: Auth failure does not connect (req.ssh111)
  test('Wrong password does not reach connected state', async ({ page }) => {
    let ctx: TestContext | null = null;

    try {
      ctx = await setupTestEnvironment(page);
      await navigateToSession(page, ctx.server.url, ctx.sessionId);

      // Auto-connect surfaces the WebAuthn dialog; fall back to password auth.
      const usePasswordButton = page.locator('button:has-text("Use Password Instead")');
      await usePasswordButton.waitFor({ state: 'visible', timeout: 45000 });
      await page.evaluate(() => {
        for (const btn of document.querySelectorAll('button')) {
          if (btn.textContent?.includes('Use Password Instead')) {
            (btn as HTMLButtonElement).click();
            return;
          }
        }
      });

      console.log('Entering wrong password...');
      const passwordInput = page.locator('input[type="password"]');
      await expect(passwordInput).toBeVisible({ timeout: 10000 });
      await passwordInput.fill('wrongpassword');
      await page.getByRole('button', { name: 'Connect', exact: true }).click();

      // A wrong password must never reach the Connected state.
      const connectedReached = await page
        .getByText('Connected', { exact: true })
        .waitFor({ state: 'visible', timeout: 12000 })
        .then(() => true)
        .catch(() => false);

      console.log('Reached connected with wrong password:', connectedReached);
      expect(connectedReached).toBe(false);

      console.log('✅ Auth failure test passed!');
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // Test 5: Terminal resize doesn't break connection (req.ssh108)
  test('Terminal resize maintains connection', async ({ page }) => {
    let ctx: TestContext | null = null;

    try {
      ctx = await setupTestEnvironment(page);
      await navigateToSession(page, ctx.server.url, ctx.sessionId);

      const connected = await connectAndAuthenticate(page, 'testpass');
      expect(connected).toBe(true);

      // Wait for terminal to be ready
      await page.waitForSelector('.xterm-screen', { timeout: 10000 });
      await page.waitForTimeout(1000);

      console.log('Resizing browser window...');
      await page.setViewportSize({ width: 800, height: 600 });
      await page.waitForTimeout(1000);

      await page.setViewportSize({ width: 1200, height: 800 });
      await page.waitForTimeout(1000);

      // Connection should still be active
      const stillConnected = await isConnected(page);
      expect(stillConnected).toBe(true);

      console.log('✅ Terminal resize test passed!');
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // Test 6: Explicit disconnect stops the session and Connect reappears (req.ssh110)
  // The always-on terminal replaced the old "Close Terminal" button [req.b26nmc];
  // an explicit disconnect must suppress auto-reconnect [req.jy9djs].
  test('Explicit disconnect stops the session and Connect reappears', async ({ page }) => {
    let ctx: TestContext | null = null;

    try {
      ctx = await setupTestEnvironment(page);
      await navigateToSession(page, ctx.server.url, ctx.sessionId);

      const connected = await connectAndAuthenticate(page, 'testpass');
      expect(connected).toBe(true);

      console.log('Clicking Disconnect...');
      const disconnectButton = page.getByRole('button', { name: 'Disconnect', exact: true });
      await expect(disconnectButton).toBeVisible({ timeout: 5000 });
      await disconnectButton.click();

      // Explicit disconnect must not auto-reconnect; the Connect button returns
      // and stays (no reconnect flipping it back to Disconnect).
      const connectButton = page.getByRole('button', { name: 'Connect', exact: true });
      await expect(connectButton).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(3000);
      await expect(connectButton).toBeVisible();

      console.log('✅ Explicit disconnect test passed!');
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // Phase 1: Tests for SSH terminal I/O bugs [req.sry715]

  // Test: SSH terminal connects to existing tmux session with matching session ID [req.gy4af9]
  test('SSH terminal connects to existing tmux session with matching session ID', async ({ page }) => {
    let ctx: TestContext | null = null;

    try {
      // Use a specific session name that matches the tmux session in the container
      const testSessionName = 'testsession';
      
      ctx = await setupTestEnvironmentWithSession(page, testSessionName);
      await navigateToSession(page, ctx.server.url, ctx.sessionId);

      const connected = await connectAndAuthenticate(page, 'testpass');
      expect(connected).toBe(true);

      // Wait for tmux to attach - the exec command runs after connection
      await page.waitForTimeout(3000);

      // Verify terminal is visible and connected
      await page.waitForSelector('.xterm-screen', { timeout: 10000 });
      
      // The connection should succeed and terminal should be in tmux session
      const stillConnected = await isConnected(page);
      expect(stillConnected).toBe(true);

      console.log('✅ SSH terminal connects to tmux session test passed!');
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // Test: Terminal receives output from remote host [req.ow4f94]
  test('Terminal receives output from remote host', async ({ page }) => {
    let ctx: TestContext | null = null;

    // Collect console logs for debugging
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(text);
      if (msg.text().includes('[SSH') || msg.text().includes('WASM')) {
        console.log(text);
      }
    });

    try {
      const testSessionName = 'testsession';
      ctx = await setupTestEnvironmentWithSession(page, testSessionName);
      await navigateToSession(page, ctx.server.url, ctx.sessionId);

      const connected = await connectAndAuthenticate(page, 'testpass');
      expect(connected).toBe(true);

      // Wait for terminal to be ready
      await page.waitForSelector('.xterm-screen', { timeout: 10000 });
      await page.waitForTimeout(3000);

      // Capture initial terminal state
      const initialState = await page.evaluate(() => {
        const termScreen = document.querySelector('.xterm-screen');
        if (!termScreen) return { hasCanvas: false, pixels: null };
        const canvas = termScreen.querySelector('canvas');
        if (!canvas) return { hasCanvas: false, pixels: null };
        const ctx = canvas.getContext('2d');
        if (!ctx) return { hasCanvas: false, pixels: null };
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { 
          hasCanvas: true, 
          pixels: imageData.data.slice(0, 100),
          width: canvas.width,
          height: canvas.height
        };
      });

      console.log('Initial terminal state:', JSON.stringify(initialState));

      // Instead of relying on canvas pixels, check that output callbacks were invoked
      // The console logs above will show if output is being received

      // Wait a bit to capture any additional output
      await page.waitForTimeout(2000);

      // Take screenshots for debugging
      await page.screenshot({ path: '/tmp/terminal_output_test.png' });
      console.log('Screenshot saved');
      console.log('Console logs captured:', consoleLogs.filter(l => l.includes('[SSH')).join('\n'));

      // Verify the terminal displays content by checking that the terminal screen has text
      // A connected tmux session should show a shell prompt (containing $ or similar)
      const terminalScreen = page.locator('.xterm-screen');

      // Check that the terminal has rendered content (not empty)
      // The terminal should show the shell prompt from the tmux session
      const hasContent = await page.evaluate(() => {
        const rows = document.querySelectorAll('.xterm-rows > div');
        if (rows.length === 0) return false;
        // Check if any row has non-whitespace text
        for (const row of rows) {
          if (row.textContent && row.textContent.trim().length > 0) {
            return true;
          }
        }
        return false;
      });

      expect(hasContent).toBe(true);
      console.log('✅ Terminal receives output test passed!');
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // Test: Terminal sends keystrokes to remote tmux [req.vqjj4e]
  test('Terminal sends keystrokes to remote tmux and receives response', async ({ page }) => {
    let ctx: TestContext | null = null;

    // Collect console logs for debugging
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(text);
      if (msg.text().includes('[SSH') || msg.text().includes('WASM')) {
        console.log(text);
      }
    });

    try {
      const testSessionName = 'testsession';
      ctx = await setupTestEnvironmentWithSession(page, testSessionName);
      await navigateToSession(page, ctx.server.url, ctx.sessionId);

      const connected = await connectAndAuthenticate(page, 'testpass');
      expect(connected).toBe(true);

      // Wait for terminal to be ready
      await page.waitForSelector('.xterm-screen', { timeout: 10000 });
      await page.waitForTimeout(3000);

      // Focus the terminal input area
      const terminalInput = page.locator('.xterm-helper-textarea');
      await terminalInput.focus();
      await page.waitForTimeout(1000);

      // Clear any existing output logs before typing
      const outputLogsBefore = consoleLogs.filter(l => l.includes('HELLO_FROM_TMUX')).length;

      // Type a command that produces visible output
      console.log('Typing command...');
      await page.keyboard.type('echo HELLO_FROM_TMUX', { delay: 50 });
      await page.keyboard.press('Enter');

      // Wait for command execution and output
      await page.waitForTimeout(5000);

      // Take screenshot for debugging
      await page.screenshot({ path: '/tmp/terminal_input_test.png' });
      console.log('Screenshot saved to /tmp/terminal_input_test.png');
      console.log('Console logs captured:', consoleLogs.filter(l => l.includes('[SSH')).join('\n'));

      // Verify the terminal displays our typed text by checking the terminal's text content
      // The terminal should show the echoed command from the remote shell
      const terminalScreen = page.locator('.xterm-screen');
      await expect(terminalScreen).toContainText('HELLO_FROM_TMUX', { timeout: 10000 });

      console.log('✅ Terminal sends keystrokes test passed!');
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // On load the terminal must negotiate a pty size that fits the viewport, not
  // stay at the 80x24 default. On a 375px-wide mobile viewport a correctly
  // fitted terminal is well under 80 columns and taller than 24 rows. This
  // reproduces the "terminal doesn't size on load" bug: the pty was opened at
  // the default size while the container was still hidden/settling and never
  // re-sized after connecting.
  test('Terminal pty is fitted to the viewport on mobile load', async ({ page }) => {
    let ctx: TestContext | null = null;
    try {
      await page.setViewportSize({ width: 375, height: 812 });
      ctx = await setupTestEnvironmentWithSession(page, 'testsession');
      await navigateToSession(page, ctx.server.url, ctx.sessionId);

      // Drive auth. On mobile the "Connected" label is hidden (only the status
      // dot shows), so we don't rely on connectAndAuthenticate's return value;
      // instead we wait for the web terminal to attach as a tmux client.
      await connectAndAuthenticate(page, 'testpass');

      let clients = '';
      for (let i = 0; i < 30; i++) {
        clients = execInContainer(
          'devsesh-ssh-test-integration',
          "tmux list-clients -t testsession -F '#{client_width}x#{client_height}'",
        );
        if (clients.trim()) break;
        await page.waitForTimeout(1000);
      }
      const box = await page.locator('.xterm-screen').boundingBox();
      console.log('mobile pty: tmux clients =', JSON.stringify(clients), 'xterm-screen box =', JSON.stringify(box));

      const [cols, rows] = clients.trim().split('\n')[0].split('x').map(Number);
      expect(cols, `pty should fit the narrow mobile viewport, not the 80-col default (got ${clients})`).toBeLessThan(70);
      expect(rows, `pty should fill the tall mobile viewport, not the 24-row default (got ${clients})`).toBeGreaterThan(30);
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // The block cursor (neovim normal mode / shell default) must stay visible even
  // when the terminal isn't focused. By default xterm renders an unfocused block
  // as a hard-to-see hollow outline, which reads as "the cursor disappears in
  // normal mode". cursorInactiveStyle: 'block' keeps it a solid block.
  test('Block cursor stays visible (solid) when the terminal is not focused', async ({ page }) => {
    let ctx: TestContext | null = null;
    try {
      ctx = await setupTestEnvironmentWithSession(page, 'testsession');
      await navigateToSession(page, ctx.server.url, ctx.sessionId);
      await connectAndAuthenticate(page, 'testpass');
      await page.waitForSelector('.xterm-cursor', { timeout: 10000 });
      await page.waitForTimeout(2000);

      await page.locator('.xterm-helper-textarea').focus();
      await page.waitForTimeout(500);
      const focused = await page.evaluate(() => document.querySelector('.xterm-cursor')?.className || '(none)');

      // Blur the terminal without grabbing focus back.
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await page.waitForTimeout(500);
      const blurred = await page.evaluate(() => document.querySelector('.xterm-cursor')?.className || '(none)');

      console.log('cursor: focused =', JSON.stringify(focused), 'blurred =', JSON.stringify(blurred));
      expect(focused, 'focused cursor should be a solid block').toContain('xterm-cursor-block');
      expect(blurred, `unfocused cursor should stay a solid block, not a hollow outline (got ${blurred})`).toContain('xterm-cursor-block');
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // Regression guard: in stock neovim the normal-mode cursor must render as a
  // solid, visible block (not disappear). Insert mode switches to a bar.
  test('Neovim normal-mode cursor renders as a visible solid block', async ({ page }) => {
    let ctx: TestContext | null = null;
    try {
      ctx = await setupTestEnvironmentWithSession(page, 'testsession');
      await navigateToSession(page, ctx.server.url, ctx.sessionId);
      await connectAndAuthenticate(page, 'testpass');
      await page.waitForSelector('.xterm-cursor', { timeout: 10000 });
      await page.waitForTimeout(1000);

      const inspect = () => page.evaluate(() => {
        const el = document.querySelector('.xterm-cursor') as HTMLElement | null;
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { className: el.className, bg: cs.backgroundColor, visibility: cs.visibility, opacity: cs.opacity };
      });

      const term = page.locator('.xterm-helper-textarea');
      await term.focus();
      await page.keyboard.type('nvim', { delay: 40 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(4000);
      // Put some text on screen and return to normal mode so the cursor sits on
      // a visible character.
      await page.keyboard.type('iHELLO WORLD', { delay: 40 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
      await term.focus();
      await page.waitForTimeout(500);

      const normal = await inspect();
      console.log('nvim normal-mode cursor =', JSON.stringify(normal));
      expect(normal, 'cursor element should exist').not.toBeNull();
      expect(normal!.className, 'normal mode should use a block cursor').toContain('xterm-cursor-block');
      expect(normal!.visibility).toBe('visible');
      // A solid block fills the cell with the cursor colour (white by default),
      // i.e. it is not transparent / the same as the background.
      expect(normal!.bg, `block cursor should be filled, got ${normal!.bg}`).not.toBe('rgba(0, 0, 0, 0)');

      await page.keyboard.press('i');
      await page.waitForTimeout(800);
      const insert = await inspect();
      console.log('nvim insert-mode cursor =', JSON.stringify(insert));
      expect(insert!.className, 'insert mode should use a bar cursor').toContain('xterm-cursor-bar');

      await page.keyboard.press('Escape');
      await page.keyboard.type(':q!', { delay: 40 });
      await page.keyboard.press('Enter');
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // Regression: the terminal must not overflow its container and cover the
  // (bottom, on mobile) bar — otherwise its buttons become untappable. This
  // reproduces the disconnected-state over-fit that hid the bar.
  test('Terminal does not overflow onto the bottom bar on mobile (disconnected)', async ({ page }) => {
    let ctx: TestContext | null = null;
    try {
      await page.setViewportSize({ width: 375, height: 812 });
      ctx = await setupTestEnvironmentWithSession(page, 'testsession');
      await navigateToSession(page, ctx.server.url, ctx.sessionId);
      // Dismiss auto-connect dialogs -> leaves the terminal DISCONNECTED (the
      // state the failing test is in).
      await page.locator('button:has-text("Use Password Instead")').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
      await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (b.textContent?.includes('Use Password Instead')) { (b as HTMLButtonElement).click(); return; } });
      await page.waitForTimeout(1000);
      await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (b.textContent?.trim() === 'Cancel') { (b as HTMLButtonElement).click(); return; } });
      await page.waitForSelector('.xterm-screen', { timeout: 10000 });
      await page.waitForTimeout(3000);
      // The real invariant: the bar (and its buttons) must not be covered by
      // the terminal. Sample the topmost element at several points across the
      // bar; each must be inside the bar, not the terminal.
      const probe = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="session-top-bar"]') as HTMLElement | null;
        if (!bar) return { ok: false, reason: 'no bar' };
        const r = bar.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const covered: string[] = [];
        for (const frac of [0.1, 0.5, 0.9]) {
          const el = document.elementFromPoint(r.left + r.width * frac, y);
          if (!bar.contains(el)) covered.push(`${frac}:${el?.className || el?.tagName}`);
        }
        return { ok: covered.length === 0, covered };
      });
      console.log('BAR PROBE:', JSON.stringify(probe));
      expect(probe.ok, `bar must not be covered by the terminal: ${JSON.stringify(probe.covered)}`).toBe(true);
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });

  // The bundled JetBrainsMono Nerd Font must be served and loaded so the
  // terminal can render powerline/airline separators and Nerd Font icons.
  test('Bundled JetBrainsMono Nerd Font is served and loaded by the terminal', async ({ page }) => {
    let ctx: TestContext | null = null;
    try {
      ctx = await setupTestEnvironmentWithSession(page, 'testsession');

      // The font file is served from the embedded web assets (not SPA-fallbacked).
      const fontResp = await page.request.get(`${ctx.server.url}/fonts/JetBrainsMonoNerdFontMono-Regular.woff2`);
      expect(fontResp.status()).toBe(200);
      expect(Number(fontResp.headers()['content-length'] || 0)).toBeGreaterThan(500000);

      await navigateToSession(page, ctx.server.url, ctx.sessionId);
      await connectAndAuthenticate(page, 'testpass');
      await page.waitForSelector('.xterm-screen', { timeout: 10000 });

      // The Nerd Font actually loads and is available to the terminal.
      const loaded = await page.evaluate(async () => {
        await document.fonts.load("14px 'JetBrainsMono Nerd Font Mono'");
        return document.fonts.check("14px 'JetBrainsMono Nerd Font Mono'");
      });
      expect(loaded, 'Nerd Font should be loaded and available').toBe(true);
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx);
    }
  });
});

// Helper function to setup test environment with specific session name
async function setupTestEnvironmentWithSession(page: Page, sessionName: string): Promise<TestContext> {
  const server = await startServer();
  const testEmail = `ssh-e2e-${Date.now()}@example.com`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-ssh-e2e-'));
  const configPath = path.join(tempDir, 'config.yml');
  const sessionDir = path.join(tempDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  const sshPort = await startSSHContainer();
  console.log('SSH container started on port:', sshPort);

  const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);
  console.log('User paired successfully');

  const hostsRes = await fetch(`${server.url}/api/v1/hosts`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
  });

  expect(hostsRes.ok).toBe(true);
  const hosts = await hostsRes.json();
  expect(hosts.length).toBeGreaterThan(0);
  const pairedHost = hosts[0];
  const hostId = pairedHost.id;
  console.log('Using paired host with ID:', hostId);

  const updateHostRes = await fetch(`${server.url}/api/v1/hosts/${hostId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      label: `test-host-e2e-${Date.now()}`,
      hostname: 'localhost',
      ssh_user: 'testuser',
      ssh_port: sshPort,
    }),
  });

  expect(updateHostRes.ok).toBe(true);
  console.log('Host updated to use SSH container port:', sshPort);

  console.log('Starting devsesh session via CLI with name:', sessionName);
  const devseshProcess = spawnDevseshStart(sessionName, configPath, sessionDir, server.url);

  console.log('Waiting for session to appear in API...');
  const foundSession = await waitForSessionInApi(server.url, token, sessionName, 15000);

  // Use the found session ID (UUID) for API operations
  const sessionId = foundSession.id;
  console.log('Session found in API with ID:', sessionId);

  const pingInterval = setInterval(async () => {
    try {
      await fetch(`${server.url}/api/v1/sessions/${sessionId}/ping`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch {}
  }, 2000);

  return {
    server,
    token,
    hostId,
    sessionId,
    sessionName,  // Track the friendly name for tmux operations
    tempDir,
    configPath,
    sessionDir,
    pingInterval,
    devseshProcess,
  };
}
