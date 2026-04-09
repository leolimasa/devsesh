import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DevseshProcess {
  process: ChildProcess;
  stdout: string;
  stderr: string;
  exitPromise: Promise<number>;
}

/**
 * Get the path to the devsesh binary.
 * Uses DEVSESH_BINARY_PATH env var if set, otherwise resolves relative to project root.
 */
export function getBinaryPath(): string {
  if (process.env.DEVSESH_BINARY_PATH) {
    return process.env.DEVSESH_BINARY_PATH;
  }

  // Resolve relative to project root (integration_tests/../devsesh)
  return path.resolve(__dirname, '..', '..', 'devsesh');
}

/**
 * Spawn the devsesh binary with the given arguments.
 * @param args - Arguments to pass to the binary
 * @param env - Additional environment variables to set
 * @returns DevseshProcess object with process, stdout/stderr buffers, and exit promise
 */
export function spawnDevsesh(args: string[], env: Record<string, string> = {}): DevseshProcess {
  const binaryPath = getBinaryPath();

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`devsesh binary not found at ${binaryPath}. Set DEVSESH_BINARY_PATH or build the binary first.`);
  }

  const spawnEnv = {
    ...process.env,
    ...env,
  };

  const childProcess = spawn(binaryPath, args, {
    env: spawnEnv,
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
 * Spawn the devsesh binary with a PTY using the script command.
 * This is needed for commands like `devsesh start` that require a terminal.
 * @param args - Arguments to pass to the binary
 * @param env - Additional environment variables to set
 * @returns DevseshProcess object with process, stdout/stderr buffers, and exit promise
 */
export function spawnDevseshWithPty(args: string[], env: Record<string, string> = {}): DevseshProcess {
  const binaryPath = getBinaryPath();

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`devsesh binary not found at ${binaryPath}. Set DEVSESH_BINARY_PATH or build the binary first.`);
  }

  const spawnEnv = {
    ...process.env,
    ...env,
  };

  // Use script to provide a PTY
  // -q: quiet mode, -c: command to run, /dev/null: don't save typescript
  const scriptArgs = ['-q', '-c', `${binaryPath} ${args.join(' ')}`, '/dev/null'];

  const childProcess = spawn('script', scriptArgs, {
    env: spawnEnv,
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
