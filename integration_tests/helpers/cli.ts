import { DevseshProcess, spawnDevsesh } from './binary';

export { DevseshProcess as CliProcess };

/**
 * Spawn the devsesh login command and capture output.
 * @param serverUrl - The server URL to connect to
 * @param configPath - Path to the config file to use
 * @returns DevseshProcess object with process, stdout buffer, and exit promise
 */
export function spawnDevseshLogin(serverUrl: string, configPath: string): DevseshProcess {
  return spawnDevsesh(['login', serverUrl], {
    DEVSESH_CONFIG_FILE: configPath,
  });
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
export async function waitForCliSuccess(cliProcess: DevseshProcess, timeout: number = 30000): Promise<void> {
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
