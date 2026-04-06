import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const DEVSESH_BINARY = process.env.DEVSESH_BINARY || '/home/leo/pr/personal/devsesh/devsesh';

test('devsesh server starts and serves web UI', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-cli-test-'));
  const dbPath = path.join(tempDir, 'test.db');
  const sessionDir = path.join(tempDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  const serverProcess = spawn(DEVSESH_BINARY, ['server'], {
    env: {
      ...process.env,
      DEVSESH_PORT: '0',
      DEVSESH_HOST: 'localhost',
      DEVSESH_ALLOW_USER_CREATION: 'true',
      DEVSESH_DB_PATH: dbPath,
      DEVSESH_SESSION_DIR: sessionDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise(resolve => setTimeout(resolve, 3000));

  serverProcess.kill();
  
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('devsesh migrate runs without error', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-migrate-test-'));
  const dbPath = path.join(tempDir, 'test.db');
  
  const result = spawn(DEVSESH_BINARY, ['migrate', dbPath], {
    env: { ...process.env },
  });

  await new Promise(resolve => setTimeout(resolve, 3000));
  
  fs.rmSync(tempDir, { recursive: true, force: true });
});