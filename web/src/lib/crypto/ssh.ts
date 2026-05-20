/**
 * SSH Key Utilities
 *
 * Functions for working with SSH keys in OpenSSH format.
 * Includes fingerprint computation and key formatting.
 */

/**
 * Computes SHA256 fingerprint of an Ed25519 public key in OpenSSH format.
 * Returns the fingerprint in SHA256:base64 format matching ssh-keygen output.
 * [req.0lpwy4]
 *
 * @param publicKeyBytes - The raw Ed25519 public key (32 bytes)
 * @returns Fingerprint in SHA256:base64 format (e.g., "SHA256:abc123...")
 */
export async function computeFingerprint(publicKeyBytes: Uint8Array): Promise<string> {
  // OpenSSH wire format for Ed25519 public key:
  // 4 bytes: length of key type string (big-endian)
  // key type string: "ssh-ed25519"
  // 4 bytes: length of public key (big-endian)
  // public key bytes (32 bytes for Ed25519)

  const wireFormat = formatOpenSSHWire(publicKeyBytes)

  const hashBuffer = await crypto.subtle.digest('SHA-256', wireFormat)
  const hashArray = new Uint8Array(hashBuffer)

  // Convert to base64 without padding (matching ssh-keygen format)
  const base64 = btoa(String.fromCharCode(...hashArray)).replace(/=+$/, '')

  return `SHA256:${base64}`
}

/**
 * Formats an Ed25519 public key in OpenSSH wire format.
 * This is the binary format used in authorized_keys files (before base64 encoding).
 *
 * @param publicKeyBytes - The raw Ed25519 public key (32 bytes)
 * @returns Wire format bytes
 */
export function formatOpenSSHWire(publicKeyBytes: Uint8Array): Uint8Array {
  const keyType = new TextEncoder().encode('ssh-ed25519')
  const keyTypeLen = new Uint8Array(4)
  new DataView(keyTypeLen.buffer).setUint32(0, keyType.length, false)

  const keyLen = new Uint8Array(4)
  new DataView(keyLen.buffer).setUint32(0, publicKeyBytes.length, false)

  const wireFormat = new Uint8Array(
    keyTypeLen.length + keyType.length + keyLen.length + publicKeyBytes.length
  )
  let offset = 0
  wireFormat.set(keyTypeLen, offset)
  offset += keyTypeLen.length
  wireFormat.set(keyType, offset)
  offset += keyType.length
  wireFormat.set(keyLen, offset)
  offset += keyLen.length
  wireFormat.set(publicKeyBytes, offset)

  return wireFormat
}

/**
 * Formats an Ed25519 public key in OpenSSH authorized_keys format.
 * The output can be used directly in ~/.ssh/authorized_keys or TrustedUserCAKeys.
 * [req.23hk63]
 *
 * @param publicKeyBytes - The raw Ed25519 public key (32 bytes)
 * @param comment - Optional comment to append (default: "devsesh-ca")
 * @returns OpenSSH format string (e.g., "ssh-ed25519 AAAA... comment")
 */
export function formatOpenSSHKey(publicKeyBytes: Uint8Array, comment = 'devsesh-ca'): string {
  const wireFormat = formatOpenSSHWire(publicKeyBytes)
  const base64 = btoa(String.fromCharCode(...wireFormat))
  return `ssh-ed25519 ${base64} ${comment}`
}
