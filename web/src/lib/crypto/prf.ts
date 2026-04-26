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
