import { test, expect, Page } from "@playwright/test"
import { startServer, stopServer, ServerInstance } from "../helpers/server"
import { setupPairedCli } from "../helpers/pairing"
import {
  spawnDevseshStart,
  killTmuxSession,
  waitForSessionInApi,
} from "../helpers/session"
import {
  startSSHContainer as startContainer,
  stopSSHContainer as stopContainer,
  SSHContainer,
} from "../helpers/ssh-container"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import { execSync } from "child_process"

const CONTAINER_NAME = "devsesh-qk-test-integration"
let containerIndex = 0
let sshContainer: SSHContainer | null = null

async function startSSHContainer(): Promise<number> {
  const name = `${CONTAINER_NAME}-${Date.now()}-${containerIndex++}`
  try { require("child_process").execSync(`docker rm -f ${name}`, { stdio: "ignore" }) } catch {}
  sshContainer = await startContainer({ name, port: 2222 })
  return sshContainer.port
}

async function stopSSHContainer(): Promise<void> {
  if (sshContainer) {
    await stopContainer(sshContainer)
    sshContainer = null
  }
}

interface TestContext {
  server: ServerInstance
  token: string
  hostId: number
  sessionId: string
  sessionName: string
  tempDir: string
  configPath: string
  sessionDir: string
  pingInterval: NodeJS.Timeout | null
  devseshProcess: any
}

