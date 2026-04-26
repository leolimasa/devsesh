export { encodeBase64, decodeBase64, encodeBase64URL, decodeBase64URL, base64ToArrayBuffer } from './encoding'
export { encrypt as encryptWithKey, decrypt as decryptWithKey } from './aes'

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
    throw new Error(`Master key must be encrypted with PRF. Found version: ${version}`)
  }
}
