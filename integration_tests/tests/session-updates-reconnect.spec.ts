import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import { spawnDevseshStart, waitForSessionInApi, killTmuxSession } from '../helpers/session';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Session-updates websocket recovery after a HALF-OPEN drop.
 *
 * The reported failure: leave a tab open across a network interruption (laptop
 * sleep, VPN/wifi flap) and the dashboard silently stops updating -- status
 * lines freeze and `devsesh copy` never surfaces a pill -- until a page reload.
 * The backend is fine throughout; pings keep landing in the DB.
 *
 * The cause was the *shape* of the drop. On a half-open connection the peer
 * never sends a FIN or an RST, so the browser leaves the socket at
 * readyState === OPEN: no "close" event, no "error" event. useSessionUpdates
 * used to reconnect only from ws.onclose, and nothing watched for silence, so
 * the retry chain never started and the tab stayed deaf forever.
 *
 * The fix has two halves and this test fails if either is removed: the server
 * emits an application-level "heartbeat" (browsers do not surface ping/pong to
 * script, so a protocol ping alone gives the page nothing to measure), and the
 * hook tears down a socket that has gone quiet for STALE_MS.
 *
 * We reproduce that shape with routeWebSocket: proxy the real socket, then stop
 * forwarding in both directions WITHOUT closing either end. That is precisely
 * what the page observes during a half-open drop, and it is deterministic --
 * no sleeping the machine, no packet filters.
 *
 * The assertion is the behaviour we want: the app notices it has gone quiet,
 * opens a fresh socket, and live updates resume on their own.
 */
test.describe('Session updates websocket', () => {
  test('recovers on its own after a half-open drop (no close event)', async ({ page, context }) => {
    test.setTimeout(240000);
    const server = await startServer();
    const email = `wsdrop-${Date.now()}@example.com`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-wsdrop-'));
    const configPath = path.join(tempDir, 'config.yml');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    const names: string[] = [];

    // Every intercepted session-updates socket, in the order the page opened
    // them, each with a `wedge()` that silences it without closing it.
    const sockets: { wedge: () => void; wedged: () => boolean }[] = [];

    // Equivalent to `devsesh copy`.
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

    try {
      const token = await setupPairedCli(page, server.url, email, configPath, sessionDir);
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });

      // Proxy ONLY the session-updates socket -- the SSH terminal opens its own
      // websockets to /api/v1/hosts/{id}/ssh and must pass through untouched.
      await page.routeWebSocket('**/api/v1/sessions/updates', (ws) => {
        let dead = false;
        const upstream = ws.connectToServer();
        ws.onMessage((m) => { if (!dead) upstream.send(m); });
        upstream.onMessage((m) => { if (!dead) ws.send(m); });
        sockets.push({ wedge: () => { dead = true; }, wedged: () => dead });
      });

      const name = `wsdrop-${Date.now()}`;
      spawnDevseshStart(name, configPath, sessionDir, server.url);
      names.push(name);
      const session = await waitForSessionInApi(server.url, token, name, 30000);

      await page.goto(`${server.url}/sessions/${session.id}`);
      await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}`), { timeout: 10000 });
      await expect(page.getByTestId('session-detail-panel')).toBeVisible({ timeout: 15000 });

      const pill = page.getByTestId('clipboard-pill');

      // A clipboard push is a fire-and-forget broadcast: the server fans it out
      // to whoever is registered in the hub RIGHT THEN and stores nothing. A
      // socket existing is not the same as that socket having finished its
      // token handshake and been registered, so a single push can land in the
      // gap and vanish without a trace. Retry until one gets through -- the
      // property under test is "updates flow", not "this exact POST arrived".
      const pushUntilDelivered = async (text: string, timeout: number) => {
        await expect(async () => {
          expect(await pushClipboard(session.id, text, token)).toBe(204);
          await expect(pill).toBeVisible({ timeout: 2000 });
        }).toPass({ timeout });
      };

      // --- Baseline: the feed is live before we break anything. ---
      await expect.poll(() => sockets.length, { timeout: 15000 }).toBeGreaterThan(0);
      await pushUntilDelivered('before the drop', 30000);
      await page.getByTestId('clipboard-copy').click();
      await expect(pill).toBeHidden({ timeout: 10000 });

      // --- The drop: silence the socket, leaving it OPEN. ---
      // From here the page receives nothing and is told nothing. The session
      // keeps pinging every 5s server-side, so there IS traffic being missed --
      // a heartbeat or staleness check has something to notice.
      const first = sockets[0];
      first.wedge();

      // --- Recovery: the app must open a NEW socket on its own. ---
      // The hook gives up on a quiet socket after STALE_MS (45s), checked on a
      // 5s tick, then reconnects immediately. 90s leaves generous slack.
      await expect
        .poll(() => sockets.length, {
          timeout: 90000,
          message:
            'the page never opened a second session-updates socket after the ' +
            'half-open drop -- ws.onclose never fired, so nothing scheduled a retry',
        })
        .toBeGreaterThan(1);

      // --- And the replacement must actually carry updates. ---
      // Same registration race as the baseline, so retry the same way. This
      // cannot paper over a missing fix: the wedge is permanent, so if the app
      // had not reconnected, no number of pushes would ever raise the pill.
      await pushUntilDelivered('after the drop', 30000);
      await expect(pill).toContainText('Clipboard ready');
      await page.getByTestId('clipboard-copy').click();
      await expect(pill).toBeHidden({ timeout: 10000 });

      // The wedged socket stayed wedged: recovery came from a new connection,
      // not from the test accidentally un-breaking the old one.
      expect(first.wedged()).toBe(true);
    } finally {
      for (const n of names) {
        try { killTmuxSession(n); } catch { /* ignore */ }
      }
      await stopServer(server);
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
