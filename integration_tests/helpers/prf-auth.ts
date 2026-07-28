/**
 * PRF Authentication Helpers
 *
 * Helpers for WebAuthn PRF (Pseudo-Random Function) authentication in tests.
 * PRF is required for FROST certificate-based SSH authentication.
 *
 * The key challenge with PRF in Chromium's virtual authenticator is that it
 * produces different outputs even with identical inputs. We solve this by
 * intercepting navigator.credentials.get() and caching/replaying PRF outputs.
 */

import { Page, BrowserContext, expect } from '@playwright/test'
import { setupVirtualAuthenticator, VirtualAuthenticatorResult } from './webauthn'

/**
 * Add PRF consistency script to a page.
 *
 * Chromium's virtual authenticator produces different PRF outputs even with
 * identical inputs. This script intercepts navigator.credentials.get() and
 * ensures PRF output is consistent by storing and replaying the first PRF
 * result for subsequent calls with the same credential.
 *
 * Uses localStorage to persist PRF outputs across page navigations.
 */
export async function addPRFConsistencyScript(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Use localStorage to persist PRF outputs across page navigations
    const PRF_CACHE_KEY = '__prf_output_cache__'

    function getPrfCache(): Record<string, number[]> {
      try {
        const cached = localStorage.getItem(PRF_CACHE_KEY)
        const result = cached ? JSON.parse(cached) : {}
        console.log('[PRF Cache] Read cache, keys:', Object.keys(result).map(k => k.substring(0, 16) + '...'))
        return result
      } catch (e) {
        console.log('[PRF Cache] Read failed:', e)
        return {}
      }
    }

    function setPrfCache(cache: Record<string, number[]>): void {
      localStorage.setItem(PRF_CACHE_KEY, JSON.stringify(cache))
      console.log('[PRF Cache] Wrote cache, keys:', Object.keys(cache).map(k => k.substring(0, 16) + '...'))
    }

    // Store the original credentials.get
    const originalGet = navigator.credentials.get.bind(navigator.credentials)

    // Override credentials.get to provide consistent PRF output
    navigator.credentials.get = async function(options?: CredentialRequestOptions): Promise<Credential | null> {
      const result = await originalGet(options)

      if (result && options?.publicKey?.extensions) {
        const credential = result as PublicKeyCredential

        // Get credential ID as a string key
        const credIdArray = new Uint8Array(credential.rawId)
        const credIdKey = Array.from(credIdArray).map(b => b.toString(16).padStart(2, '0')).join('')

        // Get the original extension results
        const originalGetClientExtensionResults = credential.getClientExtensionResults.bind(credential)
        const originalExtResults = originalGetClientExtensionResults() as {
          prf?: { results?: { first?: ArrayBuffer } }
        }

        if (originalExtResults?.prf?.results?.first) {
          const cache = getPrfCache()

          let prfToUse: ArrayBuffer
          const originalPrfArray = Array.from(new Uint8Array(originalExtResults.prf.results.first))
          const originalPrfHash = originalPrfArray.slice(0, 4).join(',')

          // Check if we have a cached PRF output for this credential
          if (cache[credIdKey]) {
            // Use the cached PRF output
            const cachedPrfArray = cache[credIdKey]
            const cachedPrfHash = cachedPrfArray.slice(0, 4).join(',')
            console.log('[PRF Intercept] Using cached PRF for credential:', credIdKey.substring(0, 16) + '...')
            console.log('[PRF Intercept] Cached PRF first 4 bytes:', cachedPrfHash)
            console.log('[PRF Intercept] Original PRF first 4 bytes (ignored):', originalPrfHash)
            prfToUse = new Uint8Array(cachedPrfArray).buffer
          } else {
            // Store this PRF output for future calls
            console.log('[PRF Intercept] Caching PRF for credential:', credIdKey.substring(0, 16) + '...')
            console.log('[PRF Intercept] PRF first 4 bytes:', originalPrfHash)
            cache[credIdKey] = originalPrfArray
            setPrfCache(cache)
            prfToUse = originalExtResults.prf.results.first
          }

          // Test-only simulation of the Safari/iOS PRF quirk: a bare `eval` with
          // more than one allowCredentials entry returns a PRF that does NOT
          // match the per-credential value produced at enrollment (the real
          // iPhone-can't-do-SSH bug). `evalByCredential` is unaffected. Gated by
          // a localStorage flag so only opted-in tests see it. Chromium's virtual
          // authenticator can't reproduce this on its own, so we inject it here.
          try {
            if (localStorage.getItem('__ios_prf_multicred_sim__') === '1') {
              const reqPrf = (options?.publicKey?.extensions as { prf?: { eval?: unknown; evalByCredential?: unknown } } | undefined)?.prf
              const usesEvalByCredential = !!(reqPrf && reqPrf.evalByCredential)
              const nAllow = options?.publicKey?.allowCredentials?.length || 0
              if (reqPrf && !usesEvalByCredential && nAllow > 1) {
                const corrupted = new Uint8Array(prfToUse.slice(0))
                corrupted[0] ^= 0xff
                prfToUse = corrupted.buffer
                console.log('[iOS PRF sim] bare eval + multi allowCredentials -> returning mismatched PRF')
              }
            }
          } catch (e) {
            console.log('[iOS PRF sim] error:', e)
          }

          // Override getClientExtensionResults to always return the correct PRF
          ;(credential as any).getClientExtensionResults = function() {
            const results = originalGetClientExtensionResults()
            if (results.prf?.results) {
              results.prf.results.first = prfToUse
            }
            return results
          }
        }
      }

      return result
    }

    console.log('[PRF Intercept] WebAuthn PRF consistency script installed (localStorage-backed)')
  })
}

