/**
 * SSH CA End-to-End Integration Test
 *
 * Tests the complete flow of certificate-based SSH authentication using
 * FROST threshold signatures:
 *
 * 1. Register new user with WebAuthn + PRF [req.ancud7]
 * 2. Verify CA public key is created
 * 3. Verify encrypted client share is stored
 * 4. Start SSH container with CA trust [req.vz2fg3] [req.17dfwk]
 * 5. Create host with principal, no password [req.4whcli]
 * 6. Connect via web interface using CERTIFICATE AUTH ONLY [req.twjlw7]
 * 7. Execute cat FLAG_FILE and verify output [req.xbft6g]
 *
 * IMPORTANT: The web interface portion of this test MUST use certificate
 * authentication (PRF + FROST). Password authentication is NOT allowed
 * for the web interface connection.
 *
 * References: [req.jc1drs]
 */

import { test, expect, Page, BrowserContext } from '@playwright/test'
import { startServer, stopServer, restartServer, ServerInstance } from '../helpers/server'
import {
  setupPRFAuthenticator,
  registerUserWithPRF,
  verifySSHCACreated,
  verifyClientShareExists,
  fetchCAPublicKey,
} from '../helpers/prf-auth'
import {
  startSSHContainer,
  stopSSHContainer,
  SSHContainer,
  verifyCAConfiguration,
  readFlagFile,
  getSSHServerLogs,
  getContainerLogs,
  hasTmuxSession,
  createTmuxSession,
  execInContainer,
} from '../helpers/ssh-container'
import { getUserIdByEmail } from '../helpers/enrollment'
import { spawnDevseshStart, killTmuxSession, waitForSessionInApi } from '../helpers/session'
import { spawnDevseshLogin, extractPairingCode, waitForCliSuccess } from '../helpers/cli'
import { enterPairingCode } from '../helpers/pairing'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

// Expected flag file content
const FLAG_CONTENT = 'SSH_CA_TEST_FLAG_12345'

// Unique container name for this test file
const CONTAINER_NAME = 'devsesh-ssh-ca-test'

/**
 * Test context for SSH CA tests
 */
interface SSHCATestContext {
  server: ServerInstance
  container: SSHContainer
  token: string
  email: string
  hostId: number
  sessionId: string
  sessionName: string
  tempDir: string
  configPath: string
  sessionDir: string
  pingInterval: NodeJS.Timeout | null
  devseshProcess: any
  caPublicKey: string
}

/**
 * Set up a complete test environment for SSH CA testing.
 *
 * This follows the standard pattern from ssh-e2e.spec.ts but adds:
 * 1. PRF-enabled virtual authenticator
 * 2. CA public key configuration for the container
 * 3. Host without password (certificate auth only)
 */
