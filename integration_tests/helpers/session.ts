import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { DevseshProcess, spawnDevsesh, spawnDevseshWithPty, getBinaryPath } from './binary';

const execAsync = promisify(exec);

export interface Session {
  id: string;
  user_id: number;
  name: string;
  hostname: string;
  started_at: string;
  last_ping_at: string | null;
  last_activity_at: string | null;
  ended_at: string | null;
  metadata: string | null;
}

/**
 * Env that gives a test its own private tmux server, so session names such as
 * "testsession" cannot collide with the same name in a test running in parallel.
 * The socket directory sits next to the test's session dir, so every sessions dir
 * under one temp dir shares it.
 *
 * The directory is created here because tmux does NOT create it: if TMUX_TMPDIR
 * points at a missing directory tmux silently falls back to the shared
 * /tmp/tmux-<uid>/default socket, and every parallel test ends up on one server.
 * (Not created when the test's temp dir is already gone, e.g. during cleanup.)
 *
 * TMUX is cleared because tmux prefers the socket named by $TMUX over
 * TMUX_TMPDIR, so a run started from inside tmux would otherwise still use the
 * outer server.
 */
export function isolatedTmuxEnv(sessionDir: string): Record<string, string> {
  const parent = path.dirname(sessionDir);
  const tmuxDir = path.join(parent, 'tmux');
  if (fs.existsSync(parent)) fs.mkdirSync(tmuxDir, { recursive: true });
  return { TMUX_TMPDIR: tmuxDir, TMUX: '' };
}

/**
 * Spawn the devsesh start command.
 * @param sessionName - Name for the session
 * @param configPath - Path to the config file
 * @param sessionDir - Directory for session files
 * @param serverUrl - Server URL for the session
 * @param isolateTmux - run the session on a private tmux server (see
 *   isolatedTmuxEnv). Clean it up with killTmuxSession(name, sessionDir).
 * @returns DevseshProcess object
 */
