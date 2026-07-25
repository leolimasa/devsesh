import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import {
  spawnDevseshStart,
  spawnDevseshWatch,
  waitForSessionInApi,
  waitForSessionFile,
  getSessionFromApi,
  waitForPingAfter,
  waitForSessionEnded,
  sendTmuxCommand,
  killTmuxSession,
  tmuxHasSession,
  tmuxNewSessionDetached,
} from '../helpers/session';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * These tests pin down the core lifecycle bug: liveness (ping) and activity
 * must be bound to the tmux session's real lifetime, NOT to the foreground
 * shell/SSH connection that launched `devsesh start`. When that foreground
 * process dies (SSH disconnect -> SIGHUP) the tmux session lives on in the
 * tmux server daemon, so pings and activity must keep flowing, and the
 * session must only be marked ended when the tmux session truly ends.
 */
test.describe('Watch / session-lifetime binding', () => {
  test('Pings continue after the foreground supervisor is killed', async ({ page }) => {
    const server = await startServer();
    const testEmail = `test-${Date.now()}@example.com`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-watch-ping-'));
    const configPath = path.join(tempDir, 'config.yml');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    let sessionId: string | null = null;
    let tmuxSessionName: string | null = null;

    try {
      const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);

      tmuxSessionName = `watch-ping-${Date.now()}`;
      const sessionProcess = spawnDevseshStart(tmuxSessionName, configPath, sessionDir, server.url);
      sessionProcess.process.on('error', (err) => console.log('Session process error:', err));

      sessionId = await waitForSessionFile(sessionDir, 15000);
      const session = await waitForSessionInApi(server.url, token, tmuxSessionName!, 60000);
      expect(session.ended_at).toBeNull();

      // Kill the foreground supervisor (the `script`-wrapped `devsesh start`),
      // simulating an SSH disconnect / terminal close. The tmux session must
      // survive in the tmux server daemon.
      sessionProcess.process.kill('SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 1500));
      expect(await tmuxHasSession(tmuxSessionName!)).toBe(true);

      // The heartbeat must keep advancing even though the launching process
      // is gone -- this is the whole point of `devsesh watch`.
      const cutoff = Date.now();
      const advanced = await waitForPingAfter(server.url, token, sessionId, cutoff, 20000);
      console.log('Ping advanced to', new Date(advanced).toISOString(), 'after supervisor death');

      // And the session must NOT have been marked ended: the tmux session is
      // still alive.
      const after = await getSessionFromApi(server.url, token, sessionId);
      expect(after.ended_at).toBeNull();
    } finally {
      if (tmuxSessionName) await killTmuxSession(tmuxSessionName);
      await stopServer(server);
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('Activity continues after the foreground supervisor is killed', async ({ page }) => {
    const server = await startServer();
    const testEmail = `test-${Date.now()}@example.com`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-watch-activity-'));
    const configPath = path.join(tempDir, 'config.yml');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    let sessionId: string | null = null;
    let tmuxSessionName: string | null = null;

    try {
      const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);

      tmuxSessionName = `watch-activity-${Date.now()}`;
      const sessionProcess = spawnDevseshStart(tmuxSessionName, configPath, sessionDir, server.url);
      sessionProcess.process.on('error', (err) => console.log('Session process error:', err));

      sessionId = await waitForSessionFile(sessionDir, 15000);
      await waitForSessionInApi(server.url, token, tmuxSessionName!, 60000);

      // Kill the supervisor; tmux session survives.
      sessionProcess.process.kill('SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 1500));
      expect(await tmuxHasSession(tmuxSessionName!)).toBe(true);

      // Let the initial activity seed go stale so we measure a fresh signal.
      await new Promise(resolve => setTimeout(resolve, 2000));
      const before = await getSessionFromApi(server.url, token, sessionId);
      const beforeActivity = before.last_activity_at ? new Date(before.last_activity_at).getTime() : 0;

      // Generate terminal output; the watcher observing the session over tmux
      // control mode must report activity even though the launching process
      // is dead.
      await sendTmuxCommand(tmuxSessionName!, 'echo "still-alive"');

      const startTime = Date.now();
      let advanced = false;
      while (Date.now() - startTime < 15000) {
        const s = await getSessionFromApi(server.url, token, sessionId);
        const a = s.last_activity_at ? new Date(s.last_activity_at).getTime() : 0;
        if (a > beforeActivity) { advanced = true; break; }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      expect(advanced, 'last_activity_at should advance after output post-supervisor-death').toBe(true);
    } finally {
      if (tmuxSessionName) await killTmuxSession(tmuxSessionName);
      await stopServer(server);
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('Session is marked ended only when the tmux session actually ends', async ({ page }) => {
    const server = await startServer();
    const testEmail = `test-${Date.now()}@example.com`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-watch-end-'));
    const configPath = path.join(tempDir, 'config.yml');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    let sessionId: string | null = null;
    let tmuxSessionName: string | null = null;

    try {
      const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);

      tmuxSessionName = `watch-end-${Date.now()}`;
      const sessionProcess = spawnDevseshStart(tmuxSessionName, configPath, sessionDir, server.url);
      sessionProcess.process.on('error', (err) => console.log('Session process error:', err));

      sessionId = await waitForSessionFile(sessionDir, 15000);
      await waitForSessionInApi(server.url, token, tmuxSessionName!, 60000);

      // Detaching the interactive client must NOT end the session. Kill the
      // supervisor and confirm the session stays alive (not ended).
      sessionProcess.process.kill('SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 3000));
      const stillAlive = await getSessionFromApi(server.url, token, sessionId);
      expect(stillAlive.ended_at, 'killing the supervisor must not end the session').toBeNull();

      // Now truly end the tmux session -> the watcher must notify end.
      await killTmuxSession(tmuxSessionName!);
      const ended = await waitForSessionEnded(server.url, token, sessionId, 15000);
      console.log('Session ended_at:', ended.ended_at);
      expect(ended.ended_at).not.toBeNull();
      tmuxSessionName = null;
    } finally {
      if (tmuxSessionName) await killTmuxSession(tmuxSessionName);
      await stopServer(server);
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('devsesh watch registers and monitors a pre-existing tmux session', async ({ page }) => {
    const server = await startServer();
    const testEmail = `test-${Date.now()}@example.com`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-watch-standalone-'));
    const configPath = path.join(tempDir, 'config.yml');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    let sessionId: string | null = null;
    let tmuxSessionName: string | null = null;
    let watchProcess: ReturnType<typeof spawnDevseshWatch> | null = null;

    try {
      const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);

      // A tmux session that already exists, created outside devsesh.
      tmuxSessionName = `watch-standalone-${Date.now()}`;
      await tmuxNewSessionDetached(tmuxSessionName);
      expect(await tmuxHasSession(tmuxSessionName)).toBe(true);

      // Point devsesh at it.
      watchProcess = spawnDevseshWatch(tmuxSessionName, configPath, sessionDir, server.url);
      watchProcess.process.on('error', (err) => console.log('Watch process error:', err));

      // watch should register the session with the server.
      const session = await waitForSessionInApi(server.url, token, tmuxSessionName!, 30000);
      sessionId = session.id;
      expect(session.ended_at).toBeNull();
      expect(session.last_ping_at).not.toBeNull();

      // Heartbeat keeps advancing.
      const cutoff = Date.now();
      await waitForPingAfter(server.url, token, sessionId, cutoff, 20000);

      // Output produces activity.
      const before = await getSessionFromApi(server.url, token, sessionId);
      const beforeActivity = before.last_activity_at ? new Date(before.last_activity_at).getTime() : 0;
      await sendTmuxCommand(tmuxSessionName!, 'echo "watched"');
      const startTime = Date.now();
      let advanced = false;
      while (Date.now() - startTime < 15000) {
        const s = await getSessionFromApi(server.url, token, sessionId);
        const a = s.last_activity_at ? new Date(s.last_activity_at).getTime() : 0;
        if (a > beforeActivity) { advanced = true; break; }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      expect(advanced, 'watch should report activity from control-mode output').toBe(true);

      // Ending the tmux session ends the watched session and stops watch.
      await killTmuxSession(tmuxSessionName!);
      tmuxSessionName = null;
      const ended = await waitForSessionEnded(server.url, token, sessionId, 15000);
      expect(ended.ended_at).not.toBeNull();
    } finally {
      if (watchProcess) watchProcess.process.kill('SIGKILL');
      if (tmuxSessionName) await killTmuxSession(tmuxSessionName);
      await stopServer(server);
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
