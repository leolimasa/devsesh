/**
 * SSH Container Helpers
 *
 * Shared utilities for managing SSH test containers across integration tests.
 * This module centralizes Docker container management to ensure consistent
 * behavior across all SSH-related tests.
 */

import { execSync } from 'child_process'

export interface SSHContainerOptions {
  /** Container name (used for docker operations) */
  name: string
  /** Host port to bind (container always uses port 22) */
  port: number
  /** CA public key for certificate-based auth (optional) */
  caPublicKey?: string
  /** Content for the flag file (optional, defaults to SSH_CA_TEST_SUCCESS) */
  flagContent?: string
}

export interface SSHContainer {
  id: string
  name: string
  port: number
}

/**
 * Start an SSH test container.
 *
 * The container:
 * - Runs OpenSSH server on port 22
 * - Has user "testuser" with password "testpass"
 * - Creates a tmux session "testsession"
 * - Optionally configures CA certificate trust
 * - Optionally creates a flag file for verification
 *
 * @param options - Container configuration
 * @returns Container information
 */
export async function startSSHContainer(options: SSHContainerOptions): Promise<SSHContainer> {
  const { name, port, caPublicKey, flagContent } = options

  // Remove any existing container with this name
  try {
    execSync(`docker rm -f ${name}`, { stdio: 'ignore' })
  } catch {
    // Container doesn't exist, that's fine
  }

  // Build docker run command with environment variables
  const envArgs: string[] = []

  if (caPublicKey) {
    // Escape single quotes in the CA key
    const escapedKey = caPublicKey.replace(/'/g, "'\\''")
    envArgs.push(`-e CA_PUBLIC_KEY='${escapedKey}'`)
  }

  if (flagContent) {
    envArgs.push(`-e FLAG_CONTENT='${flagContent}'`)
  }

  const envString = envArgs.join(' ')
  const command = `docker run -d -p ${port}:22 --name ${name} ${envString} devsesh-ssh-test`

  const containerId = execSync(command, { encoding: 'utf8' }).trim()
  console.log(`[SSH Container] Started ${name}: ${containerId.substring(0, 12)}`)

  // Wait for container to be ready (SSH service to start)
  await waitForSSHReady(name, 30000)

  return {
    id: containerId,
    name,
    port,
  }
}

/**
 * Wait for SSH service to be ready in the container.
 */
async function waitForSSHReady(containerName: string, timeout: number): Promise<void> {
  const startTime = Date.now()
  const pollInterval = 500

  while (Date.now() - startTime < timeout) {
    try {
      // Check if sshd is running by looking at the process list
      // Note: sshd process name may include extra info like "sshd: /usr/sbin/sshd -E ..."
      // so we use pgrep without -x flag to match partial process names
      const result = execSync(`docker exec ${containerName} pgrep sshd`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      if (result.trim()) {
        // Also verify the port is listening
        try {
          execSync(`docker exec ${containerName} nc -z localhost 22`, {
            stdio: ['pipe', 'pipe', 'pipe'],
          })
          console.log(`[SSH Container] SSH service ready in ${containerName}`)
          return
        } catch {
          // Port not ready yet, keep waiting
        }
      }
    } catch {
      // sshd not running yet
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }

  throw new Error(`SSH service did not become ready in ${containerName} within ${timeout}ms`)
}

/**
 * Stop and remove an SSH container.
 */
export async function stopSSHContainer(container: SSHContainer): Promise<void> {
  try {
    execSync(`docker rm -f ${container.name}`, { stdio: 'ignore' })
    console.log(`[SSH Container] Stopped ${container.name}`)
  } catch {
    // Container might already be removed
  }
}

/**
 * Stop a container by name.
 */
export async function stopSSHContainerByName(name: string): Promise<void> {
  try {
    execSync(`docker rm -f ${name}`, { stdio: 'ignore' })
    console.log(`[SSH Container] Stopped ${name}`)
  } catch {
    // Container might not exist
  }
}

/**
 * Execute a command inside the container as testuser.
 *
 * @param containerName - Name of the container
 * @param command - Command to execute
 * @returns Command output
 */
export function execInContainer(containerName: string, command: string): string {
  return execSync(`docker exec ${containerName} su - testuser -c "${command}"`, {
    encoding: 'utf8',
  }).trim()
}

/**
 * Execute a command inside the container as root.
 */
export function execInContainerAsRoot(containerName: string, command: string): string {
  return execSync(`docker exec ${containerName} ${command}`, {
    encoding: 'utf8',
  }).trim()
}

/**
 * Check if the container has a tmux session with the given name.
 */
export function hasTmuxSession(containerName: string, sessionName: string): boolean {
  try {
    execInContainer(containerName, `tmux has-session -t '${sessionName}'`)
    return true
  } catch {
    return false
  }
}

/**
 * Create a tmux session in the container.
 */
export function createTmuxSession(containerName: string, sessionName: string): void {
  try {
    execInContainer(containerName, `tmux new-session -d -s '${sessionName}'`)
    console.log(`[SSH Container] Created tmux session '${sessionName}' in ${containerName}`)
  } catch (err) {
    console.log(`[SSH Container] Warning: Could not create tmux session:`, err)
  }
}

/**
 * Get container logs for debugging.
 */
export function getContainerLogs(containerName: string): string {
  try {
    return execSync(`docker logs ${containerName} 2>&1`, { encoding: 'utf8' })
  } catch {
    return ''
  }
}

/**
 * Get SSH server logs from the container.
 */
export function getSSHServerLogs(containerName: string): string {
  try {
    return execSync(`docker exec ${containerName} cat /tmp/sshd.log 2>&1`, { encoding: 'utf8' })
  } catch {
    return getContainerLogs(containerName)
  }
}

/**
 * Verify the container has CA certificate authentication configured.
 */
export function verifyCAConfiguration(containerName: string): boolean {
  const logs = getContainerLogs(containerName)
  return logs.includes('SSH CA configuration complete') &&
         logs.includes('CA public key installed')
}

/**
 * Read the flag file content from the container.
 */
export function readFlagFile(containerName: string): string {
  return execInContainerAsRoot(containerName, 'cat /home/testuser/FLAG_FILE').trim()
}