async function setupSSHCATestEnvironment(
  page: Page,
  context: BrowserContext
): Promise<SSHCATestContext> {
  // Create temp directory for CLI
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-sshca-e2e-'))
  const configPath = path.join(tempDir, 'config.yml')
  const sessionDir = path.join(tempDir, 'sessions')
  fs.mkdirSync(sessionDir, { recursive: true })

  // Start server
  const server = await startServer()
  console.log('[SSH CA] Server started at:', server.url)

  // Set up virtual authenticator with PRF support
  // This MUST be done before any page navigation
  await setupPRFAuthenticator(context, page)
  console.log('[SSH CA] PRF authenticator set up')

  // Set up console logging for debugging
  page.on('console', msg => {
    const text = msg.text()
    if (text.includes('PRF') || text.includes('FROST') || text.includes('SSH') ||
        text.includes('certificate') || text.includes('WebAuthn') ||
        text.includes('error') || text.includes('Error')) {
      console.log(`[BROWSER ${msg.type()}] ${text}`)
    }
  })

  // Register user with WebAuthn + PRF
  // This creates FROST key shares on the server
  const email = `sshca-e2e-${Date.now()}@example.com`
  console.log('[SSH CA] Registering user:', email)
  const { token } = await registerUserWithPRF(page, server.url, email)
  console.log('[SSH CA] User registered successfully')

  // Verify SSH CA data was created
  const sshcaExists = await verifySSHCACreated(server.dbPath, email)
  if (!sshcaExists) {
    throw new Error('SSH CA data was not created during registration')
  }
  console.log('[SSH CA] SSH CA data verified in database')

  // Verify encrypted client share exists
  const clientShareExists = await verifyClientShareExists(server.dbPath, email)
  if (!clientShareExists) {
    throw new Error('Encrypted client share was not stored')
  }
  console.log('[SSH CA] Encrypted client share verified in database')

  // Fetch the CA public key
  const caPublicKey = await fetchCAPublicKey(server.url, token)
  console.log('[SSH CA] CA public key fetched:', caPublicKey.substring(0, 50) + '...')

  // Start SSH container with CA trust and flag file
  const container = await startSSHContainer({
    name: CONTAINER_NAME,
    port: 2223,
    caPublicKey,
    flagContent: FLAG_CONTENT,
  })
  console.log('[SSH CA] Container started on port:', container.port)

  // Verify CA is configured
  if (!verifyCAConfiguration(container.name)) {
    throw new Error('Container CA configuration failed')
  }
  console.log('[SSH CA] Container CA configuration verified')

  // Verify flag file exists
  const flagContent = readFlagFile(container.name)
  if (flagContent !== FLAG_CONTENT) {
    throw new Error(`Flag file content mismatch: expected "${FLAG_CONTENT}", got "${flagContent}"`)
  }
  console.log('[SSH CA] Flag file verified in container')

  // Verify tmux session "testsession" exists (created by entrypoint.sh)
  if (!hasTmuxSession(container.name, 'testsession')) {
    throw new Error('tmux session "testsession" not found in container')
  }
  console.log('[SSH CA] tmux session "testsession" verified in container')

  // Pair the CLI with the server
  await page.goto(`${server.url}/pair`)
  await expect(page).toHaveURL(/\/pair/)

  // Spawn devsesh login
  const cliProcess = spawnDevseshLogin(server.url, configPath, sessionDir)

  // Wait for pairing code
  let pairingCode: string | null = null
  const pairingTimeout = 15000
  const startTime = Date.now()

  while (Date.now() - startTime < pairingTimeout) {
    pairingCode = extractPairingCode(cliProcess.stdout)
    if (pairingCode) break
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  if (!pairingCode) {
    throw new Error('Pairing code not found')
  }

  // Enter pairing code
  const codeInput = page.locator('input[placeholder="ABC123"]')
  await expect(codeInput).toBeVisible()
  await codeInput.fill(pairingCode)

  // Click create new host
  const createHostButton = page.locator('button:has-text("Create New Host")')
  await expect(createHostButton).toBeVisible()
  await createHostButton.click()

  // Fill host details
  const labelInput = page.locator('input[placeholder*="Label"]')
  const hostnameInput = page.locator('input[placeholder*="Hostname"]')
  await expect(labelInput).toBeVisible()
  await expect(hostnameInput).toBeVisible()
  await labelInput.fill('SSH CA Test Host')
  await hostnameInput.fill('localhost')

  // Submit pairing
  const submitButton = page.locator('button:has-text("Pair Device")')
  await expect(submitButton).toBeVisible()
  await submitButton.click()

  // Wait for success
  await Promise.race([
    expect(page.getByText('Device paired successfully', { exact: false })).toBeVisible({ timeout: 10000 }),
    expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 }),
  ])

  await waitForCliSuccess(cliProcess)
  console.log('[SSH CA] CLI paired successfully')

  // Get the host ID from the API
  const hostsRes = await fetch(`${server.url}/api/v1/hosts`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  const hosts = await hostsRes.json()
  const hostId = hosts[0].id
  console.log('[SSH CA] Host ID from pairing:', hostId)

  // Update the host with SSH container details and principal
  // CRITICAL: NO password - this forces certificate authentication [req.4whcli]
  const updateRes = await fetch(`${server.url}/api/v1/hosts/${hostId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      label: 'SSH CA Test Host',
      hostname: 'localhost',
      ssh_user: 'testuser',
      ssh_port: container.port,
      ssh_principal: 'testuser',
      // NO ssh_password - forces certificate authentication
    }),
  })
  if (!updateRes.ok) {
    const errorText = await updateRes.text()
    throw new Error(`Failed to update host: ${updateRes.status} - ${errorText}`)
  }
  console.log('[SSH CA] Host updated - NO password, certificate auth required')

  // Start devsesh session using standard helper
  // The session name should match the tmux session in the container
  const sessionName = 'testsession'
  console.log('[SSH CA] Starting devsesh session:', sessionName)
  const devseshProcess = spawnDevseshStart(sessionName, configPath, sessionDir, server.url)

  // Wait for session to appear in API
  const foundSession = await waitForSessionInApi(server.url, token, sessionName, 15000)
  const sessionId = foundSession.id
  console.log('[SSH CA] Session found with ID:', sessionId)

  // Keep session alive with pings
  const pingInterval = setInterval(async () => {
    try {
      await fetch(`${server.url}/api/v1/sessions/${sessionId}/ping`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })
    } catch {}
  }, 2000)

  return {
    server,
    container,
    token,
    email,
    hostId,
    sessionId,
    sessionName,
    tempDir,
    configPath,
    sessionDir,
    pingInterval,
    devseshProcess,
    caPublicKey,
  }
}

/**
 * Clean up test environment
 */
async function cleanupSSHCATestEnvironment(ctx: SSHCATestContext): Promise<void> {
  if (ctx.pingInterval) {
    clearInterval(ctx.pingInterval)
  }

  if (ctx.devseshProcess) {
    killTmuxSession(ctx.sessionName)
  }

  await stopSSHContainer(ctx.container)
  await stopServer(ctx.server)

  fs.rmSync(ctx.tempDir, { recursive: true, force: true })
}

/**
 * Navigate to session page and wait for it to load
 */
async function navigateToSession(page: Page, serverUrl: string, sessionId: string): Promise<void> {
  console.log('[SSH CA] Navigating to session:', sessionId)
  await page.goto(`${serverUrl}/sessions/${sessionId}`)
  await page.waitForLoadState('networkidle')

  // The terminal auto-connects on load; no manual Connect gate anymore. Wait for
  // the session top bar to render (keyboard/Quick Keys button is always present).
  await page.waitForSelector('button[title="Quick Keys"]', { timeout: 15000 })
  console.log('[SSH CA] Session page loaded')

  await page.waitForTimeout(1000)
}

/**
 * Connect using certificate authentication ONLY.
 *
 * This function:
 * 1. Clicks Connect
 * 2. Waits for WebAuthn dialog (FROST worker not active)
 * 3. Clicks Authenticate to trigger PRF + FROST signing
 * 4. Waits for SSH connection with certificate
 *
 * IMPORTANT: This function does NOT fall back to password authentication.
 * If certificate auth fails, the test fails.
 *
 * [req.4oofln] [req.twjlw7]
 */
async function connectWithCertificateOnly(page: Page): Promise<void> {
  console.log('[SSH CA] Connecting with certificate authentication...')

  // The terminal auto-connects on mount and, with SSH CA enabled, surfaces the
  // WebAuthn "Unlock SSH Certificate" dialog on its own — no Connect click.
  const webAuthnDialog = page.locator('[role="alertdialog"]:has-text("Unlock SSH Certificate")')
  await webAuthnDialog.waitFor({ state: 'visible', timeout: 30000 })
  console.log('[SSH CA] WebAuthn dialog appeared - FROST workflow triggered')

  // Click Authenticate button to trigger WebAuthn PRF
  const authButton = page.locator('button:has-text("Authenticate")')
  await expect(authButton).toBeVisible()
  await authButton.click()
  console.log('[SSH CA] Authenticate button clicked')

  // Wait for dialog to close (WebAuthn + FROST certificate signing)
  await page.waitForFunction(
    () => !document.querySelector('[role="alertdialog"]'),
    { timeout: 45000 }
  )
  console.log('[SSH CA] WebAuthn dialog closed - certificate flow completed')

  // Wait for SSH connection with certificate
  // If password dialog appears, the test should FAIL because we require certificate auth
  const passwordDialog = page.locator('input[type="password"]')
  const isPasswordVisible = await passwordDialog.isVisible().catch(() => false)
  if (isPasswordVisible) {
    throw new Error('Password dialog appeared - certificate authentication failed!')
  }

  // Wait for connected status (top-bar shows a colored dot + the text "Connected")
  await page.getByText('Connected', { exact: true }).waitFor({ state: 'visible', timeout: 60000 })
  console.log('[SSH CA] SSH connection established with certificate auth!')
}

/**
 * Execute cat command and verify flag file content in terminal.
 * [req.xbft6g]
 */
async function verifyFlagFileInTerminal(page: Page): Promise<void> {
  console.log('[SSH CA] Waiting for terminal to be ready...')
  await page.waitForSelector('.xterm-screen', { timeout: 10000 })
  await page.waitForTimeout(3000)

  // Focus terminal input
  const terminalInput = page.locator('.xterm-helper-textarea')
  await terminalInput.focus()
  await page.waitForTimeout(500)

  // Type the command to read the flag file
  console.log('[SSH CA] Executing: cat /home/testuser/FLAG_FILE')
  await page.keyboard.type('cat /home/testuser/FLAG_FILE', { delay: 50 })
  await page.keyboard.press('Enter')

  // Wait for output
  await page.waitForTimeout(3000)

  // Check terminal output for expected content
  const terminalScreen = page.locator('.xterm-screen')
  await expect(terminalScreen).toContainText(FLAG_CONTENT, { timeout: 10000 })
  console.log('[SSH CA] Flag file content verified in terminal!')
}

// Test suite
test.describe('SSH CA Certificate Authentication E2E', () => {

  // Main E2E test: Full certificate authentication workflow [req.jc1drs]
  test('complete certificate-based SSH connection workflow', async ({ page, context }) => {
    let ctx: SSHCATestContext | null = null
    const consoleLogs: string[] = []

    // Capture all browser console logs for debugging
    page.on('console', msg => {
      const text = `[BROWSER ${msg.type()}] ${msg.text()}`
      consoleLogs.push(text)
    })

    try {
      // Step 1: Set up complete test environment
      // This registers user with PRF, creates FROST keys, starts container with CA
      ctx = await setupSSHCATestEnvironment(page, context)
      console.log('[SSH CA] Test environment set up')

      // Step 2: Verify prerequisites
      expect(ctx.caPublicKey).toMatch(/^ssh-ed25519/)
      console.log('[SSH CA] ✓ CA public key in OpenSSH format')

      // Step 3: Navigate to session page
      await navigateToSession(page, ctx.server.url, ctx.sessionId)
      console.log('[SSH CA] ✓ Session page loaded')

      // Step 4: Connect using certificate authentication ONLY
      // This MUST NOT fall back to password auth
      await connectWithCertificateOnly(page)
      console.log('[SSH CA] ✓ Connected with certificate authentication')

      // Step 5: Verify flag file content via terminal [req.xbft6g]
      await verifyFlagFileInTerminal(page)
      console.log('[SSH CA] ✓ Flag file content verified')

      console.log('[SSH CA] ✅ Full E2E certificate authentication test passed!')

    } catch (error) {
      // Print browser console logs on failure
      console.log('\n=== BROWSER CONSOLE LOGS ===')
      consoleLogs.forEach(log => console.log(log))
      console.log('=== END BROWSER LOGS ===\n')

      // Print SSH server logs from container
      if (ctx?.container) {
        try {
          console.log('\n=== SSH SERVER LOGS ===')
          console.log(getSSHServerLogs(ctx.container.name))
          console.log('=== END SSH SERVER LOGS ===\n')
        } catch (e) {
          console.log('Could not get SSH server logs:', e)
        }

        try {
          console.log('\n=== CONTAINER LOGS ===')
          console.log(getContainerLogs(ctx.container.name))
          console.log('=== END CONTAINER LOGS ===\n')
        } catch (e) {
          console.log('Could not get container logs:', e)
        }
      }

      // Take screenshot
      await page.screenshot({ path: '/tmp/ssh-ca-e2e-failure.png' })
      console.log('Screenshot saved to /tmp/ssh-ca-e2e-failure.png')

      throw error
    } finally {
      if (ctx) await cleanupSSHCATestEnvironment(ctx)
    }
  })

  // After a network drop (wifi goes away and comes back), the terminal must
  // reconnect and become usable again on its OWN — no manual disconnect/connect,
  // and no re-auth prompt (the FROST cert is already unlocked). Reproduces the
  // production bug where a reconnect got stuck permanently at "connecting…".
  test('recovers automatically after a network drop without a manual reconnect', async ({ page, context }) => {
    test.setTimeout(180000)
    let ctx: SSHCATestContext | null = null

    const clientCount = (): number => {
      try {
        const out = execInContainer(CONTAINER_NAME, `tmux list-clients -t testsession 2>/dev/null | wc -l`)
        return Number(out.trim()) || 0
      } catch {
        return 0
      }
    }
    const waitForClient = async (): Promise<boolean> => {
      for (let i = 0; i < 45; i++) {
        if (clientCount() > 0) return true
        await page.waitForTimeout(1000)
      }
      return false
    }

    try {
      ctx = await setupSSHCATestEnvironment(page, context)
      await navigateToSession(page, ctx.server.url, ctx.sessionId)
      await connectWithCertificateOnly(page)

      // Terminal is a live shell before the drop.
      await page.waitForSelector('.xterm-screen', { timeout: 10000 })
      await page.locator('.xterm-helper-textarea').focus()
      await page.keyboard.type('echo BEFORE_$(whoami)', { delay: 15 })
      await page.keyboard.press('Enter')
      await expect(page.locator('.xterm-screen')).toContainText('BEFORE_testuser', { timeout: 10000 })
      expect(await waitForClient(), 'attached before drop').toBe(true)

      // Reproduce the wifi-flap: a (re)connect attempt happens while the network
      // is down. Drop the live connection, go offline, then reconnect — the WS
      // can't open, and the buggy transport blocks forever at "connecting…".
      await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible({ timeout: 10000 })

      await context.setOffline(true)
      await page.getByRole('button', { name: 'Connect', exact: true }).click()
      // Let the offline reconnect attempt happen (and, in the buggy build, wedge).
      await page.waitForTimeout(5000)

      // Wifi comes back. From here on the app must recover on its OWN — no more
      // manual disconnect/connect — and with no re-auth prompt (FROST unlocked).
      await context.setOffline(false)

      const unlockDialog = page.locator('[role="alertdialog"]:has-text("Unlock SSH Certificate")')
      expect(await waitForClient(), 'terminal re-attaches automatically after the network returns').toBe(true)
      await expect(unlockDialog).toBeHidden()

      await page.locator('.xterm-helper-textarea').focus()
      await page.keyboard.type('echo AFTER_$(whoami)', { delay: 15 })
      await page.keyboard.press('Enter')
      await expect(page.locator('.xterm-screen')).toContainText('AFTER_testuser', { timeout: 30000 })
    } finally {
      if (ctx) await cleanupSSHCATestEnvironment(ctx)
    }
  })

  // A silently half-open connection — the WebSocket stays "open" but no data
  // flows and the browser never fires onclose/offline — must still be detected
  // (by the SSH keepalive) and recovered from, without a manual reconnect. We
  // simulate it by freezing the first SSH WebSocket (dropping all frames both
  // ways) while leaving it open; the reconnect's fresh socket is let through.
  test('recovers from a silently half-open connection via SSH keepalive', async ({ page, context }) => {
    test.setTimeout(180000)
    let ctx: SSHCATestContext | null = null

    let frozen = false
    let firstWs: unknown = null
    await context.routeWebSocket(/\/hosts\/\d+\/ssh/, (ws) => {
      const server = ws.connectToServer()
      if (!firstWs) firstWs = ws
      const blocked = () => frozen && ws === firstWs
      ws.onMessage((m) => { if (!blocked()) server.send(m) })
      server.onMessage((m) => { if (!blocked()) ws.send(m) })
    })

    const clientCount = (): number => {
      try {
        const out = execInContainer(CONTAINER_NAME, `tmux list-clients -t testsession 2>/dev/null | wc -l`)
        return Number(out.trim()) || 0
      } catch {
        return 0
      }
    }
    const waitForClients = async (want: 'some' | 'none'): Promise<boolean> => {
      for (let i = 0; i < 60; i++) {
        const n = clientCount()
        if (want === 'some' && n > 0) return true
        if (want === 'none' && n === 0) return true
        await page.waitForTimeout(1000)
      }
      return false
    }

    try {
      ctx = await setupSSHCATestEnvironment(page, context)
      await navigateToSession(page, ctx.server.url, ctx.sessionId)
      await connectWithCertificateOnly(page)

      await page.waitForSelector('.xterm-screen', { timeout: 10000 })
      expect(await waitForClients('some'), 'attached before freeze').toBe(true)

      // Freeze the live socket: it stays open, but nothing flows in either
      // direction — a true half-open link. Only the keepalive can notice.
      frozen = true

      // The keepalive (15s tick + 10s reply timeout) tears the dead connection
      // down — so the old tmux client detaches — and the reconnect's fresh
      // socket (forwarded) re-attaches, with no manual action and no re-auth.
      const unlockDialog = page.locator('[role="alertdialog"]:has-text("Unlock SSH Certificate")')
      expect(await waitForClients('none'), 'keepalive tears the dead link down (old client detaches)').toBe(true)
      expect(await waitForClients('some'), 'terminal re-attaches after the keepalive-driven reconnect').toBe(true)
      await expect(unlockDialog).toBeHidden()

      await page.locator('.xterm-helper-textarea').focus()
      await page.keyboard.type('echo KEEPALIVE_$(whoami)', { delay: 15 })
      await page.keyboard.press('Enter')
      await expect(page.locator('.xterm-screen')).toContainText('KEEPALIVE_testuser', { timeout: 30000 })
    } finally {
      if (ctx) await cleanupSSHCATestEnvironment(ctx)
    }
  })

  // A full server reboot (apps1 restarting) drops EVERY WebSocket at once and
  // wipes the server's in-memory proxy state, while the browser keeps its wasm
  // SSH connection state. The client must auto-reconnect AND restart the SSH
  // handshake on the fresh transport. Reproduces the production bug where, after
  // an apps1 reboot, every reconnect stalled forever: the proxy reached the
  // target (which sent its 22-byte banner) but the client sent ZERO handshake
  // bytes back, so no session ever re-attached.
  test('recovers automatically after a full server restart (apps1 reboot)', async ({ page, context }) => {
    test.setTimeout(180000)
    let ctx: SSHCATestContext | null = null

    const clientCount = (): number => {
      try {
        const out = execInContainer(CONTAINER_NAME, `tmux list-clients -t testsession 2>/dev/null | wc -l`)
        return Number(out.trim()) || 0
      } catch {
        return 0
      }
    }
    const waitForClient = async (): Promise<boolean> => {
      for (let i = 0; i < 60; i++) {
        if (clientCount() > 0) return true
        await page.waitForTimeout(1000)
      }
      return false
    }

    try {
      ctx = await setupSSHCATestEnvironment(page, context)
      await navigateToSession(page, ctx.server.url, ctx.sessionId)
      await connectWithCertificateOnly(page)

      // Live shell before the reboot.
      await page.waitForSelector('.xterm-screen', { timeout: 10000 })
      await page.locator('.xterm-helper-textarea').focus()
      await page.keyboard.type('echo BEFORE_$(whoami)', { delay: 15 })
      await page.keyboard.press('Enter')
      await expect(page.locator('.xterm-screen')).toContainText('BEFORE_testuser', { timeout: 10000 })
      expect(await waitForClient(), 'attached before restart').toBe(true)

      // Reboot the server in place (same port + DB → token/session/host survive).
      // Every WebSocket drops; the page must recover on its OWN, with no re-auth.
      ctx.server = await restartServer(ctx.server)

      const unlockDialog = page.locator('[role="alertdialog"]:has-text("Unlock SSH Certificate")')
      expect(await waitForClient(), 'terminal re-attaches automatically after the server reboot').toBe(true)
      await expect(unlockDialog).toBeHidden()

      await page.locator('.xterm-helper-textarea').focus()
      await page.keyboard.type('echo AFTER_$(whoami)', { delay: 15 })
      await page.keyboard.press('Enter')
      await expect(page.locator('.xterm-screen')).toContainText('AFTER_testuser', { timeout: 30000 })
    } finally {
      if (ctx) await cleanupSSHCATestEnvironment(ctx)
    }
  })

  // Production report (iPhone passkey): the passkey still LOGS IN but no longer
  // works for SSH certificate auth. Login only needs a WebAuthn assertion, but
  // SSH cert auth needs THAT passkey's PRF to unlock the master key that decrypts
  // the FROST client share. When the passkey's stored master-key blob can't be
  // unlocked into the correct master key, SSH cert auth fails while login is
  // unaffected. We reproduce that state by corrupting the credential's master-key
  // blob (leaving the credential itself valid for WebAuthn login/assertion).
  //
  // Expected once fixed: the terminal must surface a clear, actionable "this
  // passkey can't unlock SSH" error instead of silently failing / looping.
  test('a passkey that still logs in fails SSH cert auth when its master-key blob is unusable (iPhone repro)', async ({ page, context }) => {
    test.setTimeout(180000)
    let ctx: SSHCATestContext | null = null

    const clientCount = (): number => {
      try {
        const out = execInContainer(CONTAINER_NAME, `tmux list-clients -t testsession 2>/dev/null | wc -l`)
        return Number(out.trim()) || 0
      } catch {
        return 0
      }
    }

    try {
      ctx = await setupSSHCATestEnvironment(page, context)

      // Put the passkey into the broken state: corrupt its encrypted master-key
      // blob so the PRF can no longer unlock the master key (AES-GCM auth fails).
      // The credential stays valid for login; only the SSH/FROST path breaks.
      const userId = await getUserIdByEmail(ctx.server.dbPath, ctx.email)
      expect(userId, 'user should exist').not.toBeNull()
      {
        const Database = require('better-sqlite3')
        const db = new Database(ctx.server.dbPath)
        try {
          const row = db
            .prepare(
              'SELECT rowid AS rid, encrypted_master_key AS mk FROM webauthn_credentials ' +
                'WHERE user_id = ? ORDER BY rowid LIMIT 1'
            )
            .get(userId)
          expect(row?.mk, 'passkey should have a master-key blob').toBeTruthy()
          // Blob layout: 1 version + 12 nonce + ciphertext + 16 tag. Flip the
          // ciphertext/tag (leave version+nonce) so decrypt fails cleanly.
          const bad = Buffer.from(row.mk)
          for (let i = 13; i < bad.length; i++) bad[i] ^= 0xff
          db.prepare('UPDATE webauthn_credentials SET encrypted_master_key = ? WHERE rowid = ?').run(
            bad,
            row.rid
          )
        } finally {
          db.close()
        }
      }

      await navigateToSession(page, ctx.server.url, ctx.sessionId)

      // Drive SSH certificate auth: the unlock dialog appears (login-style
      // assertion still works), but unlocking the master key now fails.
      const dialog = page.locator('[role="alertdialog"]:has-text("Unlock SSH Certificate")')
      await dialog.waitFor({ state: 'visible', timeout: 30000 })
      await page.locator('button:has-text("Authenticate")').click()

      // Reproduction: SSH cert auth fails -> the terminal never reaches
      // "Connected" and no shell attaches in the container. (In production the
      // user sees this as SSH "not working" for that passkey.)
      const connected = await page
        .getByText('Connected', { exact: true })
        .waitFor({ state: 'visible', timeout: 25000 })
        .then(() => true)
        .catch(() => false)
      expect(connected, 'SSH cert auth must fail when the master-key blob is unusable').toBe(false)

      let attached = false
      for (let i = 0; i < 6; i++) {
        if (clientCount() > 0) {
          attached = true
          break
        }
        await page.waitForTimeout(1000)
      }
      expect(attached, 'no shell should attach when SSH cert auth fails').toBe(false)
    } finally {
      if (ctx) await cleanupSSHCATestEnvironment(ctx)
    }
  })

  // Regression test for the iPhone bug: SSH cert auth must work for a passkey
  // even when the account has MULTIPLE passkeys and the platform (Safari/iOS)
  // diverges the PRF for a bare `eval` with >1 allowCredentials. We simulate that
  // platform quirk (helpers/prf-auth.ts, gated by localStorage) and make the
  // assertion offer 2 credentials. With a bare `eval` the simulated PRF is
  // mismatched -> master-key unlock throws OperationError -> never connects
  // (fails). With `evalByCredential` the per-credential PRF is correct -> the
  // terminal connects. This locks in the evalByCredential fix.
  test('SSH cert auth survives Safari/iOS multi-credential PRF (evalByCredential regression)', async ({ page, context }) => {
    test.setTimeout(180000)
    let ctx: SSHCATestContext | null = null

    const clientCount = (): number => {
      try {
        const out = execInContainer(CONTAINER_NAME, `tmux list-clients -t testsession 2>/dev/null | wc -l`)
        return Number(out.trim()) || 0
      } catch {
        return 0
      }
    }
    const waitForClient = async (): Promise<boolean> => {
      for (let i = 0; i < 45; i++) {
        if (clientCount() > 0) return true
        await page.waitForTimeout(1000)
      }
      return false
    }

    try {
      ctx = await setupSSHCATestEnvironment(page, context)

      // Make the assertion offer more than one credential (a realistic account
      // with several passkeys): inject a second credential row so the SSH-unlock
      // get() has allowCredentials.length > 1 and trips the simulated quirk.
      const userId = await getUserIdByEmail(ctx.server.dbPath, ctx.email)
      expect(userId, 'user should exist').not.toBeNull()
      {
        const Database = require('better-sqlite3')
        const crypto = require('crypto')
        const db = new Database(ctx.server.dbPath)
        try {
          const id2 = `second-passkey-${crypto.randomBytes(6).toString('hex')}`
          db.prepare(
            'INSERT INTO webauthn_credentials ' +
              '(id, user_id, public_key, sign_count, encrypted_master_key, backup_eligible, backup_state) ' +
              'VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(id2, userId, Buffer.from([0x01, 0x02, 0x03]), 0, crypto.randomBytes(61), 1, 1)
        } finally {
          db.close()
        }
      }

      // Enable the Safari/iOS multi-credential PRF divergence simulation.
      await page.evaluate(() => localStorage.setItem('__ios_prf_multicred_sim__', '1'))

      await navigateToSession(page, ctx.server.url, ctx.sessionId)

      // Must connect: with evalByCredential the per-credential PRF is correct.
      // (With a bare eval the simulated PRF is mismatched and this fails.)
      await connectWithCertificateOnly(page)
      expect(await waitForClient(), 'terminal must attach after multi-credential cert auth').toBe(true)
    } finally {
      if (ctx) await cleanupSSHCATestEnvironment(ctx)
    }
  })

  // Reproduces "fails to reconnect when I come back to the app": iOS silently
  // kills Web Workers when the PWA is backgrounded, so the FROST worker dies
  // while the polled isActive flag stays stale-true. On return, the reconnect's
  // certificate request must NOT hang on the dead worker and fail with a generic
  // error -- ensureAlive() must detect the dead worker and surface the re-unlock
  // dialog, and a single re-auth must restore the session.
  test('recovers with a re-unlock prompt when the FROST worker dies while backgrounded', async ({ page, context }) => {
    test.setTimeout(180000)
    let ctx: SSHCATestContext | null = null

    // Track every spawned Web Worker so we can kill the FROST worker mid-session,
    // exactly as iOS does on background (terminate() fires no onerror).
    await context.addInitScript(() => {
      const RealWorker = window.Worker
      ;(window as unknown as { __workers: Worker[] }).__workers = []
      ;(window as unknown as { __killWorkers: () => void }).__killWorkers = () => {
        for (const w of (window as unknown as { __workers: Worker[] }).__workers) {
          try { w.terminate() } catch { /* ignore */ }
        }
      }
      ;(window as unknown as { Worker: unknown }).Worker = class extends RealWorker {
        constructor(url: string | URL, opts?: WorkerOptions) {
          super(url, opts)
          ;(window as unknown as { __workers: Worker[] }).__workers.push(this as unknown as Worker)
        }
      }
    })

    const clientCount = (): number => {
      try {
        const out = execInContainer(CONTAINER_NAME, `tmux list-clients -t testsession 2>/dev/null | wc -l`)
        return Number(out.trim()) || 0
      } catch {
        return 0
      }
    }
    const waitForClient = async (): Promise<boolean> => {
      for (let i = 0; i < 45; i++) {
        if (clientCount() > 0) return true
        await page.waitForTimeout(1000)
      }
      return false
    }

    try {
      ctx = await setupSSHCATestEnvironment(page, context)
      await navigateToSession(page, ctx.server.url, ctx.sessionId)
      await connectWithCertificateOnly(page)
      expect(await waitForClient(), 'attached before backgrounding').toBe(true)

      // Simulate iOS killing the FROST worker while the PWA was backgrounded,
      // then a reconnect on return. The reconnect's certificate request is the
      // path that must cope with the now-dead worker.
      await page.evaluate(() => (window as unknown as { __killWorkers: () => void }).__killWorkers())
      await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible({ timeout: 10000 })
      await page.getByRole('button', { name: 'Connect', exact: true }).click()

      // The reconnect must detect the dead worker (ensureAlive) and prompt a
      // re-unlock rather than hanging on it. Before the fix this stayed stuck
      // ("connecting") for 30s and then failed with a generic error.
      const dialog = page.locator('[role="alertdialog"]:has-text("Unlock SSH Certificate")')
      await expect(dialog).toBeVisible({ timeout: 20000 })

      // One re-auth restores the session.
      await page.locator('button:has-text("Authenticate")').click()
      await page.getByText('Connected', { exact: true }).waitFor({ state: 'visible', timeout: 60000 })
      expect(await waitForClient(), 'terminal re-attaches after re-unlock').toBe(true)
    } finally {
      if (ctx) await cleanupSSHCATestEnvironment(ctx)
    }
  })

  // A credential can hold multiple wrapped master keys (one per device, since a
  // synced passkey's PRF is device-specific). Unlock must TRY EACH blob and use
  // the one this device's PRF opens, skipping others. We inject a bogus "other
  // device" blob (ordered newest, so tried first) and confirm unlock still lands
  // on the real one and connects.
  test('unlock tries all master-key blobs and skips ones from other devices', async ({ page, context }) => {
    test.setTimeout(180000)
    let ctx: SSHCATestContext | null = null
    try {
      ctx = await setupSSHCATestEnvironment(page, context)
      await navigateToSession(page, ctx.server.url, ctx.sessionId)
      await connectWithCertificateOnly(page)

      // Inject a bogus additional blob for this user's credential (simulates a
      // different device's blob that can't decrypt here). Ordered newest, so
      // try-all hits it first and must fall through to the real one.
      const Database = require('better-sqlite3')
      const crypto = require('crypto')
      const db = new Database(ctx.server.dbPath, { readonly: true })
      let credB64: string
      try {
        const row = db.prepare('SELECT hex(id) AS h FROM webauthn_credentials WHERE user_id = 1 LIMIT 1').get()
        credB64 = Buffer.from(row.h, 'hex').toString('base64')
      } finally {
        db.close()
      }
      const bogus = crypto.randomBytes(61)
      bogus[0] = 0x01 // valid version byte so it parses, but decrypt fails
      const postRes = await fetch(`${ctx.server.url}/api/v1/auth/master-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}` },
        body: JSON.stringify({ credential_id: credB64, wrapped_master_key: bogus.toString('base64') }),
      })
      expect(postRes.status, 'add bogus blob').toBe(204)

      // Fresh page (drops the cached FROST worker) → a real unlock that must
      // try-all across [bogus, real] and still connect.
      await page.reload()
      await navigateToSession(page, ctx.server.url, ctx.sessionId)
      await connectWithCertificateOnly(page)
      await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30000 })
    } finally {
      if (ctx) await cleanupSSHCATestEnvironment(ctx)
    }
  })

  // When this device's PRF opens none of the stored blobs (a device that shares
  // the synced passkey but has never wrapped the master key here), unlock must
  // route to provisioning instead of erroring. We simulate a different device's
  // PRF for the same credential and assert it navigates to the provision flow.
  test('unlock with no matching blob routes to device provisioning', async ({ page, context }) => {
    test.setTimeout(180000)
    let ctx: SSHCATestContext | null = null
    try {
      ctx = await setupSSHCATestEnvironment(page, context)
      // From now on this credential yields a different PRF (simulated "device B"),
      // so the blob wrapped at registration won't decrypt here.
      await page.evaluate(() => localStorage.setItem('__prf_device_id__', 'device-B'))

      await navigateToSession(page, ctx.server.url, ctx.sessionId)
      // Drive the unlock: dialog appears, click Authenticate.
      const dialog = page.locator('[role="alertdialog"]:has-text("Unlock SSH Certificate")')
      await dialog.waitFor({ state: 'visible', timeout: 30000 })
      await page.locator('button:has-text("Authenticate")').click()

      // No blob decrypts with device-B's PRF → auto-launch provisioning.
      await page.waitForURL(/\/passkeys\/enroll/, { timeout: 30000 })
      expect(page.url()).toContain('reason=ssh-provision')
    } finally {
      if (ctx) await cleanupSSHCATestEnvironment(ctx)
    }
  })

  // Switching devsesh sessions via the sidebar must re-attach the terminal to
  // the newly-selected session AUTOMATICALLY — reusing the already-established
  // (certificate-authenticated) SSH connection, WITHOUT re-authenticating — and
  // it must keep working across many back-and-forth switches. This reproduces
  // the production bug where switching re-authenticated every time and then
  // failed after a few switches.
  test('switching sessions via sidebar re-attaches automatically without re-auth (many times)', async ({ page, context }) => {
    test.setTimeout(240000)
    let ctx: SSHCATestContext | null = null
    let bPingInterval: NodeJS.Timeout | null = null
    const nameB = 'ca-switch-b'

    // Count tmux clients attached to a session inside the container.
    const clientCount = (tmuxName: string): number => {
      try {
        const out = execInContainer(CONTAINER_NAME, `tmux list-clients -t ${tmuxName} 2>/dev/null | wc -l`)
        return Number(out.trim()) || 0
      } catch {
        return 0
      }
    }
    const waitForClients = async (tmuxName: string, want: 'some' | 'none'): Promise<number> => {
      for (let i = 0; i < 30; i++) {
        const n = clientCount(tmuxName)
        if (want === 'some' && n > 0) return n
        if (want === 'none' && n === 0) return n
        await page.waitForTimeout(1000)
      }
      return clientCount(tmuxName)
    }

    try {
      // Session A reuses the container's pre-created 'testsession'.
      ctx = await setupSSHCATestEnvironment(page, context)
      const idA = ctx.sessionId // named 'testsession'
      const tmuxA = 'testsession'

      // Session B: a second tmux session in the container + a devsesh session on
      // the SAME (certificate-only) host.
      createTmuxSession(ctx.container.name, nameB)
      spawnDevseshStart(nameB, ctx.configPath, ctx.sessionDir, ctx.server.url)
      const sessionB = await waitForSessionInApi(ctx.server.url, ctx.token, nameB, 15000)
      const idB = sessionB.id
      bPingInterval = setInterval(async () => {
        try {
          await fetch(`${ctx!.server.url}/api/v1/sessions/${idB}/ping`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${ctx!.token}` },
          })
        } catch {}
      }, 2000)

      // Connect session A with certificate auth — this is the ONE and only time
      // the "Unlock SSH Certificate" dialog should ever appear.
      await navigateToSession(page, ctx.server.url, idA)
      await connectWithCertificateOnly(page)
      expect(await waitForClients(tmuxA, 'some'), 'terminal attaches to A on first connect').toBeGreaterThan(0)

      // Confirm the terminal is a real, working shell for A.
      await page.waitForSelector('.xterm-screen', { timeout: 10000 })
      await page.locator('.xterm-helper-textarea').focus()
      await page.keyboard.type('echo SHELL_OK_A', { delay: 30 })
      await page.keyboard.press('Enter')
      await expect(page.locator('.xterm-screen')).toContainText('SHELL_OK_A', { timeout: 10000 })

      const unlockDialog = page.locator('[role="alertdialog"]:has-text("Unlock SSH Certificate")')

      // Switch back and forth several times via the Sessions tab. Each switch
      // must: follow the URL/header, NOT show the unlock dialog (no re-auth),
      // and auto-attach the terminal to the target session's tmux.
      const targets = [
        { id: idB, name: nameB, tmux: nameB, other: tmuxA },
        { id: idA, name: 'testsession', tmux: tmuxA, other: nameB },
        { id: idB, name: nameB, tmux: nameB, other: tmuxA },
        { id: idA, name: 'testsession', tmux: tmuxA, other: nameB },
        { id: idB, name: nameB, tmux: nameB, other: tmuxA },
      ]

      for (let i = 0; i < targets.length; i++) {
        const t = targets[i]
        console.log(`[switch ${i + 1}] -> ${t.name}`)

        await page.getByRole('tab', { name: 'Sessions' }).click()
        const item = page.getByTestId(`session-item-${t.id}`)
        await expect(item).toBeVisible({ timeout: 10000 })
        await item.click()

        await expect(page).toHaveURL(new RegExp(`/sessions/${t.id}`), { timeout: 10000 })
        await expect(page.getByTestId(`session-item-${t.id}`)).toHaveAttribute('aria-current', 'true', { timeout: 10000 })

        // No re-authentication: the unlock dialog must NOT reappear.
        await expect(unlockDialog).toBeHidden()

        // The terminal auto-attaches to the target and leaves the other — with
        // NO dialog interaction. If a re-auth were required, the attach would
        // never happen and this would fail.
        expect(await waitForClients(t.tmux, 'some'), `terminal auto-attaches to ${t.name}`).toBeGreaterThan(0)
        expect(await waitForClients(t.other, 'none'), `terminal leaves ${t.other}`).toBe(0)

        // The connection is never re-authenticated mid-run.
        await expect(unlockDialog).toBeHidden()
      }

      // Final sanity: the terminal still works as a live shell after all the
      // switching (currently on session B).
      await page.locator('.xterm-helper-textarea').focus()
      await page.keyboard.type('echo SHELL_OK_B_FINAL', { delay: 30 })
      await page.keyboard.press('Enter')
      await expect(page.locator('.xterm-screen')).toContainText('SHELL_OK_B_FINAL', { timeout: 10000 })
    } finally {
      if (bPingInterval) clearInterval(bPingInterval)
      try { killTmuxSession(nameB) } catch { /* ignore */ }
      if (ctx) await cleanupSSHCATestEnvironment(ctx)
    }
  })

  // Switching between sessions on DIFFERENT hosts must connect to the correct
  // host (not reattach tmux on the wrong connection), do so automatically
  // (certificate issued silently once per host — no unlock dialog after the
  // first), and REUSE the pooled connections on repeat visits (each host is
  // authenticated exactly once no matter how often you switch). Verified with
  // real terminal output: a host-specific flag file + a live-shell echo.
  test('switching sessions across different hosts connects to the right host and reuses pooled connections', async ({ page, context }) => {
    test.setTimeout(300000)
    let ctx: SSHCATestContext | null = null
    let container2: SSHContainer | null = null
    let bPingInterval: NodeJS.Timeout | null = null
    const HOST2_FLAG = 'HOST2_FLAG_67890'
    const nameB = 'host2-sess'
    const CONTAINER2 = 'devsesh-ssh-ca-test-2'

    const clientCount = (containerName: string, tmuxName: string): number => {
      try {
        const out = execInContainer(containerName, `tmux list-clients -t ${tmuxName} 2>/dev/null | wc -l`)
        return Number(out.trim()) || 0
      } catch {
        return 0
      }
    }
    const waitForClient = async (containerName: string, tmuxName: string): Promise<void> => {
      for (let i = 0; i < 30; i++) {
        if (clientCount(containerName, tmuxName) > 0) return
        await page.waitForTimeout(1000)
      }
    }
    // Count SSH authentications on a host — proves connection reuse (pooling):
    // a reconnect would add another "Accepted publickey".
    const acceptedCount = (containerName: string): number => {
      const logs = getSSHServerLogs(containerName)
      return (logs.match(/Accepted publickey for testuser/g) || []).length
    }
    // Drive a command in the terminal and assert its output — proves a live
    // shell on the RIGHT host (host-specific flag) with real terminal output.
    const verifyLiveShell = async (containerName: string, tmuxName: string, flag: string): Promise<void> => {
      await waitForClient(containerName, tmuxName)
      await page.waitForSelector('.xterm-screen', { timeout: 15000 })
      const term = page.locator('.xterm-screen')
      // A real shell prompt is on screen (bash's default prompt ends in '$').
      await expect(term).toContainText('$', { timeout: 15000 })
      await page.locator('.xterm-helper-textarea').focus()
      // Single space-free token so terminal line-wrapping can't split it.
      await page.keyboard.type('echo READY_$(whoami)_$(cat /home/testuser/FLAG_FILE)', { delay: 15 })
      await page.keyboard.press('Enter')
      await expect(term).toContainText(`READY_testuser_${flag}`, { timeout: 10000 })
    }

    try {
      // --- Host 1: session A = 'testsession', flag = FLAG_CONTENT ---
      ctx = await setupSSHCATestEnvironment(page, context)
      const idA = ctx.sessionId
      const flagA = FLAG_CONTENT

      // --- Host 2: a second container sharing the same CA, distinct flag ---
      container2 = await startSSHContainer({
        name: CONTAINER2,
        port: 2233,
        caPublicKey: ctx.caPublicKey,
        flagContent: HOST2_FLAG,
      })
      createTmuxSession(CONTAINER2, nameB)

      // Pair a second CLI -> creates host 2 for the same (logged-in) user.
      const config2 = path.join(ctx.tempDir, 'config2.yml')
      const sessionDir2 = path.join(ctx.tempDir, 'sessions2')
      fs.mkdirSync(sessionDir2, { recursive: true })
      const cli2 = spawnDevseshLogin(ctx.server.url, config2, sessionDir2)
      let code2: string | null = null
      const t0 = Date.now()
      while (Date.now() - t0 < 15000) {
        code2 = extractPairingCode(cli2.stdout)
        if (code2) break
        await new Promise((r) => setTimeout(r, 200))
      }
      if (!code2) throw new Error('host2 pairing code not found')
      await enterPairingCode(page, ctx.server.url, code2, true)
      await waitForCliSuccess(cli2)

      // Point host 2 at container2 (certificate-only, no password).
      const hosts = await (await fetch(`${ctx.server.url}/api/v1/hosts`, {
        headers: { Authorization: `Bearer ${ctx.token}` },
      })).json()
      const host2 = hosts.find((h: any) => h.id !== ctx!.hostId)
      if (!host2) throw new Error('host2 not created by pairing')
      const upd = await fetch(`${ctx.server.url}/api/v1/hosts/${host2.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}` },
        body: JSON.stringify({
          label: 'Host 2', hostname: 'localhost', ssh_user: 'testuser',
          ssh_port: container2.port, ssh_principal: 'testuser',
        }),
      })
      expect(upd.ok).toBe(true)

      // Start session B on host 2.
      spawnDevseshStart(nameB, config2, sessionDir2, ctx.server.url)
      const sessionB = await waitForSessionInApi(ctx.server.url, ctx.token, nameB, 15000)
      const idB = sessionB.id
      bPingInterval = setInterval(async () => {
        try {
          await fetch(`${ctx!.server.url}/api/v1/sessions/${idB}/ping`, {
            method: 'POST', headers: { Authorization: `Bearer ${ctx!.token}` },
          })
        } catch {}
      }, 2000)

      // Connect session A (host1) with certificate — the ONLY unlock dialog.
      await navigateToSession(page, ctx.server.url, idA)
      await connectWithCertificateOnly(page)
      await verifyLiveShell(ctx.container.name, 'testsession', flagA)

      const unlockDialog = page.locator('[role="alertdialog"]:has-text("Unlock SSH Certificate")')

      // Switch across hosts, back and forth. First host2 visit issues a cert
      // silently (FROST already unlocked). Later visits reuse pooled connections.
      const visits = [
        { id: idB, name: nameB, flag: HOST2_FLAG, container: CONTAINER2, tmux: nameB },
        { id: idA, name: 'testsession', flag: flagA, container: ctx.container.name, tmux: 'testsession' },
        { id: idB, name: nameB, flag: HOST2_FLAG, container: CONTAINER2, tmux: nameB },
        { id: idA, name: 'testsession', flag: flagA, container: ctx.container.name, tmux: 'testsession' },
      ]
      for (let i = 0; i < visits.length; i++) {
        const v = visits[i]
        console.log(`[cross-host switch ${i + 1}] -> ${v.name}`)
        await page.getByRole('tab', { name: 'Sessions' }).click()
        const item = page.getByTestId(`session-item-${v.id}`)
        await expect(item).toBeVisible({ timeout: 10000 })
        await item.click()
        await expect(page).toHaveURL(new RegExp(`/sessions/${v.id}`), { timeout: 10000 })
        await expect(page.getByTestId(`session-item-${v.id}`)).toHaveAttribute('aria-current', 'true', { timeout: 10000 })
        // No re-auth on any switch.
        await expect(unlockDialog).toBeHidden()
        // Real output proving we're truly on the right host.
        await verifyLiveShell(v.container, v.tmux, v.flag)
        await expect(unlockDialog).toBeHidden()
      }

      // Pool reuse: each host authenticated exactly once across all the visits.
      expect(acceptedCount(ctx.container.name), 'host1 authenticated exactly once (pooled)').toBe(1)
      expect(acceptedCount(CONTAINER2), 'host2 authenticated exactly once (pooled)').toBe(1)
    } finally {
      if (bPingInterval) clearInterval(bPingInterval)
      try { killTmuxSession(nameB) } catch { /* ignore */ }
      if (container2) await stopSSHContainer(container2)
      if (ctx) await cleanupSSHCATestEnvironment(ctx)
    }
  })

  // Test: User registration creates SSH CA key shares [req.ancud7]
  test('user registration creates SSH CA key shares', async ({ page, context }) => {
    const server = await startServer()

    try {
      // Set up PRF authenticator
      await setupPRFAuthenticator(context, page)

      // Register user
      const email = `sshca-keygen-${Date.now()}@example.com`
      await registerUserWithPRF(page, server.url, email)

      // Verify SSH CA record exists with all required fields
      const sshcaExists = await verifySSHCACreated(server.dbPath, email)
      expect(sshcaExists).toBe(true)
      console.log('[SSH CA] ✓ SSH CA key shares created during registration')

      // Verify client share exists
      const clientShareExists = await verifyClientShareExists(server.dbPath, email)
      expect(clientShareExists).toBe(true)
      console.log('[SSH CA] ✓ Encrypted client share stored')

    } finally {
      await stopServer(server)
    }
  })

  // Test: CA public key endpoint returns valid key [req.23hk63]
  test('CA public key endpoint returns valid OpenSSH key', async ({ page, context }) => {
    const server = await startServer()

    try {
      // Set up and register
      await setupPRFAuthenticator(context, page)
      const email = `sshca-pubkey-${Date.now()}@example.com`
      const { token } = await registerUserWithPRF(page, server.url, email)

      // Fetch CA public key
      const caPublicKey = await fetchCAPublicKey(server.url, token)

      // Verify format
      expect(caPublicKey).toMatch(/^ssh-ed25519\s+[A-Za-z0-9+/=]+/)
      console.log('[SSH CA] ✓ CA public key format valid')

    } finally {
      await stopServer(server)
    }
  })

  // Test: Container accepts certificate authentication [req.vz2fg3] [req.17dfwk]
  test('SSH container configured with CA trust accepts certificate auth', async ({ page, context }) => {
    const server = await startServer()
    let container: SSHContainer | null = null

    try {
      // Set up and register
      await setupPRFAuthenticator(context, page)
      const email = `sshca-container-${Date.now()}@example.com`
      const { token } = await registerUserWithPRF(page, server.url, email)

      // Get CA public key
      const caPublicKey = await fetchCAPublicKey(server.url, token)

      // Start container with CA
      container = await startSSHContainer({
        name: 'devsesh-ssh-ca-container-test',
        port: 2224,
        caPublicKey,
        flagContent: FLAG_CONTENT,
      })

      // Verify container is configured with CA
      expect(verifyCAConfiguration(container.name)).toBe(true)
      console.log('[SSH CA] ✓ Container configured with CA trust')

      // Verify flag file exists
      const flagContent = readFlagFile(container.name)
      expect(flagContent).toBe(FLAG_CONTENT)
      console.log('[SSH CA] ✓ Flag file exists with correct content')

    } finally {
      if (container) await stopSSHContainer(container)
      await stopServer(server)
    }
  })

  // Test: Container has tmux session for devsesh
  test('SSH container has testsession tmux session', async () => {
    let container: SSHContainer | null = null

    try {
      container = await startSSHContainer({
        name: 'devsesh-ssh-tmux-test',
        port: 2225,
        flagContent: FLAG_CONTENT,
      })

      // Verify tmux session exists
      expect(hasTmuxSession(container.name, 'testsession')).toBe(true)
      console.log('[SSH CA] ✓ tmux session "testsession" exists in container')

    } finally {
      if (container) await stopSSHContainer(container)
    }
  })

  // Test: Dashboard "Download CA Key" button downloads valid OpenSSH key [req.23hk63]
  test('dashboard Download CA Key button downloads valid OpenSSH key', async ({ page, context }) => {
    const server = await startServer()

    // Capture browser console for debugging
    const consoleLogs: string[] = []
    page.on('console', msg => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`)
    })

    try {
      // Set up and register user with PRF
      await setupPRFAuthenticator(context, page)
      const email = `sshca-download-${Date.now()}@example.com`
      const { token } = await registerUserWithPRF(page, server.url, email)

      // After registration, we should be on dashboard
      await expect(page).toHaveURL(/\/dashboard/)
      console.log('[SSH CA] On dashboard after registration')

      // Find the "Download CA Key" button
      const downloadButton = page.locator('button:has-text("Download CA Key")')
      await expect(downloadButton).toBeVisible({ timeout: 5000 })

      // Use Promise.all to start listening for download before the click
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        downloadButton.click(),
      ])
      console.log('[SSH CA] Download started:', download.suggestedFilename())

      // Verify filename
      expect(download.suggestedFilename()).toBe('devsesh-ca.pub')

      // Save and read the downloaded file
      const downloadPath = await download.path()
      if (!downloadPath) {
        throw new Error('Download path is null')
      }

      const content = fs.readFileSync(downloadPath, 'utf-8')
      console.log('[SSH CA] Downloaded content:', content.substring(0, 60) + '...')

      // Verify it's a valid OpenSSH Ed25519 public key
      // Format: "ssh-ed25519 <base64>\n" (comment is optional)
      expect(content).toMatch(/^ssh-ed25519\s+[A-Za-z0-9+/=]+\s*$/)
      console.log('[SSH CA] ✓ Downloaded key is valid OpenSSH format')

    } catch (error) {
      // Print browser console logs on failure
      console.log('\n=== BROWSER CONSOLE LOGS ===')
      consoleLogs.forEach(log => console.log(log))
      console.log('=== END BROWSER LOGS ===\n')
      throw error
    } finally {
      await stopServer(server)
    }
  })
})
