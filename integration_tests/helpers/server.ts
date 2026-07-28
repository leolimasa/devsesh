import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnDevsesh } from './binary';

export interface ServerInstance {
  url: string;
  port: number;
  process: ChildProcess;
  dbPath: string;
  sessionDir: string;
}

export interface ServerOptions {
  timeout?: number;
}

const DEFAULT_TIMEOUT = 30000;

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = require('net').createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-test-'));
}

export async function waitForServer(url: string, timeout = DEFAULT_TIMEOUT): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 200;

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`${url}/api/v1/auth/status`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Server did not become ready within ${timeout}ms`);
}

export async function startServer(options: ServerOptions = {}): Promise<ServerInstance> {
  const port = await findAvailablePort();
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'devsesh.db');
  const sessionDir = path.join(tempDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  const url = `http://localhost:${port}`;

  const devseshProcess = spawnDevsesh(['server'], {
    DEVSESH_DB_PATH: dbPath,
    DEVSESH_PORT: port.toString(),
    DEVSESH_HOST: 'localhost',
    DEVSESH_RP_ID: 'localhost',
    DEVSESH_RP_ORIGIN: url,
    DEVSESH_ALLOW_USER_CREATION: 'true',
    DEVSESH_SESSION_DIR: sessionDir,
  });

  // Log all output from the server process
  devseshProcess.process.stdout?.on('data', (data: Buffer) => {
    console.log('[SERVER stdout]:', data.toString().trim());
  });
  devseshProcess.process.stderr?.on('data', (data: Buffer) => {
    console.log('[SERVER stderr]:', data.toString().trim());
  });

  devseshProcess.process.on('error', (err) => {
    console.error('Server process error:', err);
  });

  try {
    await waitForServer(url, options.timeout);
  } catch (err) {
    devseshProcess.process.kill('SIGTERM');
    throw err;
  }

  return {
    url,
    port,
    process: devseshProcess.process,
    dbPath,
    sessionDir,
  };
}

/**
 * Restart the server in place: kill the process but KEEP the db, session dir,
 * and port. Because the JWT secret is persisted in the db (server_config), the
 * client's token, host, and session all survive, so the page can auto-reconnect
 * to the same URL -- faithfully reproducing an apps1-style server reboot (every
 * WebSocket drops and server-side proxy state is wiped, while the browser keeps
 * its wasm SSH connection state).
 */
export async function restartServer(
  instance: ServerInstance,
  options: ServerOptions = {},
): Promise<ServerInstance> {
  instance.process.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      instance.process.kill('SIGKILL');
      resolve();
    }, 5000);
    instance.process.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  const devseshProcess = spawnDevsesh(['server'], {
    DEVSESH_DB_PATH: instance.dbPath,
    DEVSESH_PORT: instance.port.toString(),
    DEVSESH_HOST: 'localhost',
    DEVSESH_RP_ID: 'localhost',
    DEVSESH_RP_ORIGIN: instance.url,
    DEVSESH_ALLOW_USER_CREATION: 'true',
    DEVSESH_SESSION_DIR: instance.sessionDir,
  });

  devseshProcess.process.stdout?.on('data', (data: Buffer) => {
    console.log('[SERVER stdout]:', data.toString().trim());
  });
  devseshProcess.process.stderr?.on('data', (data: Buffer) => {
    console.log('[SERVER stderr]:', data.toString().trim());
  });

  await waitForServer(instance.url, options.timeout);

  return { ...instance, process: devseshProcess.process };
}

export async function stopServer(instance: ServerInstance): Promise<void> {
  instance.process.kill('SIGTERM');

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      instance.process.kill('SIGKILL');
      resolve();
    }, 5000);

    instance.process.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  if (fs.existsSync(instance.dbPath)) {
    fs.unlinkSync(instance.dbPath);
  }

  const tempDir = path.dirname(instance.dbPath);
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  // NOTE: Do NOT clean up ~/.devsesh/sessions here. The server is fully
  // redirected to the per-run temp session dir via DEVSESH_SESSION_DIR (removed
  // with tempDir above), so there is nothing of ours to clean in the real home
  // dir — and deleting *.yml there wipes the developer's live local sessions
  // (the dashboard state for currently-running devsesh sessions).
}

/**
 * Remove test config file if it exists.
 * @param configPath - Path to the config file to clean up
 */
export function cleanupTestConfig(configPath: string): void {
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}
