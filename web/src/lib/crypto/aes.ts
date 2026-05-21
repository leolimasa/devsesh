export interface EncryptResult {
  nonce: Uint8Array
  ciphertext: Uint8Array
}

export async function encrypt(
  key: Uint8Array,
  plaintext: Uint8Array
): Promise<EncryptResult> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))

  const aesKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  )

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    plaintext
  )

  return {
    nonce,
    ciphertext: new Uint8Array(ciphertext),
  }
}

export async function decrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  const aesKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    ciphertext
  )

  return new Uint8Array(plaintext)
}

// Salt for HKDF key derivation in passkey enrollment flow
const ENROLLMENT_HKDF_SALT = new TextEncoder().encode('devsesh-enrollment-v1')

/**
 * Derives a key from a shared secret using HKDF.
 * Used in the SPAKE2 passkey enrollment flow to derive encryption keys.
 *
 * @param sharedSecret - The shared secret (e.g., from SPAKE2)
 * @param info - Context-specific info string for domain separation
 * @param length - Desired key length in bytes (default: 32)
 * @returns Derived key bytes
 */
export async function deriveKey(
  sharedSecret: Uint8Array,
  info: string,
  length: number = 32
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    'HKDF',
    false,
    ['deriveBits']
  )

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: ENROLLMENT_HKDF_SALT,
      info: new TextEncoder().encode(info),
    },
    keyMaterial,
    length * 8
  )

  return new Uint8Array(bits)
}