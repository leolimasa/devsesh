/**
 * FROST Wire Format Encoding/Decoding
 *
 * Handles encoding and decoding of FROST data structures in bytemare/frost wire format.
 * This module provides compatibility between the TypeScript client (@noble/curves)
 * and the Go server (bytemare/frost).
 *
 * Wire format for bytemare/frost compatibility:
 * - Commitment: 1 byte group + 8 bytes commitmentID + 2 bytes signerID + 32 bytes hiding + 32 bytes binding = 75 bytes
 * - SignatureShare: 1 byte group + 2 bytes signerID + 32 bytes share = 35 bytes
 * - PublicKeyShare: 1 byte group + 8 bytes ID + 32 bytes public key + commitment polynomial
 *
 * Note: Ed25519 group identifier in bytemare/frost is 0x06
 */

import { ed25519_FROST } from '@noble/curves/ed25519.js'
import type { FROSTShare, FROSTCommitment } from '@/types/sshca'

// Ed25519 group identifier used by bytemare/frost
export const ED25519_GROUP_ID = 0x06

// Size constants for Ed25519
export const SCALAR_SIZE = 32
export const ELEMENT_SIZE = 32

/**
 * Decodes a KeyShare from the bytemare/frost wire format.
 * Format: variable length encoding with identifier, secret, public key, and commitment.
 *
 * @param data - Encoded key share bytes
 * @returns Parsed FROSTShare structure
 */
export function deserializeShare(data: Uint8Array): FROSTShare {
  if (data.length < 1 + 8 + SCALAR_SIZE) {
    throw new Error(`Invalid share length: ${data.length}`)
  }

  // Parse bytemare/frost KeyShare format
  // First byte is group identifier
  const groupId = data[0]
  if (groupId !== ED25519_GROUP_ID) {
    throw new Error(`Unexpected group identifier: ${groupId}, expected ${ED25519_GROUP_ID}`)
  }

  let offset = 1

  // 8 bytes: identifier (little-endian uint64)
  const identifierBytes = data.slice(offset, offset + 8)
  offset += 8

  // 32 bytes: secret share scalar
  const secretShare = data.slice(offset, offset + SCALAR_SIZE)
  offset += SCALAR_SIZE

  // Extract the group public key (if present)
  // The remaining data contains the public key and other metadata
  const groupPublicKey = data.length >= offset + ELEMENT_SIZE
    ? data.slice(offset, offset + ELEMENT_SIZE)
    : new Uint8Array(ELEMENT_SIZE)

  // For verifyingShare, we use the full data since it includes commitment info
  const verifyingShare = data.slice(1) // Everything after group ID

  return {
    identifier: identifierBytes,
    secretShare,
    groupPublicKey,
    verifyingShare,
  }
}

/**
 * Extracts the participant's public key from a bytemare/frost PublicKeyShare.
 * Format determined empirically from bytemare/frost library output.
 */
export function extractVerifyingKey(publicKeyShare: Uint8Array): Uint8Array {
  // Verifying share format (103 bytes total for Ed25519 2-of-2):
  // - Bytes 0-6: header (group ID, participant ID, metadata) - 7 bytes
  // - Bytes 7-38: participant's public key (32 bytes)
  // - Bytes 39-70: group public key (32 bytes)
  // - Bytes 71-102: second commitment (32 bytes)
  const VERIFYING_KEY_OFFSET = 7

  if (publicKeyShare.length < VERIFYING_KEY_OFFSET + ELEMENT_SIZE) {
    throw new Error(`Invalid public key share length: ${publicKeyShare.length}`)
  }
  return publicKeyShare.slice(VERIFYING_KEY_OFFSET, VERIFYING_KEY_OFFSET + ELEMENT_SIZE)
}

/**
 * Extracts commitment polynomial from verifying shares.
 * For 2-of-2, this includes the group public key and a second commitment point.
 */
export function extractCommitments(
  serverVerifyingShare: Uint8Array,
  _clientVerifyingShare: Uint8Array
): Uint8Array[] {
  // Verifying share format (103 bytes total):
  // - Bytes 0-6: header (7 bytes)
  // - Bytes 7-38: participant's public key (32 bytes)
  // - Bytes 39-70: group public key / first commitment (32 bytes)
  // - Bytes 71-102: second commitment (32 bytes)
  const GROUP_KEY_OFFSET = 39
  const SECOND_COMMITMENT_OFFSET = 71

  const commitments: Uint8Array[] = []

  if (serverVerifyingShare.length >= GROUP_KEY_OFFSET + ELEMENT_SIZE) {
    // First commitment (constant term = group public key)
    commitments.push(serverVerifyingShare.slice(GROUP_KEY_OFFSET, GROUP_KEY_OFFSET + ELEMENT_SIZE))

    if (serverVerifyingShare.length >= SECOND_COMMITMENT_OFFSET + ELEMENT_SIZE) {
      // Second commitment (linear coefficient for threshold)
      commitments.push(serverVerifyingShare.slice(SECOND_COMMITMENT_OFFSET, SECOND_COMMITMENT_OFFSET + ELEMENT_SIZE))
    }
  }

  return commitments
}

