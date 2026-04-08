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

  const defaultSessionDir = path.join(os.homedir(), '.devsesh', 'sessions');
  if (fs.existsSync(defaultSessionDir)) {
    const files = fs.readdirSync(defaultSessionDir);
    for (const file of files) {
      if (file.endsWith('.yml')) {
        fs.unlinkSync(path.join(defaultSessionDir, file));
      }
    }
  }
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