async function setupTestEnvironment(
  page: Page,
  options: { withSession?: boolean } = {}
): Promise<TestContext> {
  const server = await startServer()
  const testEmail = `qk-e2e-${Date.now()}@example.com`
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "devsesh-qk-e2e-"))
  const configPath = path.join(tempDir, "config.yml")
  const sessionDir = path.join(tempDir, "sessions")
  fs.mkdirSync(sessionDir, { recursive: true })

  let sshPort = 2222
  if (options.withSession) {
    sshPort = await startSSHContainer()
    console.log("SSH container started on port:", sshPort)
  }

  const token = await setupPairedCli(page, server.url, testEmail, configPath, sessionDir)
  console.log("User paired successfully")

  const hostsRes = await fetch(`${server.url}/api/v1/hosts`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(hostsRes.ok).toBe(true)
  const hosts = await hostsRes.json()
  expect(hosts.length).toBeGreaterThan(0)
  const hostId = hosts[0].id

  let sessionId = ""
  let sessionName = ""
  let pingInterval: NodeJS.Timeout | null = null
  let devseshProcess: any = null

  if (options.withSession) {
    const updateHostRes = await fetch(`${server.url}/api/v1/hosts/${hostId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        label: `test-host-qk-${Date.now()}`,
        hostname: "localhost",
        ssh_user: "testuser",
        ssh_port: sshPort,
      }),
    })
    expect(updateHostRes.ok).toBe(true)

    sessionName = `test-session-${Date.now()}`
    devseshProcess = spawnDevseshStart(sessionName, configPath, sessionDir, server.url)

    const foundSession = await waitForSessionInApi(server.url, token, sessionName, 15000)
    sessionId = foundSession.id

    pingInterval = setInterval(async () => {
      try {
        await fetch(`${server.url}/api/v1/sessions/${sessionId}/ping`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch {}
    }, 2000)
  }

  return {
    server,
    token,
    hostId,
    sessionId,
    sessionName,
    tempDir,
    configPath,
    sessionDir,
    pingInterval,
    devseshProcess,
  }
}

async function cleanupTestEnvironment(ctx: TestContext): Promise<void> {
  if (ctx.pingInterval) clearInterval(ctx.pingInterval)
  if (ctx.devseshProcess) {
    killTmuxSession(ctx.sessionName)
  }
  await stopSSHContainer()
  await stopServer(ctx.server)
  fs.rmSync(ctx.tempDir, { recursive: true, force: true })
}

// Helper: navigate and handle auto-connect
async function navigateToSession(page: Page, serverUrl: string, sessionId: string): Promise<void> {
  await page.goto(`${serverUrl}/sessions/${sessionId}`, { waitUntil: "domcontentloaded" })
  // Give React + WASM time to initialize (SSH WebSocket keeps network "busy")
  await page.waitForTimeout(5000)
}

// Helper: dismiss the WebAuthn and password dialogs that auto-connect triggers.
// The SSHTerminal auto-connects on mount; when FROST is locked it surfaces the
// WebAuthnDialog, whose Radix overlay (z-50 bg-black/80) intercepts all clicks.
// Dismissing it (and the password fallback) frees the top bar for interaction.
//
// The WASM SSH client takes several seconds to load in headless Chromium, so
// the dialog may not appear for 10–15 s. We loop-wait for it then dismiss both
// dialogs, finally sweeping any leftover portal overlays.
async function dismissAutoConnectDialogs(page: Page): Promise<void> {
  // Wait for the WebAuthn dialog to materialise (up to 30 s).
  // Falls through immediately if the SSH client hasn't loaded after 30 s.
  await page.locator('button:has-text("Use Password Instead")')
    .waitFor({ state: "visible", timeout: 30000 }).catch(() => {})

  // Dismiss the dialog — prefer evaluate so portal rendering doesn't interfere.
  const dismissed = await page.evaluate(() => {
    const btns = document.querySelectorAll("button")
    for (const btn of btns) {
      if (btn.textContent?.includes("Use Password Instead")) {
        ;(btn as HTMLButtonElement).click()
        return true
      }
    }
    return false
  })
  if (dismissed) await page.waitForTimeout(1000)

  // Dismiss the password fallback dialog.
  await page.locator('button:has-text("Cancel")')
    .waitFor({ state: "visible", timeout: 10000 }).catch(() => {})
  const pwDismissed = await page.evaluate(() => {
    const btns = document.querySelectorAll("button")
    for (const btn of btns) {
      if (btn.textContent?.trim() === "Cancel") {
        ;(btn as HTMLButtonElement).click()
        return true
      }
    }
    return false
  })
  if (pwDismissed) await page.waitForTimeout(500)

  // Remove any lingering Radix portal overlays that survive the dialog close.
  await page.evaluate(() => {
    document.querySelectorAll('div[data-state="open"][aria-hidden="true"]').forEach((el) => {
      ;(el as HTMLElement).style.display = "none"
    })
  })
  await page.waitForTimeout(300)
}

// Helper: drive the auto-connect dialogs to a live password-authenticated
// connection. Dismisses the Radix WebAuthn overlay (which intercepts normal
// clicks, hence evaluate), then fills + submits the plain password dialog using
// Playwright's fill() so React's controlled input actually commits the value.
async function connectViaPassword(page: Page): Promise<void> {
  // The WebAuthn dialog only appears once the WASM SSH client has loaded.
  await page
    .locator('button:has-text("Use Password Instead")')
    .waitFor({ state: "visible", timeout: 45000 })
  await page.evaluate(() => {
    for (const btn of document.querySelectorAll("button")) {
      if (btn.textContent?.includes("Use Password Instead")) {
        ;(btn as HTMLButtonElement).click()
        return
      }
    }
  })

  const pwd = page.locator('input[type="password"]')
  await pwd.waitFor({ state: "visible", timeout: 15000 })
  await pwd.fill("testpass")
  // Exact match: "has-text('Connect')" would also match the top-bar "Disconnect".
  await page.getByRole("button", { name: "Connect", exact: true }).click()
}

test.describe("Quick Keys Integration Tests", () => {
  // ─── API CRUD scoped to user ────────────────────────────────────────

  test("Quick Keys CRUD via API is scoped to authenticated user", async ({ page }) => {
    let ctx: TestContext | null = null
    try {
      ctx = await setupTestEnvironment(page)
      const { server, token } = ctx

      // CREATE
      const createRes = await fetch(`${server.url}/api/v1/quick-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: "Test Key",
          display_token: "TK",
          spec: JSON.stringify([{ type: "combo", ctrl: true, alt: false, shift: false, key: "c" }]),
          pinned: false,
          sort_order: 0,
        }),
      })
      expect(createRes.ok).toBe(true)
      const created = await createRes.json()
      expect(created.id).toBeGreaterThan(0)
      console.log("Created quick key ID:", created.id)

      // LIST
      const listRes = await fetch(`${server.url}/api/v1/quick-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(listRes.ok).toBe(true)
      const keys = await listRes.json()
      expect(keys.length).toBe(1)
      expect(keys[0].name).toBe("Test Key")

      // GET by ID
      const getRes = await fetch(`${server.url}/api/v1/quick-keys/${created.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(getRes.ok).toBe(true)

      // Unauthenticated access gets 401
      const unauthRes = await fetch(`${server.url}/api/v1/quick-keys/${created.id}`, {
        headers: { Authorization: "Bearer invalidtoken" },
      })
      expect(unauthRes.status).toBe(401)
      console.log("Unauthenticated access properly rejected")

      // UPDATE (pin toggle)
      const updateRes = await fetch(`${server.url}/api/v1/quick-keys/${created.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pinned: true }),
      })
      expect(updateRes.ok).toBe(true)
      const updated = await updateRes.json()
      expect(updated.pinned).toBe(true)

      // DELETE
      const delRes = await fetch(`${server.url}/api/v1/quick-keys/${created.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(delRes.status).toBe(204)

      // List empty after delete
      const afterDel = await fetch(`${server.url}/api/v1/quick-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const afterKeys = await afterDel.json()
      expect(afterKeys.length).toBe(0)

      console.log("Quick Keys CRUD scoping test passed")
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx)
    }
  })

  // ─── Pinned Keys Across Sessions ─────────────────────────────────────

  test("Pinned quick keys appear in session top bar", async ({ page }) => {
    let ctx: TestContext | null = null
    try {
      ctx = await setupTestEnvironment(page, { withSession: true })
      const { server, token, sessionId } = ctx

      // Create a pinned quick key
      const createRes = await fetch(`${server.url}/api/v1/quick-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: "Pinned Test",
          display_token: "PT",
          spec: JSON.stringify([{ type: "combo", ctrl: true, alt: false, shift: false, key: "c" }]),
          pinned: true,
          sort_order: 0,
        }),
      })
      expect(createRes.ok).toBe(true)
      const keyId = (await createRes.json()).id
      console.log("Created pinned quick key ID:", keyId)

      await navigateToSession(page, server.url, sessionId)

      // Pinned key display_token should appear in the top bar
      const pinnedPill = page.locator('[data-pill]:has-text("PT")')
      await expect(pinnedPill).toBeVisible({ timeout: 10000 })
      console.log("Pinned quick key visible in top bar")
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx)
    }
  })

  test("Pinned quick keys persist across different sessions", async ({ page }) => {
    let ctx: TestContext | null = null
    try {
      ctx = await setupTestEnvironment(page, { withSession: true })
      const { server, token, configPath, sessionDir } = ctx

      // Create a pinned quick key
      const createRes = await fetch(`${server.url}/api/v1/quick-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: "Across Sessions",
          display_token: "AS",
          spec: JSON.stringify([{ type: "combo", ctrl: true, alt: false, shift: false, key: "d" }]),
          pinned: true,
          sort_order: 0,
        }),
      })
      expect(createRes.ok).toBe(true)

      // Start a second session
      const sessionName2 = `second-session-${Date.now()}`
      const devseshProcess2 = spawnDevseshStart(sessionName2, configPath, sessionDir, server.url)
      const foundSession2 = await waitForSessionInApi(server.url, token, sessionName2, 15000)
      const sessionId2 = foundSession2.id
      console.log("Second session ID:", sessionId2)

      const ping2 = setInterval(async () => {
        try {
          await fetch(`${server.url}/api/v1/sessions/${sessionId2}/ping`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          })
        } catch {}
      }, 2000)

      try {
        await navigateToSession(page, server.url, sessionId2)

        const pinnedPill = page.locator('[data-pill]:has-text("AS")')
        await expect(pinnedPill).toBeVisible({ timeout: 10000 })
        console.log("Pinned key visible in second session's top bar")
      } finally {
        clearInterval(ping2)
        killTmuxSession(sessionName2)
      }
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx)
    }
  })

  // ─── Quick Key Overlay UI ──────────────────────────────────────────

  test("Quick Keys overlay opens and all three tabs are functional", async ({ page }) => {
    test.setTimeout(120000) // SSH WASM init is slow in headless
    let ctx: TestContext | null = null
    try {
      ctx = await setupTestEnvironment(page, { withSession: true })
      const { server, sessionId } = ctx

      await navigateToSession(page, server.url, sessionId)

      // The SSHTerminal auto-connects, triggering the WebAuthn dialog.
      // If we "Cancel" the password dialog the terminal disconnects and
      // auto-reconnect reopens the dialogs — an infinite loop.  Instead,
      // succeed the SSH connection with the test password, then the page
      // is stable and we can freely interact with the top bar.
      const overlayReady = await page.evaluate(() => {
        const allBtns = () => document.querySelectorAll("button")
        const clickByText = (text: string) => {
          for (const btn of allBtns()) {
            if (btn.textContent?.includes(text)) {
              ;(btn as HTMLButtonElement).click()
              return true
            }
          }
          return false
        }

        return new Promise<boolean>((resolve) => {
          let attempts = 0
          const tryFlow = () => {
            // Step 1: dismiss WebAuthn dialog ("Use Password Instead")
            if (clickByText("Use Password Instead")) {
              // Step 2: wait for password dialog, fill it, connect
              setTimeout(() => {
                const pwdInput = document.querySelector(
                  'input[type="password"]'
                ) as HTMLInputElement | null
                if (pwdInput) {
                  pwdInput.value = "testpass"
                  pwdInput.dispatchEvent(new Event("input", { bubbles: true }))
                  pwdInput.dispatchEvent(new Event("change", { bubbles: true }))
                  // Click "Connect" (not "Cancel")
                  clickByText("Connect")
                  // Wait for connection, then open overlay
                  setTimeout(() => {
                    const kb = document.querySelector(
                      'button[title="Quick Keys"]'
                    ) as HTMLButtonElement | null
                    setTimeout(() => {
                      kb?.click()
                      setTimeout(() => resolve(true), 600)
                    }, 1000)
                  }, 2000)
                  return
                }
                // Password dialog not ready yet — retry
                if (++attempts < 20) {
                  setTimeout(tryFlow, 500)
                } else {
                  resolve(false)
                }
              }, 400)
              return
            }
            if (++attempts < 40) {
              setTimeout(tryFlow, 500)
            } else {
              resolve(false)
            }
          }
          setTimeout(tryFlow, 400)
        })
      })
      expect(overlayReady).toBe(true)

      // Now verify overlay tabs with normal Playwright assertions.
      await expect(page.locator('button:has-text("Send")')).toBeVisible({ timeout: 5000 })
      // Common presets should be visible
      await expect(page.locator('button:has-text("^C")')).toBeVisible({ timeout: 5000 })
      await expect(page.locator('button:has-text("Esc")')).toBeVisible({ timeout: 5000 })

      // Tab 2: Builder
      const builderTab = page.locator('button:has-text("Builder")')
      await builderTab.click()
      await page.waitForTimeout(500)

      // Builder fields present
      await expect(page.locator('input[placeholder="e.g. Tmux Detach"]')).toBeVisible({ timeout: 5000 })
      await expect(page.locator("text=Byte Preview")).toBeVisible({ timeout: 5000 })

      // Add a Ctrl+C combo step and verify live preview
      const ctrlCheckbox = page.locator('label:has-text("Ctrl") input[type="checkbox"]')
      await ctrlCheckbox.check()
      const addButton = page.locator('button:has-text("Add"):not(:has(svg))').first()
      await addButton.click()
      await page.waitForTimeout(300)
      await expect(page.locator('text=\\x03')).toBeVisible({ timeout: 5000 })
      console.log("Builder combo step and live preview verified")

      // Tab 3: Manage — empty state
      const manageTab = page.locator('button:has-text("Manage")')
      await manageTab.click()
      await page.waitForTimeout(500)

      await expect(page.locator("text=No saved quick keys yet")).toBeVisible({ timeout: 5000 })
      console.log("Quick Keys overlay tabs all verified")
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx)
    }
  })

  test("Builder creates and saves a quick key", async ({ page }) => {
    test.setTimeout(120000) // SSH WASM init is slow in headless
    let ctx: TestContext | null = null
    try {
      ctx = await setupTestEnvironment(page, { withSession: true })
      const { server, sessionId } = ctx

      await navigateToSession(page, server.url, sessionId)

      // Connect via password (avoids auto-reconnect loop) and open overlay
      const ready = await page.evaluate(() => {
        const clickByText = (text: string) => {
          for (const btn of document.querySelectorAll("button")) {
            if (btn.textContent?.includes(text)) { (btn as HTMLButtonElement).click(); return true }
          }
          return false
        }
        return new Promise<boolean>((resolve) => {
          let attempts = 0
          const tryFlow = () => {
            if (clickByText("Use Password Instead")) {
              setTimeout(() => {
                const pwdInput = document.querySelector('input[type="password"]') as HTMLInputElement | null
                if (pwdInput) {
                  pwdInput.value = "testpass"
                  pwdInput.dispatchEvent(new Event("input", { bubbles: true }))
                  clickByText("Connect")
                  setTimeout(() => {
                    const kb = document.querySelector('button[title="Quick Keys"]') as HTMLButtonElement | null
                    setTimeout(() => { kb?.click(); setTimeout(() => resolve(true), 600) }, 1000)
                  }, 2000)
                  return
                }
                if (++attempts < 20) { setTimeout(tryFlow, 500) } else { resolve(false) }
              }, 400)
              return
            }
            if (++attempts < 40) { setTimeout(tryFlow, 500) } else { resolve(false) }
          }
          setTimeout(tryFlow, 400)
        })
      })
      expect(ready).toBe(true)

      // Overlay should now be open
      await page.waitForTimeout(800)
      await expect(page.locator('button:has-text("Send")')).toBeVisible({ timeout: 5000 })

      // Switch to Builder
      await page.locator('button:has-text("Builder")').click()
      await page.waitForTimeout(500)

      // Fill name and display token
      await page.locator('input[placeholder="e.g. Tmux Detach"]').fill("Integration Key")
      await page.locator('input[placeholder="e.g. ^A d"]').fill("IK")

      // Add a combo step
      await page.locator('label:has-text("Ctrl") input[type="checkbox"]').check()
      await page.locator('button:has-text("Add"):not(:has(svg))').first().click()
      await page.waitForTimeout(300)

      // Check "Pin to top bar" (the checkbox outside the combo/literal builder)
      const pinCheckbox = page.locator('text=Pin to top bar').locator('input[type="checkbox"]')
      await pinCheckbox.check()

      // Save
      await page.locator('button:has-text("Save")').click()
      await page.waitForTimeout(1000)

      // Switch to Manage tab and check saved key appears
      await page.locator('button:has-text("Manage")').click()
      await page.waitForTimeout(500)

      await expect(page.locator('text=Integration Key')).toBeVisible({ timeout: 5000 })
      // The display token renders in several places (visible top-bar pill, the
      // aria-hidden measurement row, the manage list). Assert against a visible
      // occurrence so the hidden measurement span doesn't satisfy/steal the match.
      await expect(page.locator('text=IK >> visible=true').first()).toBeVisible({ timeout: 5000 })

      console.log("Builder save and Manage list verified")
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx)
    }
  })

  // ─── PTY byte injection over a live session ────────────────────────────

  test("Sending a quick key injects the expected bytes into the live PTY", async ({ page }) => {
    test.setTimeout(120000) // SSH WASM init + connection is slow in headless
    let ctx: TestContext | null = null
    try {
      ctx = await setupTestEnvironment(page, { withSession: true })
      const { server, token, sessionId, sessionName } = ctx
      const containerName = sshContainer!.name

      // The browser terminal runs `tmux attach -t <sessionName>` inside the
      // container, so create that tmux session as testuser (the SSH user) — its
      // pane is what we'll read back to prove the injected bytes arrived.
      execSync(
        `docker exec -u testuser ${containerName} tmux new-session -d -s ${sessionName}`,
        { stdio: "ignore" }
      )

      // A pinned quick key whose spec is a literal "echo <marker>" + Enter.
      // Clicking its top-bar pill must type + run it in the attached PTY.
      const marker = `QKINJECT_${Date.now()}`
      const createRes = await fetch(`${server.url}/api/v1/quick-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: "Echo Marker",
          display_token: "EI",
          spec: JSON.stringify([{ type: "literal", text: `echo ${marker}`, enter: true }]),
          pinned: true,
          sort_order: 0,
        }),
      })
      expect(createRes.ok).toBe(true)

      await navigateToSession(page, server.url, sessionId)

      // Establish a live password-authenticated connection.
      await connectViaPassword(page)

      // Wait for the terminal to report Connected, then give `tmux attach` a
      // moment to take over the channel before we inject.
      await expect(page.getByText("Connected")).toBeVisible({ timeout: 30000 })
      await page.waitForTimeout(3000)

      // Click the pinned pill → onSendKey(spec) → terminal.sendKeys → SSH PTY.
      const pill = page.locator('[data-pill]:has-text("EI")')
      await expect(pill).toBeVisible({ timeout: 10000 })
      await pill.click()

      // Verify the bytes reached the PTY: the marker shows up in the tmux pane.
      await expect
        .poll(
          () =>
            execSync(
              `docker exec -u testuser ${containerName} tmux capture-pane -t ${sessionName} -p`,
              { encoding: "utf8" }
            ),
          { timeout: 20000, intervals: [1000, 1000, 2000] }
        )
        .toContain(marker)

      console.log("Quick key bytes verified in the live PTY pane")
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx)
    }
  })

  // ─── Mobile Viewport ──────────────────────────────────────────────────

  test("Mobile viewport shows top bar + terminal with hamburger for details", async ({ page }) => {
    let ctx: TestContext | null = null
    try {
      ctx = await setupTestEnvironment(page, { withSession: true })
      const { server, sessionId } = ctx

      await page.setViewportSize({ width: 375, height: 812 })
      await navigateToSession(page, server.url, sessionId)

      // Top bar should be visible
      await expect(page.locator(".bg-muted.border-b")).toBeVisible({ timeout: 10000 })

      // Desktop details panel hidden on mobile
      const detailsPanel = page.locator(".hidden.md\\:block.w-72")
      const isDesktopPanelVisible = await detailsPanel.isVisible().catch(() => false)
      expect(isDesktopPanelVisible).toBe(false)
      console.log("Desktop details panel hidden on mobile")

      // Hamburger button visible
      const hamburger = page.locator('button[aria-label="Details"]')
      await expect(hamburger).toBeVisible({ timeout: 5000 })

      console.log("Mobile layout verified: top bar, hidden desktop panel, hamburger present")
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx)
    }
  })

  test("Mobile viewport shows keyboard icon and connect button", async ({ page }) => {
    let ctx: TestContext | null = null
    try {
      ctx = await setupTestEnvironment(page, { withSession: true })
      const { server, sessionId } = ctx

      await page.setViewportSize({ width: 375, height: 812 })
      await navigateToSession(page, server.url, sessionId)

      // Keyboard icon visible
      await expect(page.locator('button[title="Quick Keys"]')).toBeVisible({ timeout: 10000 })

      // Connect/Disconnect button visible
      await expect(page.locator('button:has-text("Connect")').or(page.locator('button:has-text("Disconnect")'))).toBeVisible({ timeout: 10000 })

      console.log("Mobile top bar controls visible")
    } finally {
      if (ctx) await cleanupTestEnvironment(ctx)
    }
  })
})
