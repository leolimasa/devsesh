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
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    keyMaterial,
    length * 8
  )

  return new Uint8Array(bits)
}