export function spawnDevseshStart(
  sessionName: string,
  configPath: string,
  sessionDir: string,
  serverUrl: string,
  isolateTmux: boolean = false
): DevseshProcess {
  return spawnDevseshWithPty(['start', sessionName], {
    DEVSESH_CONFIG_FILE: configPath,
    DEVSESH_SESSIONS_DIR: sessionDir,
    DEVSESH_SERVER_URL: serverUrl,
    ...(isolateTmux ? isolatedTmuxEnv(sessionDir) : {}),
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
      if (session.metadata) {
        const metadata = JSON.parse(session.metadata);
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

  // Extra keys are inline (top-level) in the session file — the Go SessionFile
  // uses `yaml:",inline"`, and `devsesh set` writes them at the top level.
  data[key] = value;

  const newContent = yaml.stringify(data);
  fs.writeFileSync(filePath, newContent, 'utf8');
}

/**
 * Spawn `devsesh watch <name>` against an existing tmux session.
 * No PTY is needed: watch observes the session over tmux control mode.
 */
export function spawnDevseshWatch(
  tmuxSessionName: string,
  configPath: string,
  sessionDir: string,
  serverUrl: string
): DevseshProcess {
  return spawnDevsesh(['watch', tmuxSessionName], {
    DEVSESH_CONFIG_FILE: configPath,
    DEVSESH_SESSIONS_DIR: sessionDir,
    DEVSESH_SERVER_URL: serverUrl,
  });
}

/**
 * Create a detached tmux session directly (not via devsesh), as if the user
 * had an existing session they now want devsesh to watch.
 */
export async function tmuxNewSessionDetached(name: string): Promise<void> {
  await execAsync(`tmux new-session -d -s "${name}"`);
}

/**
 * Whether a tmux session with the given name currently exists.
 */
export async function tmuxHasSession(name: string): Promise<boolean> {
  try {
    await execAsync(`tmux has-session -t "${name}"`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll the API until the session's last_ping_at advances past `afterMs`.
 * Returns the ping time (ms). Throws if it never advances within `timeout`.
 */
export async function waitForPingAfter(
  serverUrl: string,
  token: string,
  sessionId: string,
  afterMs: number,
  timeout: number = 15000
): Promise<number> {
  const startTime = Date.now();
  const pollInterval = 500;
  let last = -1;

  while (Date.now() - startTime < timeout) {
    try {
      const session = await getSessionFromApi(serverUrl, token, sessionId);
      if (session.last_ping_at) {
        last = new Date(session.last_ping_at).getTime();
        if (last > afterMs) {
          return last;
        }
      }
    } catch {
      // keep polling
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `last_ping_at did not advance past ${new Date(afterMs).toISOString()} within ${timeout}ms (last seen: ${last > 0 ? new Date(last).toISOString() : 'null'})`
  );
}

/**
 * Poll the API until the session's ended_at becomes non-null. Throws on timeout.
 */
export async function waitForSessionEnded(
  serverUrl: string,
  token: string,
  sessionId: string,
  timeout: number = 15000
): Promise<Session> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeout) {
    try {
      const session = await getSessionFromApi(serverUrl, token, sessionId);
      if (session.ended_at) {
        return session;
      }
    } catch {
      // keep polling
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Session ${sessionId} was not marked ended within ${timeout}ms`);
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
 * @param isolatedSessionDir - the sessions dir of a test that started its session with
 *   isolateTmux, so the session is killed on that test's private tmux server
 */
export async function killTmuxSession(sessionId: string, isolatedSessionDir?: string): Promise<void> {
  const env = isolatedSessionDir ? { ...process.env, ...isolatedTmuxEnv(isolatedSessionDir) } : process.env;
  try {
    await execAsync(`tmux kill-session -t "${sessionId}"`, { env });
  } catch {
    // Session might already be dead, ignore errors
  }
  if (isolatedSessionDir) {
    // The private tmux server belongs to this test alone, so stop it outright, and stop
    // the `devsesh watch` process that `devsesh start` left behind for this session.
    // Both keep touching the socket directory under the test's temp dir for a moment
    // after kill-session; left running they made removing that directory fail with
    // ENOTEMPTY.
    try { await execAsync(`tmux kill-server`, { env }); } catch { /* already gone */ }
    try { await execAsync(`pkill -f -- "[d]evsesh watch ${sessionId} "`); } catch { /* none running */ }
    await new Promise((r) => setTimeout(r, 300));
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

const diagTail = (text: string, max = 3000): string =>
  text.length > max ? `...${text.slice(-max)}` : text;

/**
 * Print everything useful for working out why a `devsesh start` did not show up
 * in the API: its own output, the watcher log and session file, the tmux state,
 * every devsesh start/watch process for that name (with the env that decides
 * which tmux server and sessions dir it uses), and the machine load. Never
 * throws; it runs on the way to a test failure.
 */
export async function dumpStartDiagnostics(
  sessionName: string,
  target: { proc?: DevseshProcess; sessionDir: string }
): Promise<void> {
  const out: string[] = [`[START DIAG] session '${sessionName}' did not register`];
  const section = (title: string, body: string) => out.push(`[START DIAG] --- ${title} ---\n${body.trimEnd()}`);
  const run = async (cmd: string, env?: Record<string, string>): Promise<string> => {
    try {
      const { stdout, stderr } = await execAsync(cmd, { env: { ...process.env, ...env }, timeout: 10000 });
      return `${stdout}${stderr}`;
    } catch (e: any) {
      return `(failed: ${String(e?.stderr || e?.message || e).trim()})`;
    }
  };

  try {
    section('load', `loadavg=${os.loadavg().map((n) => n.toFixed(2)).join(' ')} cpus=${os.cpus().length} freemem=${Math.round(os.freemem() / 1048576)}MB`);

    if (target.proc) {
      section('devsesh start stdout', diagTail(target.proc.stdout));
      section('devsesh start stderr', diagTail(target.proc.stderr));
      section('devsesh start exited?', String(target.proc.process.exitCode ?? 'still running'));
    }

    if (fs.existsSync(target.sessionDir)) {
      for (const f of fs.readdirSync(target.sessionDir)) {
        const p = path.join(target.sessionDir, f);
        const st = fs.statSync(p);
        let body = `${st.size} bytes, modified ${st.mtime.toISOString()}`;
        if (f.endsWith('.yml') || f.endsWith('.log')) {
          body += `\n${diagTail(fs.readFileSync(p, 'utf8'))}`;
        }
        section(`sessions dir: ${f}`, body);
      }
    } else {
      section('sessions dir', `${target.sessionDir} does not exist`);
    }

    const tmuxEnv = isolatedTmuxEnv(target.sessionDir);
    section('tmux (isolated server)', await run('tmux list-sessions 2>&1', tmuxEnv));
    section('tmux (default server)', await run('tmux list-sessions 2>&1'));
    section('tmux socket dir', await run(`ls -la "${tmuxEnv.TMUX_TMPDIR}" 2>&1`));

    const pids = (await run(`pgrep -f "devsesh (start|watch) ${sessionName}"`)).split('\n').filter((l) => /^\d+$/.test(l.trim()));
    const procs: string[] = [];
    for (const pid of pids) {
      const info = await run(`ps -o pid,etime,args -p ${pid} | tail -n +2`);
      let env = '';
      try {
        const vars = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
        env = vars.filter((v) => /^(TMUX_TMPDIR|DEVSESH_SESSIONS_DIR|DEVSESH_CONFIG_FILE|TMUX)=/.test(v)).join(' ');
      } catch { /* process gone */ }
      procs.push(`${info.trim()}\n    ${env}`);
    }
    section(`devsesh start/watch processes named '${sessionName}'`, procs.join('\n') || '(none running)');

    section('docker ps', await run("docker ps --format '{{.Names}} {{.Status}} {{.Ports}}'"));
  } catch (e) {
    out.push(`[START DIAG] diagnostics failed: ${e}`);
  }
  console.log(out.join('\n'));
}

/**
 * waitForSessionInApi for a session launched with `devsesh start`: on timeout it
 * prints dumpStartDiagnostics before rethrowing, so a flaky start leaves evidence.
 */
export async function waitForStartedSession(
  serverUrl: string,
  token: string,
  sessionName: string,
  timeout: number,
  target: { proc?: DevseshProcess; sessionDir: string }
): Promise<Session> {
  try {
    return await waitForSessionInApi(serverUrl, token, sessionName, timeout);
  } catch (err) {
    await dumpStartDiagnostics(sessionName, target);
    throw err;
  }
}
