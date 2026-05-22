/**
 * SSH WASM Callback Export Tests
 *
 * Tests that all required callback registration functions are properly
 * exported by the WASM module. These functions must be available before
 * the SSHClient can set up its callbacks.
 *
 * If these tests fail, it means the WASM module wasn't built properly
 * or is missing required exports.
 */

import { test, expect, Page } from '@playwright/test'
import { startServer, stopServer, ServerInstance } from '../helpers/server'
import { setupPairedCli } from '../helpers/pairing'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

/**
 * All callback registration functions that the SSH WASM module must export.
 * These are called by SSHClient.setupCallbacks() to register JS callbacks.
 */
const REQUIRED_WASM_CALLBACKS = [
  'sshSetPasswordCallback',
  'sshSetOutputCallback',
  'sshSetStatusCallback',
  'sshSetCertificateCallback',
  'sshSetCertAuthFailedCallback',  // This one is causing the error
]

/**
 * All SSH operation functions that the WASM module must export.
 */
const REQUIRED_WASM_FUNCTIONS = [
  'sshConnect',
  'sshDisconnect',
  'sshExec',
  'sshSendInput',
  'sshResize',
  'sshResolvePassword',
  'sshRejectPassword',
  'sshResolveCertificate',
  'sshRejectCertificate',
]

interface TestContext {
  server: ServerInstance
  token: string
  sessionId: string
  tempDir: string
  configPath: string
  sessionDir: string
}

async function setupMinimalTestEnvironment(page: Page): Promise<TestContext> {
  const server = await startServer()
  const testEmail = `wasm-test-${Date.now()}@example.com`
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-wasm-test-'))
  const configPath = path.join(tempDir, 'config.yml')
  const sessionDir = path.join(tempDir, 'sessions')
  fs.mkdirSync(sessionDir, { recursive: true })

  const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir)

  // Get the session ID (we just need one for navigation)
  const sessionsRes = await fetch(`${server.url}/api/v1/sessions`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  const sessions = await sessionsRes.json()
  const sessionId = sessions[0]?.id || 'test-session'

  return { server, token, sessionId, tempDir, configPath, sessionDir }
}

async function cleanupTestEnvironment(ctx: TestContext): Promise<void> {
  await stopServer(ctx.server)
  fs.rmSync(ctx.tempDir, { recursive: true, force: true })
}

/**
 * Trigger WASM loading by manually loading the Go WASM module.
 * This mimics what SSHClient.init() does.
 */
async function triggerWASMLoad(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Load wasm_exec.js if not already loaded
    if (!(window as any).Go) {
      const script = document.createElement('script')
      script.src = '/wasm_exec.js'
      document.body.appendChild(script)
      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('Failed to load wasm_exec.js'))
      })
    }

    // Load the WASM module
    const Go = (window as any).Go
    const go = new Go()
    const response = await fetch('/sshclient.wasm')
    const buffer = await response.arrayBuffer()
    const result = await WebAssembly.instantiate(buffer, go.importObject)

    // Start the Go program (runs in background)
    go.run(result.instance)

    // Give WASM a moment to register all functions
    await new Promise(resolve => setTimeout(resolve, 200))
  })
}

/**
 * Wait for the WASM module to initialize and all functions to be registered.
 * Returns an object with the availability status of each function.
 */
async function waitForWASMInit(page: Page, timeout: number = 10000): Promise<Record<string, boolean>> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const results = await page.evaluate((requiredFunctions: string[]) => {
      const status: Record<string, boolean> = {}
      for (const fn of requiredFunctions) {
        status[fn] = typeof (window as any)[fn] === 'function'
      }
      return status
    }, [...REQUIRED_WASM_CALLBACKS, ...REQUIRED_WASM_FUNCTIONS])

    // Check if all functions are available
    const allAvailable = Object.values(results).every(v => v)
    if (allAvailable) {
      return results
    }

    await page.waitForTimeout(200)
  }

  // Return final status (some may still be missing)
  return page.evaluate((requiredFunctions: string[]) => {
    const status: Record<string, boolean> = {}
    for (const fn of requiredFunctions) {
      status[fn] = typeof (window as any)[fn] === 'function'
    }
    return status
  }, [...REQUIRED_WASM_CALLBACKS, ...REQUIRED_WASM_FUNCTIONS])
}

