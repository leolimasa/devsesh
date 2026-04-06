import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let serverPort = 19000;

export interface ServerOptions {
  port?: number;
  allowUserCreation?: boolean;
  jwtSecret?: string;
  devseshBinary?: string;
}

export interface ServerInstance {
  url: string;
  port: number;
  process: ChildProcess;
  cleanup: () => Promise<void>;
  tempDir: string;
  dbPath: string;
}

async function waitForServer(url: string, timeout: number = 30000): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode === 200 || res.statusCode === 401 || res.statusCode === 404) {
            resolve();
          } else {
            reject(new Error(`Unexpected status code: ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
      });
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw new Error('Server did not start in time');
}

export async function startServer(options: ServerOptions = {}): Promise<ServerInstance> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-test-'));
  const port = options.port || (serverPort++);
  const dbPath = path.join(tempDir, 'devsesh.db');
  const sessionDir = path.join(tempDir, 'sessions');
  
  fs.mkdirSync(sessionDir, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DEVSESH_PORT: port.toString(),
    DEVSESH_HOST: 'localhost',
    DEVSESH_ALLOW_USER_CREATION: options.allowUserCreation ? 'true' : 'false',
    DEVSESH_JWT_SECRET: options.jwtSecret || 'test-secret-key-for-integration-tests',
    DEVSESH_SESSION_DIR: sessionDir,
  };

  if (dbPath) {
    env.DEVSESH_DB_PATH = dbPath;
  }

  const devseshBinary = options.devseshBinary || process.env.DEVSESH_BINARY || 'devsesh';

  const serverProcess = spawn(devseshBinary, ['server'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stderr?.on('data', (data) => {
    console.error(`Server stderr: ${data}`);
  });

  const url = `http://localhost:${port}`;
  
  try {
    await waitForServer(url);
  } catch (err) {
    serverProcess.kill();
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`Server failed to start: ${err}`);
  }

  const cleanup = async (): Promise<void> => {
    try {
      serverProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    } catch {
    }
    
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
    }
  };

  return {
    url,
    port,
    process: serverProcess,
    cleanup,
    tempDir,
    dbPath,
  };
}

export async function stopServer(instance: ServerInstance): Promise<void> {
  await instance.cleanup();
}