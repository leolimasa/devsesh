import { execSync, exec, spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export interface CliOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCli(args: string[], options: CliOptions = {}): CliResult {
  const devseshBinary = options.env?.DEVSESH_BINARY || process.env.DEVSESH_BINARY || 'devsesh';
  
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
  };

  if (!env.DEVSESH_SESSION_DIR) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-cli-test-'));
    env.DEVSESH_SESSION_DIR = tempDir;
  }

  try {
    const stdout = execSync(`${devseshBinary} ${args.join(' ')}`, {
      cwd: options.cwd,
      env,
      encoding: 'utf-8',
      timeout: options.timeout || 30000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exitCode: error.status ?? 1,
    };
  }
}

export function runCliAsync(args: string[], options: CliOptions = {}): ChildProcess {
  const devseshBinary = options.env?.DEVSESH_BINARY || process.env.DEVSESH_BINARY || 'devsesh';
  
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
  };

  if (!env.DEVSESH_SESSION_DIR) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-cli-test-'));
    env.DEVSESH_SESSION_DIR = tempDir;
  }

  return spawn(devseshBinary, args, {
    cwd: options.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}