test.describe('SSH WASM Module Callback Exports', () => {

  /**
   * Test that sshSetCertAuthFailedCallback is exported by the WASM module.
   *
   * This test FAILS with error:
   *   "window.sshSetCertAuthFailedCallback is not a function"
   *
   * The function is defined in client.go (SetCertAuthFailedCallback) and
   * registered in main.go, but it appears the WASM wasn't rebuilt after
   * this function was added.
   */
  test('sshSetCertAuthFailedCallback is exported and callable', async ({ page }) => {
    let ctx: TestContext | null = null
    const consoleLogs: string[] = []

    page.on('console', msg => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`)
    })

    page.on('pageerror', error => {
      consoleLogs.push(`[PAGE ERROR] ${error.message}`)
    })

    try {
      ctx = await setupMinimalTestEnvironment(page)

      // Navigate to any page (we just need a page to load WASM into)
      await page.goto(`${ctx.server.url}/sessions/${ctx.sessionId}`)
      await page.waitForLoadState('networkidle')

      // Manually trigger WASM loading (the SSHClient normally does this on init)
      console.log('Triggering WASM module load...')
      await triggerWASMLoad(page)

      // Wait for WASM to initialize
      console.log('Waiting for WASM module to initialize...')
      const wasmStatus = await waitForWASMInit(page)

      // Log status of all functions
      console.log('WASM function export status:')
      for (const [fn, available] of Object.entries(wasmStatus)) {
        console.log(`  ${fn}: ${available ? '✓' : '✗'}`)
      }

      // Specifically check sshSetCertAuthFailedCallback
      const certAuthFailedCallbackAvailable = wasmStatus['sshSetCertAuthFailedCallback']

      if (!certAuthFailedCallbackAvailable) {
        console.log('\n=== BROWSER CONSOLE LOGS ===')
        consoleLogs.forEach(log => console.log(log))
        console.log('=== END BROWSER LOGS ===\n')
      }

      expect(certAuthFailedCallbackAvailable).toBe(true)

      // Additionally, verify it's actually callable without crashing
      const callResult = await page.evaluate(() => {
        try {
          const fn = (window as any).sshSetCertAuthFailedCallback
          if (typeof fn !== 'function') {
            return { success: false, error: 'Not a function' }
          }
          // Call it with a test callback
          fn((reason: string) => {
            console.log('Cert auth failed callback invoked:', reason)
          })
          return { success: true, error: null }
        } catch (e: any) {
          return { success: false, error: e.message }
        }
      })

      expect(callResult.success).toBe(true)
      if (!callResult.success) {
        console.log('Error calling sshSetCertAuthFailedCallback:', callResult.error)
      }

      console.log('✅ sshSetCertAuthFailedCallback is properly exported and callable')

    } finally {
      if (ctx) await cleanupTestEnvironment(ctx)
    }
  })

  /**
   * Test that ALL required callback registration functions are exported.
   */
  test('all SSH callback registration functions are exported', async ({ page }) => {
    let ctx: TestContext | null = null
    const consoleLogs: string[] = []

    page.on('console', msg => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`)
    })

    try {
      ctx = await setupMinimalTestEnvironment(page)

      await page.goto(`${ctx.server.url}/sessions/${ctx.sessionId}`)
      await page.waitForLoadState('networkidle')

      await triggerWASMLoad(page)
      const wasmStatus = await waitForWASMInit(page)

      // Check all callback registration functions
      const missingCallbacks: string[] = []
      for (const fn of REQUIRED_WASM_CALLBACKS) {
        if (!wasmStatus[fn]) {
          missingCallbacks.push(fn)
        }
      }

      if (missingCallbacks.length > 0) {
        console.log('\n=== MISSING CALLBACK FUNCTIONS ===')
        missingCallbacks.forEach(fn => console.log(`  - ${fn}`))
        console.log('=== END MISSING CALLBACKS ===\n')

        console.log('\n=== BROWSER CONSOLE LOGS ===')
        consoleLogs.forEach(log => console.log(log))
        console.log('=== END BROWSER LOGS ===\n')
      }

      expect(missingCallbacks).toEqual([])
      console.log('✅ All callback registration functions are exported')

    } finally {
      if (ctx) await cleanupTestEnvironment(ctx)
    }
  })

  /**
   * Test that ALL required SSH operation functions are exported.
   */
  test('all SSH operation functions are exported', async ({ page }) => {
    let ctx: TestContext | null = null

    try {
      ctx = await setupMinimalTestEnvironment(page)

      await page.goto(`${ctx.server.url}/sessions/${ctx.sessionId}`)
      await page.waitForLoadState('networkidle')

      await triggerWASMLoad(page)
      const wasmStatus = await waitForWASMInit(page)

      const missingFunctions: string[] = []
      for (const fn of REQUIRED_WASM_FUNCTIONS) {
        if (!wasmStatus[fn]) {
          missingFunctions.push(fn)
        }
      }

      if (missingFunctions.length > 0) {
        console.log('\n=== MISSING OPERATION FUNCTIONS ===')
        missingFunctions.forEach(fn => console.log(`  - ${fn}`))
        console.log('=== END MISSING FUNCTIONS ===\n')
      }

      expect(missingFunctions).toEqual([])
      console.log('✅ All SSH operation functions are exported')

    } finally {
      if (ctx) await cleanupTestEnvironment(ctx)
    }
  })

  /**
   * Test that the WASM module doesn't crash when setting up all callbacks.
   * This simulates what SSHClient.setupCallbacks() does.
   */
  test('setting up all callbacks does not crash WASM', async ({ page }) => {
    let ctx: TestContext | null = null
    const consoleLogs: string[] = []

    page.on('console', msg => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`)
    })

    page.on('pageerror', error => {
      consoleLogs.push(`[PAGE ERROR] ${error.message}`)
    })

    try {
      ctx = await setupMinimalTestEnvironment(page)

      await page.goto(`${ctx.server.url}/sessions/${ctx.sessionId}`)
      await page.waitForLoadState('networkidle')

      await triggerWASMLoad(page)
      await waitForWASMInit(page)

      // Simulate what SSHClient.setupCallbacks() does
      const setupResult = await page.evaluate(() => {
        const errors: string[] = []

        // Try to set up each callback like SSHClient does
        try {
          (window as any).sshSetPasswordCallback(() => {
            console.log('Password callback invoked')
          })
        } catch (e: any) {
          errors.push(`sshSetPasswordCallback: ${e.message}`)
        }

        try {
          (window as any).sshSetOutputCallback((data: string) => {
            console.log('Output callback invoked')
          })
        } catch (e: any) {
          errors.push(`sshSetOutputCallback: ${e.message}`)
        }

        try {
          (window as any).sshSetStatusCallback((status: string, error?: string) => {
            console.log('Status callback invoked')
          })
        } catch (e: any) {
          errors.push(`sshSetStatusCallback: ${e.message}`)
        }

        try {
          (window as any).sshSetCertificateCallback(() => {
            console.log('Certificate callback invoked')
          })
        } catch (e: any) {
          errors.push(`sshSetCertificateCallback: ${e.message}`)
        }

        // This is the one that's failing
        try {
          (window as any).sshSetCertAuthFailedCallback((reason: string) => {
            console.log('Cert auth failed callback invoked:', reason)
          })
        } catch (e: any) {
          errors.push(`sshSetCertAuthFailedCallback: ${e.message}`)
        }

        return { errors }
      })

      if (setupResult.errors.length > 0) {
        console.log('\n=== CALLBACK SETUP ERRORS ===')
        setupResult.errors.forEach(err => console.log(`  - ${err}`))
        console.log('=== END ERRORS ===\n')

        console.log('\n=== BROWSER CONSOLE LOGS ===')
        consoleLogs.forEach(log => console.log(log))
        console.log('=== END BROWSER LOGS ===\n')
      }

      expect(setupResult.errors).toEqual([])
      console.log('✅ All callbacks set up successfully without crashing')

    } finally {
      if (ctx) await cleanupTestEnvironment(ctx)
    }
  })
})