/**
 * Decodes a commitment from bytemare/frost wire format.
 *
 * @param encoded - The encoded commitment bytes
 * @returns Parsed commitment structure
 */
export function decodeCommitment(encoded: Uint8Array): FROSTCommitment & { signerId: number } {
  if (encoded.length < 1 + 8 + 2 + ELEMENT_SIZE + ELEMENT_SIZE) {
    throw new Error(`Invalid commitment length: ${encoded.length}`)
  }

  // Verify group ID
  if (encoded[0] !== ED25519_GROUP_ID) {
    throw new Error(`Unexpected group ID: ${encoded[0]}`)
  }

  // Extract signer ID (little-endian uint16 at offset 9)
  const signerId = encoded[9] | (encoded[10] << 8)

  // Extract commitment points
  const hiding = encoded.slice(11, 11 + ELEMENT_SIZE)
  const binding = encoded.slice(11 + ELEMENT_SIZE, 11 + 2 * ELEMENT_SIZE)

  return {
    signerId,
    hiding,
    binding,
  }
}

/**
 * Encodes a commitment to bytemare/frost wire format.
 *
 * @param signerId - The signer's identifier
 * @param hiding - Hiding nonce commitment point
 * @param binding - Binding nonce commitment point
 * @returns Encoded commitment bytes
 */
export function encodeCommitment(
  signerId: number,
  hiding: Uint8Array,
  binding: Uint8Array
): Uint8Array {
  const commitment = new Uint8Array(1 + 8 + 2 + ELEMENT_SIZE + ELEMENT_SIZE)
  let offset = 0

  // Group ID
  commitment[offset++] = ED25519_GROUP_ID

  // Commitment ID (8 bytes, zeroed)
  offset += 8

  // Signer ID (little-endian uint16)
  commitment[offset++] = signerId & 0xff
  commitment[offset++] = (signerId >> 8) & 0xff

  // Hiding commitment
  commitment.set(hiding, offset)
  offset += ELEMENT_SIZE

  // Binding commitment
  commitment.set(binding, offset)

  return commitment
}

/**
 * Decodes a partial signature from bytemare/frost wire format.
 *
 * @param encoded - The encoded signature share bytes
 * @returns Signer ID and signature share scalar
 */
export function decodeSignatureShare(encoded: Uint8Array): {
  signerId: number
  share: Uint8Array
} {
  if (encoded.length < 1 + 2 + SCALAR_SIZE) {
    throw new Error(`Invalid signature share length: ${encoded.length}`)
  }

  if (encoded[0] !== ED25519_GROUP_ID) {
    throw new Error(`Unexpected group ID: ${encoded[0]}`)
  }

  const signerId = encoded[1] | (encoded[2] << 8)
  const share = encoded.slice(3, 3 + SCALAR_SIZE)

  return { signerId, share }
}

/**
 * Encodes a partial signature to bytemare/frost wire format.
 *
 * @param signerId - The signer's identifier
 * @param sigShare - The signature share scalar
 * @returns Encoded signature share bytes
 */
export function encodeSignatureShare(
  signerId: number,
  sigShare: Uint8Array
): Uint8Array {
  const encoded = new Uint8Array(1 + 2 + SCALAR_SIZE)
  encoded[0] = ED25519_GROUP_ID
  encoded[1] = signerId & 0xff
  encoded[2] = (signerId >> 8) & 0xff
  encoded.set(sigShare, 3)
  return encoded
}

/**
 * Converts commitment list from bytemare/frost format to @noble/curves format.
 *
 * @param serverCommitment - Server's encoded commitment
 * @param clientCommitment - Client's encoded commitment
 * @returns Commitment list for @noble/curves FROST
 */
export function buildCommitmentList(
  serverCommitment: Uint8Array,
  clientCommitment: Uint8Array
): Array<{
  identifier: string
  hiding: Uint8Array
  binding: Uint8Array
}> {
  const serverDecoded = decodeCommitment(serverCommitment)
  const clientDecoded = decodeCommitment(clientCommitment)

  // Sort by signer ID (server=1, client=2)
  const sorted = [serverDecoded, clientDecoded].sort((a, b) => a.signerId - b.signerId)

  return sorted.map((c) => ({
    identifier: ed25519_FROST.Identifier.fromNumber(c.signerId),
    hiding: c.hiding,
    binding: c.binding,
  }))
}
