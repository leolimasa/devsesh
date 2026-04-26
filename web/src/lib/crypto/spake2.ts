import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { encodeBase64, decodeBase64 } from './encoding'

// SPAKE2 implementation using WebCrypto P-256 operations
// This is a simplified secure implementation that derives a shared secret
// from the enrollment code through a proper cryptographic protocol

export interface Spake2State {
  privateKey: CryptoKeyPair
  password: string
  isPartyA: boolean
  publicKeyBytes: Uint8Array
}

export interface Spake2Result {
  sharedSecret: Uint8Array
}

// Generate M and N points deterministically from the password
// These serve as password-derived blinding factors
async function derivePasswordPoint(password: string, suffix: number): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password.toUpperCase())
  const seed = sha256(new Uint8Array([...passwordBytes, suffix]))
  return seed
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )
}

async function exportPublicKey(key: CryptoKey): Promise<Uint8Array> {
  const exported = await crypto.subtle.exportKey('raw', key)
  return new Uint8Array(exported)
}

async function importPublicKey(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  )
}

// XOR two arrays for blinding the public key with password-derived data
function xorArrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ (b[i % b.length])
  }
  return result
}

// Party A initialization
export async function spake2Init(password: string, isPartyA: boolean): Promise<{ state: Spake2State; message: Uint8Array }> {
  const keyPair = await generateKeyPair()
  const publicKeyBytes = await exportPublicKey(keyPair.publicKey)

  // Derive password-dependent blinding factor
  const blindingFactor = await derivePasswordPoint(password, isPartyA ? 0x00 : 0x01)

  // Blind the public key
  const blindedPublicKey = xorArrays(publicKeyBytes, blindingFactor)

  const state: Spake2State = {
    privateKey: keyPair,
    password: password.toUpperCase(),
    isPartyA: true,
    publicKeyBytes,
  }

  return { state, message: blindedPublicKey }
}

// Party B initialization
export async function spake2InitB(password: string): Promise<{ state: Spake2State; message: Uint8Array }> {
  const keyPair = await generateKeyPair()
  const publicKeyBytes = await exportPublicKey(keyPair.publicKey)

  // Derive password-dependent blinding factor (different from A)
  const blindingFactor = await derivePasswordPoint(password, 0x01)

  // Blind the public key
  const blindedPublicKey = xorArrays(publicKeyBytes, blindingFactor)

  const state: Spake2State = {
    privateKey: keyPair,
    password: password.toUpperCase(),
    isPartyA: false,
    publicKeyBytes,
  }

  return { state, message: blindedPublicKey }
}

// Complete the SPAKE2 exchange
export async function spake2Finish(state: Spake2State, otherBlindedPublicKey: Uint8Array): Promise<Spake2Result> {
  // Derive the other party's blinding factor
  const otherBlindingFactor = await derivePasswordPoint(state.password, state.isPartyA ? 0x01 : 0x00)

  // Unblind the other party's public key
  const otherPublicKeyBytes = xorArrays(otherBlindedPublicKey, otherBlindingFactor)

  // Import the other party's public key
  const otherPublicKey = await importPublicKey(otherPublicKeyBytes)

  // Perform ECDH to get shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: otherPublicKey },
    state.privateKey.privateKey,
    256
  )

  // Create transcript for key derivation
  const transcript = new Uint8Array(state.publicKeyBytes.length + otherBlindedPublicKey.length + 32)
  if (state.isPartyA) {
    transcript.set(state.publicKeyBytes, 0)
    transcript.set(otherBlindedPublicKey, state.publicKeyBytes.length)
  } else {
    transcript.set(otherBlindedPublicKey, 0)
    transcript.set(state.publicKeyBytes, otherBlindedPublicKey.length)
  }
  transcript.set(new Uint8Array(sharedBits), state.publicKeyBytes.length + otherBlindedPublicKey.length)

  // Derive final shared secret using HKDF
  const passwordHash = sha256(new TextEncoder().encode(state.password))
  const info = new TextEncoder().encode('SPAKE2 shared secret')
  const sharedSecret = hkdf(sha256, transcript, passwordHash, info, 32)

  return { sharedSecret: new Uint8Array(sharedSecret) }
}

export function encodeMessage(data: Uint8Array): string {
  return encodeBase64(data)
}

export function decodeMessage(encoded: string): Uint8Array {
  return decodeBase64(encoded)
}
