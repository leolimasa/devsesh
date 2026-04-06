import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const DEVSESH_BINARY = process.env.DEVSESH_BINARY || '/home/leo/pr/personal/devsesh/devsesh';

test('devsesh start creates tmux session', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-start-test-'));
  const sessionDir = path.join(tempDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  const result = spawn(DEVSESH_BINARY, ['start', 'test-session'], {
    env: {
      ...process.env,
      DEVSESH_SESSION_DIR: sessionDir,
      DEVSESH_SERVER_URL: 'http://localhost:8080',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  result.kill();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('devsesh start with custom name', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-custom-test-'));
  const sessionDir = path.join(tempDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  const result = spawn(DEVSESH_BINARY, ['start', 'my-custom-session'], {
    env: {
      ...process.env,
      DEVSESH_SESSION_DIR: sessionDir,
    },
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  result.kill();
  fs.rmSync(tempDir, { recursive: true, force: true });
});