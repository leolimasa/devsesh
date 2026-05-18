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
import { startServer, stopServer, ServerInstance } from '../helpers/server'
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
} from '../helpers/ssh-container'
import { spawnDevseshStart, killTmuxSession, waitForSessionInApi } from '../helpers/session'
import { spawnDevseshLogin, extractPairingCode, waitForCliSuccess } from '../helpers/cli'
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

  // Wait for Connect button to appear
  await page.waitForSelector('button:has-text("Connect")', { timeout: 15000 })
  console.log('[SSH CA] Session page loaded, Connect button visible')

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

  // Click Connect button
  const connectButton = page.locator('button:has-text("Connect")')
  await expect(connectButton).toBeVisible({ timeout: 10000 })
  await connectButton.click()
  console.log('[SSH CA] Connect button clicked')

  // Wait for WebAuthn dialog to appear
  // This indicates the FROST certificate workflow is triggered
  const webAuthnDialog = page.locator('[role="alertdialog"]:has-text("Unlock SSH Certificate")')
  await webAuthnDialog.waitFor({ state: 'visible', timeout: 20000 })
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

  // Wait for connected status
  await page.waitForSelector('text=🟢 Connected', { timeout: 60000 })
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
})
