export { encodeBase64, decodeBase64, encodeBase64URL, decodeBase64URL, base64ToArrayBuffer } from './encoding'
export { encrypt as encryptWithKey, decrypt as decryptWithKey } from './aes'

import { encodeBase64URL } from './encoding'

const PRF_SALT = 'devsesh-master-key-v1'

export function getPrfSalt(): Uint8Array {
  return new TextEncoder().encode(PRF_SALT)
}

export function getPrfSaltArrayBuffer(): ArrayBuffer {
  return getPrfSalt().buffer
}

export function getPrfSaltBase64(): string {
  return btoa(String.fromCharCode(...getPrfSalt()))
}

/**
 * Build the `prf` extension for a WebAuthn get() (assertion).
 *
 * When allowCredentials is non-empty we MUST use `evalByCredential` (keyed by
 * each credential's base64url id) rather than a bare `eval`. Safari/iOS returns
 * a PRF output for a bare `eval` + multiple allowCredentials that does NOT match
 * the per-credential value produced during enrollment, so unlocking the master
 * key fails with OperationError on the second/other passkeys (the "iPhone works
 * for login but not SSH" bug). Chrome tolerates a bare `eval`, which is why it
 * went unnoticed on desktop. Falls back to `eval` only for discoverable
 * (empty-allowCredentials) requests, where evalByCredential is not applicable.
 */
export function buildPrfGetExtension(
  allowCredentialIds: ArrayBuffer[],
  salt: ArrayBuffer
): { eval?: { first: ArrayBuffer }; evalByCredential?: Record<string, { first: ArrayBuffer }> } {
  if (allowCredentialIds.length > 0) {
    const evalByCredential: Record<string, { first: ArrayBuffer }> = {}
    for (const id of allowCredentialIds) {
      evalByCredential[encodeBase64URL(new Uint8Array(id))] = { first: salt }
    }
    return { evalByCredential }
  }
  return { eval: { first: salt } }
}

export async function deriveMasterKeyFromPrf(prfOutput: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'HKDF',
    false,
    ['deriveBits']
  )

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: getPrfSalt(),
      info: new TextEncoder().encode('master-key-derivation'),
    },
    keyMaterial,
    256
  )

  return new Uint8Array(bits)
}

export function generateMasterKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

// Master key format version:
// Version 1: AES-GCM encrypted (1 byte version + 12 byte nonce + ciphertext)
// Version 0 (plain) is NOT ALLOWED - PRF is required
const MASTER_KEY_VERSION_ENCRYPTED = 0x01

export function formatEncryptedMasterKey(encryptedData: Uint8Array): Uint8Array {
  // Master key MUST be encrypted (version 1 only)
  const result = new Uint8Array(1 + encryptedData.length)
  result[0] = MASTER_KEY_VERSION_ENCRYPTED
  result.set(encryptedData, 1)
  return result
}

export function parseEncryptedMasterKey(data: Uint8Array): { version: number; data: Uint8Array; isEncrypted: boolean } {
  if (!data || data.length === 0) {
    throw new Error('Empty master key data')
  }
  
  // Master key MUST be encrypted (version 1)
  // No plain master keys allowed
  
  // Check for version byte
  if (data.length < 1) {
    throw new Error('Master key data too short')
  }
  
  const version = data[0]
  const content = data.slice(1)
  
  if (version === MASTER_KEY_VERSION_ENCRYPTED) {
    return { version, data: content, isEncrypted: true }
  } else {
    // Version 0 (plain) or unknown version not allowed
    throw new Error('Invalid master key format')
  }
}