/**
 * Set up a virtual authenticator with PRF support and consistency script.
 *
 * This combines:
 * 1. Adding the PRF consistency script (MUST be done before authenticator)
 * 2. Setting up the virtual authenticator with PRF enabled
 *
 * @param context - Browser context
 * @param page - Page to set up
 * @returns Virtual authenticator result
 */
export async function setupPRFAuthenticator(
  context: BrowserContext,
  page: Page
): Promise<VirtualAuthenticatorResult> {
  // Add PRF consistency script BEFORE setting up virtual authenticator
  await addPRFConsistencyScript(page)
  console.log('[PRF Auth] PRF consistency script added')

  // Set up virtual WebAuthn authenticator with PRF support
  const result = await setupVirtualAuthenticator(context, page)
  console.log('[PRF Auth] Virtual authenticator created:', result.authenticatorId)

  return result
}

/**
 * Register a user with WebAuthn + PRF.
 *
 * This differs from regular registration in that:
 * 1. It requires PRF consistency script to be installed
 * 2. The registration flow creates FROST key shares on the server
 * 3. Registration auto-logs in the user and redirects to dashboard
 *
 * @param page - Playwright page
 * @param serverUrl - Server base URL
 * @param email - User email
 * @returns JWT token
 */
export async function registerUserWithPRF(
  page: Page,
  serverUrl: string,
  email: string
): Promise<{ token: string }> {
  // Navigate to registration page
  await page.goto(`${serverUrl}/register`)
  await expect(page).toHaveURL(/\/register$/)
  await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible()

  // Enter email
  const emailInput = page.locator('input[type="email"]')
  await expect(emailInput).toBeVisible()
  await emailInput.fill(email)

  // Submit form - virtual authenticator with PRF will handle the WebAuthn flow
  const submitButton = page.locator('button[type="submit"]')
  await expect(submitButton).toBeVisible()
  await submitButton.click()

  // Wait for redirect to dashboard (registration auto-logs in)
  // This takes longer than normal registration because of FROST key generation
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 })

  // Get the token from localStorage
  const token = await page.evaluate(() => window.localStorage.getItem('token'))
  if (!token) {
    throw new Error('Token not found after registration')
  }

  return { token }
}

/**
 * Verify that SSH CA data was created during registration.
 *
 * @param dbPath - Path to SQLite database
 * @param email - User email
 * @returns true if SSH CA record exists with all required fields
 */
export async function verifySSHCACreated(dbPath: string, email: string): Promise<boolean> {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath, { readonly: true })

  try {
    const result = db.prepare(`
      SELECT sc.public_key, sc.server_share, sc.server_verifying_share, sc.client_verifying_share
      FROM ssh_ca sc
      JOIN users u ON u.id = sc.user_id
      WHERE u.email = ?
    `).get(email)

    return result !== undefined &&
           result.public_key !== null &&
           result.server_share !== null &&
           result.server_verifying_share !== null &&
           result.client_verifying_share !== null
  } finally {
    db.close()
  }
}

/**
 * Verify that encrypted client share exists.
 *
 * @param dbPath - Path to SQLite database
 * @param email - User email
 * @returns true if encrypted client share exists
 */
export async function verifyClientShareExists(dbPath: string, email: string): Promise<boolean> {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath, { readonly: true })

  try {
    const result = db.prepare(`
      SELECT scs.encrypted_share
      FROM ssh_ca_client_shares scs
      JOIN users u ON u.id = scs.user_id
      WHERE u.email = ?
    `).get(email)

    return result !== undefined && result.encrypted_share !== null
  } finally {
    db.close()
  }
}

/**
 * Fetch CA public key from the server.
 *
 * @param serverUrl - Server base URL
 * @param token - JWT token
 * @returns CA public key in OpenSSH format
 */
export async function fetchCAPublicKey(serverUrl: string, token: string): Promise<string> {
  const response = await fetch(`${serverUrl}/api/v1/sshca/public-key`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch CA public key: ${response.status}`)
  }

  const data = await response.json()
  return data.public_key
}
