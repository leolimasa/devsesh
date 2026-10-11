import { test, expect } from '@playwright/test';
import { createHmac } from 'crypto';
import { startServer, stopServer } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import { spawnDevsesh } from '../helpers/binary';
import {
  spawnDevseshWatch,
  waitForSessionInApi,
  waitForSessionMetadata,
  killTmuxSession,
  tmuxNewSessionDetached,
} from '../helpers/session';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as yaml from 'yaml';

const JWT_SECRET = 'integration-test-jwt-secret';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

// Signs an HS256 JWT the same way the server does (claims: sub, host_id, iat, exp).
function signToken(claims: Record<string, unknown>): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/**
 * Reproduces a production bug: after the CLI's host token expires and the user
 * runs `devsesh login` again (new valid token in config.yml), a long-lived
 * `devsesh watch` keeps using the token it loaded at startup. Every request it
 * makes then gets a 401, so `devsesh set status ...` updates the local session
 * file but the change never reaches the server. `devsesh copy` still works
 * because it reads the config fresh on every run.
 */
test.describe('Watch / token refresh', () => {
  test('devsesh set reaches the server after the CLI token is replaced', async ({ page }) => {
    // Host tokens issued at pairing live for only a few seconds.
    const server = await startServer({
      env: { DEVSESH_JWT_SECRET: JWT_SECRET, DEVSESH_JWT_PAIR_EXPIRY: '6s' },
    });
    const testEmail = `test-${Date.now()}@example.com`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-watch-token-'));
    const configPath = path.join(tempDir, 'config.yml');
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    let tmuxSessionName: string | null = null;
    let watchProcess: ReturnType<typeof spawnDevseshWatch> | null = null;

    try {
      // `token` is the browser token (long-lived); we use it only to read the API.
      const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir);

      tmuxSessionName = `watch-token-${Date.now()}`;
      await tmuxNewSessionDetached(tmuxSessionName);

      // The watcher loads the (short-lived) CLI token from config.yml here.
      watchProcess = spawnDevseshWatch(tmuxSessionName, configPath, sessionDir, server.url);
      watchProcess.process.on('error', (err) => console.log('Watch process error:', err));
      const session = await waitForSessionInApi(server.url, token, tmuxSessionName, 30000);

      // Let the watcher's token expire.
      await new Promise((resolve) => setTimeout(resolve, 8000));

      // Simulate `devsesh login` again: swap in a fresh, valid token for the same user/host.
      const config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
      const oldClaims = JSON.parse(Buffer.from(config.jwt_token.split('.')[1], 'base64url').toString());
      const now = Math.floor(Date.now() / 1000);
      config.jwt_token = signToken({ sub: oldClaims.sub, host_id: oldClaims.host_id, iat: now, exp: now + 3600 });
      fs.writeFileSync(configPath, yaml.stringify(config));

      // Run `devsesh set` the way a shell inside the session would.
      const sessionFile = path.join(sessionDir, `${session.id}.yml`);
      const setProc = spawnDevsesh(['set', 'status', 'token-refresh-works'], {
        DEVSESH_CONFIG_FILE: configPath,
        DEVSESH_SESSIONS_DIR: sessionDir,
        DEVSESH_SESSION_FILE: sessionFile,
      });
      expect(await setProc.exitPromise).toBe(0);
      expect(fs.readFileSync(sessionFile, 'utf8')).toContain('token-refresh-works');

      // The new status must reach the server. Today the watcher still sends the
      // expired token, gets 401, and this times out.
      await waitForSessionMetadata(server.url, token, session.id, 'status', 'token-refresh-works', 10000);
    } finally {
      if (watchProcess) watchProcess.process.kill('SIGKILL');
      if (tmuxSessionName) await killTmuxSession(tmuxSessionName);
      await stopServer(server);
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
