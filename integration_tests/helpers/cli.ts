import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';

export interface CliProcess {
  process: ChildProcess;
  stdout: string;
  stderr: string;
  exitPromise: Promise<number>;
}

/**
 * Spawn the devsesh login command and capture output.
 * @param serverUrl - The server URL to connect to
 * @param configPath - Path to the config file to use
 * @returns CliProcess object with process, stdout buffer, and exit promise
 */
export function spawnDevseshLogin(serverUrl: string, configPath: string): CliProcess {
  const binaryPath = '/home/leo/pr/personal/devsesh/devsesh';
  
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`devsesh binary not found at ${binaryPath}`);
  }

  const env = {
    ...process.env,
    DEVSESH_CONFIG_FILE: configPath,
  };

  const childProcess = spawn(binaryPath, ['login', serverUrl], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  childProcess.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  childProcess.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const exitPromise = new Promise<number>((resolve) => {
    childProcess.on('close', (code: number | null) => {
      resolve(code ?? 0);
    });
  });

  return {
    process: childProcess,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    exitPromise,
  };
}

/**
 * Extract pairing code from CLI output.
 * @param output - CLI stdout output
 * @returns Pairing code if found, null otherwise
 */
export function extractPairingCode(output: string): string | null {
  const match = output.match(/Pairing code:\s*([A-Z0-9]+)/i);
  return match ? match[1] : null;
}

/**
 * Wait for CLI to exit successfully.
 * @param cliProcess - The CLI process to monitor
 * @param timeout - Timeout in milliseconds
 * @throws Error if timeout exceeded or non-zero exit code
 */
export async function waitForCliSuccess(cliProcess: CliProcess, timeout: number = 30000): Promise<void> {
  const { exitPromise } = cliProcess;

  const result = await Promise.race([
    exitPromise.then((code) => ({ success: code === 0, code })),
    new Promise<{ success: false; code: number }>((_, reject) =>
      setTimeout(() => reject(new Error(`CLI command timed out after ${timeout}ms`)), timeout)
    ),
  ]);

  if (!result.success) {
    throw new Error(`CLI command failed with exit code ${result.code}`);
  }
}
