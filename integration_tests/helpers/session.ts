import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { DevseshProcess, spawnDevseshWithPty, getBinaryPath } from './binary';

const execAsync = promisify(exec);

export interface Session {
  id: string;
  user_id: number;
  name: string;
  hostname: string;
  started_at: string;
  last_ping_at: string | null;
  ended_at: string | null;
  metadata: string | null;
}

/**
 * Spawn the devsesh start command.
 * @param sessionName - Name for the session
 * @param configPath - Path to the config file
 * @param sessionDir - Directory for session files
 * @param serverUrl - Server URL for the session
 * @returns DevseshProcess object
 */
export function spawnDevseshStart(
  sessionName: string,
  configPath: string,
  sessionDir: string,
  serverUrl: string
): DevseshProcess {
  return spawnDevseshWithPty(['start', sessionName], {
    DEVSESH_CONFIG_FILE: configPath,
    DEVSESH_SESSIONS_DIR: sessionDir,
    DEVSESH_SERVER_URL: serverUrl,
  });
}

/**
 * Wait for a session with the given name to appear in the API.
 * @param serverUrl - Server URL
 * @param token - JWT token for authentication
 * @param sessionName - Name of the session to find
 * @param timeout - Timeout in milliseconds (default 30000)
 * @returns Session object when found
 */
export async function waitForSessionInApi(
  serverUrl: string,
  token: string,
  sessionName: string,
  timeout: number = 30000
): Promise<Session> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`${serverUrl}/api/v1/sessions`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const sessions: Session[] = await response.json();
        const session = sessions.find(s => s.name === sessionName);
        if (session) {
          return session;
        }
      }
    } catch {
      // API not ready yet
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Session '${sessionName}' did not appear in API within ${timeout}ms`);
}

/**
 * Fetch a specific session by ID from the API.
 * @param serverUrl - Server URL
 * @param token - JWT token for authentication
 * @param sessionId - ID of the session to fetch
 * @returns Session object
 */
export async function getSessionFromApi(
  serverUrl: string,
  token: string,
  sessionId: string
): Promise<Session> {
  const response = await fetch(`${serverUrl}/api/v1/sessions/${sessionId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch session: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Wait for session metadata to contain a specific key-value pair.
 * @param serverUrl - Server URL
 * @param token - JWT token for authentication
 * @param sessionId - ID of the session
 * @param key - Key to look for in metadata
 * @param value - Expected value (optional, if not provided just checks key exists)
 * @param timeout - Timeout in milliseconds (default 10000)
 * @returns Session object when metadata matches
 */
export async function waitForSessionMetadata(
  serverUrl: string,
  token: string,
  sessionId: string,
  key: string,
  value?: string,
  timeout: number = 10000
): Promise<Session> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeout) {
    try {
      const session = await getSessionFromApi(serverUrl, token, sessionId);
      if (session.Metadata) {
        const metadata = JSON.parse(session.Metadata);
        if (key in metadata) {
          if (value === undefined || metadata[key] === value) {
            return session;
          }
        }
      }
    } catch {
      // Keep polling
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Session metadata did not contain key '${key}' within ${timeout}ms`);
}

/**
 * Update the session YAML file directly.
 * @param sessionDir - Directory containing session files
 * @param sessionId - Session ID (filename without .yml)
 * @param key - Key to set in the extra section
 * @param value - Value to set
 */
export function updateSessionYamlFile(
  sessionDir: string,
  sessionId: string,
  key: string,
  value: string
): void {
  const filePath = path.join(sessionDir, `${sessionId}.yml`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Session file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const data = yaml.parse(content);

  // Initialize extra section if it doesn't exist
  if (!data.extra) {
    data.extra = {};
  }

  data.extra[key] = value;

  const newContent = yaml.stringify(data);
  fs.writeFileSync(filePath, newContent, 'utf8');
}

/**
 * Send a command to a tmux session.
 * @param sessionId - tmux session ID
 * @param command - Command to send
 */
export async function sendTmuxCommand(sessionId: string, command: string): Promise<void> {
  try {
    await execAsync(`tmux send-keys -t "${sessionId}" "${command}" Enter`);
  } catch (error) {
    throw new Error(`Failed to send tmux command: ${error}`);
  }
}

/**
 * Kill a tmux session.
 * @param sessionId - tmux session ID to kill
 */
export async function killTmuxSession(sessionId: string): Promise<void> {
  try {
    await execAsync(`tmux kill-session -t "${sessionId}"`);
  } catch {
    // Session might already be dead, ignore errors
  }
}

/**
 * Find the session YAML file in a directory.
 * @param sessionDir - Directory to search
 * @returns Session ID (filename without .yml) or null if not found
 */
export function findSessionFile(sessionDir: string): string | null {
  if (!fs.existsSync(sessionDir)) {
    return null;
  }

  const files = fs.readdirSync(sessionDir);
  const ymlFile = files.find(f => f.endsWith('.yml'));

  if (!ymlFile) {
    return null;
  }

  return ymlFile.replace('.yml', '');
}

/**
 * Wait for a session file to appear in the session directory.
 * @param sessionDir - Directory to watch
 * @param timeout - Timeout in milliseconds (default 10000)
 * @returns Session ID when file appears
 */
export async function waitForSessionFile(
  sessionDir: string,
  timeout: number = 10000
): Promise<string> {
  const startTime = Date.now();
  const pollInterval = 200;

  while (Date.now() - startTime < timeout) {
    const sessionId = findSessionFile(sessionDir);
    if (sessionId) {
      return sessionId;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`No session file appeared in ${sessionDir} within ${timeout}ms`);
}
