/**
 * Per-credential master key retrieval.
 *
 * Reproduces the multi-passkey "Unlock SSH Certificate" failure seen on a second
 * device (e.g. an iPhone passkey). Each passkey wraps the shared master key with
 * ITS OWN WebAuthn PRF output and stores its own encrypted blob in its
 * webauthn_credentials row. The unlock flow authenticates with a passkey, obtains
 * that passkey's PRF output, and must decrypt the blob that was wrapped with the
 * SAME passkey.
 *
 * The bug: GET /api/v1/auth/master-key always returned the *first* credential's
 * blob (GetFirstCredentialWithMasterKey, LIMIT 1) regardless of which passkey
 * authenticated. On the device holding the first passkey it worked; on every
 * other device the returned blob was wrapped with a different PRF, so AES-GCM
 * decryption failed with OperationError ("The operation failed for an
 * operation-specific reason").
 *
 * The fix: the client passes ?credential_id=<base64url(rawId)> and the server
 * returns that specific credential's blob.
 *
 * This test registers a user (creating passkey #1 with its master-key blob),
 * inserts a second passkey with its OWN distinct blob exactly as a cross-device
 * enrollment would (SaveCredentialWithMasterKey), and asserts the endpoint hands
 * back the blob belonging to the requested credential.
 */

import { test, expect } from '@playwright/test'
import { startServer, stopServer } from '../../helpers/server'
import { setupPRFAuthenticator, registerUserWithPRF } from '../../helpers/prf-auth'
import { getUserIdByEmail } from '../../helpers/enrollment'
import * as crypto from 'crypto'

test('master-key endpoint returns the blob for the authenticating credential', async ({ page, context }) => {
  const server = await startServer()
  try {
    await setupPRFAuthenticator(context, page)

    const email = `multi-passkey-${Date.now()}@example.com`
    const { token } = await registerUserWithPRF(page, server.url, email)

    const userId = await getUserIdByEmail(server.dbPath, email)
    expect(userId).not.toBeNull()

    const Database = require('better-sqlite3')

    // --- Read passkey #1 (created during registration) and inject passkey #2 ---
    let cred1IdB64url: string
    let masterKey1B64: string
    let cred2IdB64url: string
    let masterKey2B64: string

    const db = new Database(server.dbPath)
    try {
      // Read raw id bytes via CAST(... AS BLOB) so non-UTF8 credential ids survive.
      const row1 = db
        .prepare(
          'SELECT CAST(id AS BLOB) AS id, encrypted_master_key AS mk ' +
            'FROM webauthn_credentials WHERE user_id = ? ORDER BY rowid LIMIT 1'
        )
        .get(userId)
      expect(row1, 'registration should create a credential with a master key').toBeTruthy()
      expect(row1.mk, 'passkey #1 should have an encrypted master key').toBeTruthy()

      cred1IdB64url = Buffer.from(row1.id).toString('base64url')
      masterKey1B64 = Buffer.from(row1.mk).toString('base64')

      // Insert passkey #2 with its OWN distinct master-key blob. Use an ASCII id so
      // it round-trips through the server's TEXT-typed `id` column unambiguously
      // (Go stores credential ids as string(rawBytes)); the exact bytes don't
      // matter for this test, only that the blob is keyed to a distinct credential.
      const cred2Id = `testcred2-${crypto.randomBytes(8).toString('hex')}`
      cred2IdB64url = Buffer.from(cred2Id, 'ascii').toString('base64url')
      const masterKey2 = crypto.randomBytes(61) // 1 version + 12 nonce + 32 key + 16 tag
      masterKey2B64 = masterKey2.toString('base64')

      db.prepare(
        'INSERT INTO webauthn_credentials ' +
          '(id, user_id, public_key, sign_count, encrypted_master_key, backup_eligible, backup_state) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(cred2Id, userId, Buffer.from([0x01, 0x02, 0x03]), 0, masterKey2, 1, 1)
    } finally {
      db.close()
    }

    const fetchMasterKey = async (credentialId?: string): Promise<{ status: number; blob?: string }> => {
      const url = credentialId
        ? `${server.url}/api/v1/auth/master-key?credential_id=${credentialId}`
        : `${server.url}/api/v1/auth/master-key`
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!resp.ok) return { status: resp.status }
      const data = await resp.json()
      return { status: resp.status, blob: data.encrypted_master_key }
    }

    // The core regression: passkey #2 must get ITS OWN blob, not passkey #1's.
    // Before the fix this returned masterKey1B64, so the second device's PRF
    // could never decrypt it (OperationError).
    const forCred2 = await fetchMasterKey(cred2IdB64url)
    expect(forCred2.status).toBe(200)
    expect(forCred2.blob).toBe(masterKey2B64)

    // Passkey #1 still gets its own blob.
    const forCred1 = await fetchMasterKey(cred1IdB64url)
    expect(forCred1.status).toBe(200)
    expect(forCred1.blob).toBe(masterKey1B64)

    // No credential_id keeps the legacy "first credential" behaviour (back-compat).
    const legacy = await fetchMasterKey()
    expect(legacy.status).toBe(200)
    expect(legacy.blob).toBe(masterKey1B64)

    // Sanity: the two credentials really do have different blobs.
    expect(masterKey2B64).not.toBe(masterKey1B64)
  } finally {
    await stopServer(server)
  }
})
