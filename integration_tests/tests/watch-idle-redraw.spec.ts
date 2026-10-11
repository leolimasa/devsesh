import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import {
  spawnDevseshWatch,
  waitForSessionInApi,
  getSessionFromApi,
  sendTmuxCommand,
  killTmuxSession,
  tmuxNewSessionDetached,
} from '../helpers/session';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function lastActivity(serverUrl: string, token: string, id: string): Promise<number> {
  const s = await getSessionFromApi(serverUrl, token, id);
  return s.last_activity_at ? new Date(s.last_activity_at).getTime() : 0;
}

/**
 * Programs like nvim redraw an unchanged status line on a timer. That writes to
 * the terminal but changes nothing on screen, so it must not keep the session
 * marked Active. Real changes to the screen must still count as activity.
 */
test.describe('Watch / idle redraw', () => {
  test('redrawing identical content does not count as activity', async ({ page }) => {
    const server = await startServer();
    const testEmail = `test-${Date.now()}@example.com`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-watch-redraw-'));
    const configPath = path.join(tempDir, 'config.yml');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    let tmuxSessionName: string | null = null;
    let watchProcess: ReturnType<typeof spawnDevseshWatch> | null = null;

    try {
      const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);

      tmuxSessionName = `watch-redraw-${Date.now()}`;
      await tmuxNewSessionDetached(tmuxSessionName);

      watchProcess = spawnDevseshWatch(tmuxSessionName, configPath, sessionDir, server.url);
      watchProcess.process.on('error', (err) => console.log('Watch process error:', err));
      const session = await waitForSessionInApi(server.url, token, tmuxSessionName, 30000);

      // Redraw the same text at the same spot every 0.3s, forever.
      await sendTmuxCommand(
        tmuxSessionName,
        "while true; do printf '\\033[1;1Hsame'; sleep 0.3; done",
      );

      // Let the command echo and the first draw settle.
      await sleep(4000);
      const settled = await lastActivity(server.url, token, session.id);

      // Output keeps flowing, but the screen is identical: no new activity.
      await sleep(8000);
      const after = await lastActivity(server.url, token, session.id);
      expect(after, 'identical redraws must not advance last_activity_at').toBe(settled);

      // A real change to the screen still counts.
      await tmuxSendKeysRaw(tmuxSessionName, 'C-c');
      await sendTmuxCommand(tmuxSessionName, 'echo "something-new"');
      const start = Date.now();
      let advanced = false;
      while (Date.now() - start < 15000) {
        if ((await lastActivity(server.url, token, session.id)) > settled) {
          advanced = true;
          break;
        }
        await sleep(500);
      }
      expect(advanced, 'a visible screen change should still advance last_activity_at').toBe(true);
    } finally {
      if (watchProcess) watchProcess.process.kill('SIGKILL');
      if (tmuxSessionName) await killTmuxSession(tmuxSessionName);
      await stopServer(server);
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

async function tmuxSendKeysRaw(session: string, keys: string): Promise<void> {
  const { execFile } = await import('child_process');
  await new Promise<void>((resolve, reject) =>
    execFile('tmux', ['send-keys', '-t', session, keys], (err) => (err ? reject(err) : resolve())),
  );
}
