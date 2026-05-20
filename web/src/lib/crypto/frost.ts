/**
 * FROST Ed25519 Cryptographic Operations
 *
 * Implements client-side FROST threshold signing using @noble/curves.
 * Compatible with the bytemare/frost Go library used on the server.
 *
 * This module contains the core signing logic. Wire format encoding/decoding
 * is delegated to frost-encoding.ts for separation of concerns.
 */

import { ed25519_FROST, ed25519 } from '@noble/curves/ed25519.js'
import type { FrostNonces, FrostSigningState } from '@/types/sshca'
import {
  ED25519_GROUP_ID,
  SCALAR_SIZE,
  extractVerifyingKey,
  extractCommitments,
  encodeCommitment,
  buildCommitmentList,
  encodeSignatureShare,
} from './frost-encoding'
import { zeroMemory } from './memory'

// Re-export encoding functions for backward compatibility
export {
  ED25519_GROUP_ID,
  SCALAR_SIZE,
  ELEMENT_SIZE,
  deserializeShare,
  extractVerifyingKey,
  extractCommitments,
  decodeCommitment,
  encodeCommitment,
  decodeSignatureShare,
  buildCommitmentList,
} from './frost-encoding'

// Re-export types
export type { FrostNonces, FrostSigningState } from '@/types/sshca'

// Re-export memory utilities
export { zeroMemory } from './memory'

/**
 * Performs scalar multiplication with the Ed25519 base point.
 * Returns the compressed point encoding.
 */
function scalarMultiplyBase(scalar: Uint8Array): Uint8Array {
  // Ensure scalar is in correct format (32 bytes, little-endian)
  if (scalar.length !== SCALAR_SIZE) {
    throw new Error(`Invalid scalar length: ${scalar.length}`)
  }

  // Perform scalar multiplication with base point
  const point = ed25519.Point.BASE.multiply(bytesToScalar(scalar))

  // Return compressed encoding (32 bytes for Ed25519)
  return point.toBytes()
}

/**
 * Converts a little-endian byte array to a bigint scalar.
 */
function bytesToScalar(bytes: Uint8Array): bigint {
  let result = 0n
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i])
  }
  return result
}

/**
 * Generates fresh nonces for FROST signing round 1.
 * Nonces are cryptographically random and must never be reused.
 * [req.ey98nq]
 *
 * @param clientShare - Client's encoded key share from server
 * @param serverVerifyingShare - Server's public key share
 * @param clientVerifyingShare - Client's public key share
 * @returns Nonce pair and commitment information
 */
export function generateNonces(
  clientShare: Uint8Array,
  _serverVerifyingShare: Uint8Array,
  _clientVerifyingShare: Uint8Array
): {
  nonces: FrostNonces
  commitments: {
    identifier: string
    hiding: Uint8Array
    binding: Uint8Array
  }
  clientId: string
} {
  // bytemare/frost KeyShare encoding format (determined empirically):
  // - Byte 0: group ID (0x06 for Ed25519)
  // - Byte 1: participant identifier (1 or 2 for 2-of-2)
  // - Bytes 2+: other data (threshold info, public keys, commitments)
  // - Secret scalar at a later offset (around byte 103 for 167-byte shares)

  // Validate minimum length (167 bytes is the expected size for Ed25519 2-of-2)
  if (clientShare.length < 100) {
    throw new Error(`Invalid client share length: ${clientShare.length}`)
  }

  // Validate group identifier
  if (clientShare[0] !== ED25519_GROUP_ID) {
    throw new Error(`Invalid client share: group ID ${clientShare[0]}, expected ${ED25519_GROUP_ID}. Data may be corrupted or incorrectly decrypted.`)
  }

  // Read identifier directly from byte 1 (it's the participant ID, not a length)
  const clientIdNum = clientShare[1]

  // Validate identifier is a reasonable value (should be 1 or 2 for 2-of-2)
  if (clientIdNum <= 0 || clientIdNum > 2) {
    throw new Error(`Invalid client identifier: ${clientIdNum}. Expected 1 or 2 for 2-of-2 scheme.`)
  }

  // Client identifier for FROST protocol
  const clientId = ed25519_FROST.Identifier.fromNumber(clientIdNum)

  // The secret scalar is at offset 103 for a 167-byte share (determined empirically)
  // This is: group(1) + id(1) + other data(101) = 103
  const expectedScalarOffset = 103

  // Extract secret share scalar
  const signingShare = clientShare.slice(expectedScalarOffset, expectedScalarOffset + SCALAR_SIZE)
  if (signingShare.length < SCALAR_SIZE) {
    throw new Error(`Invalid secret share: expected ${SCALAR_SIZE} bytes, got ${signingShare.length}`)
  }

  // Create FROST secret in @noble/curves format
  const secret = {
    identifier: clientId,
    signingShare: signingShare,
  }

  // Generate commitment
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = ed25519_FROST.commit(secret) as any

  // Get the actual bytes from the result (TRet values may be functions or direct values)
  const hidingNonce = typeof result.nonces.hiding === 'function' ? result.nonces.hiding() : result.nonces.hiding
  const bindingNonce = typeof result.nonces.binding === 'function' ? result.nonces.binding() : result.nonces.binding
  const hidingCommit = typeof result.commitments.hiding === 'function' ? result.commitments.hiding() : result.commitments.hiding
  const bindingCommit = typeof result.commitments.binding === 'function' ? result.commitments.binding() : result.commitments.binding

  return {
    nonces: {
      hiding: hidingNonce as Uint8Array,
      binding: bindingNonce as Uint8Array,
    },
    commitments: {
      identifier: result.commitments.identifier,
      hiding: hidingCommit as Uint8Array,
      binding: bindingCommit as Uint8Array,
    },
    clientId,
  }
}

/**
 * Computes the commitment from nonces for round 1.
 * The commitment is sent to the server as proof of nonce generation.
 * [req.5xcc6i]
 *
 * @param identifier - Signer identifier (1-based for server, 2 for client)
 * @param nonces - The hiding and binding nonces
 * @returns Encoded commitment in bytemare/frost wire format
 */
export function computeCommitment(
  identifier: number,
  nonces: FrostNonces
): Uint8Array {
  // Compute commitment points from nonces
  // For Ed25519: commitment = nonce * G (base point multiplication)
  const hidingCommitment = scalarMultiplyBase(nonces.hiding)
  const bindingCommitment = scalarMultiplyBase(nonces.binding)

  return encodeCommitment(identifier, hidingCommitment, bindingCommitment)
}

/**
 * Computes a partial signature for round 2 of FROST signing.
 * [req.o3lf24]
 *
 * @param clientShare - Client's encoded key share
 * @param serverVerifyingShare - Server's public key share
 * @param clientVerifyingShare - Client's public key share
 * @param nonces - The nonces generated in round 1
 * @param commitmentList - All participants' commitments (sorted by signer ID)
 * @param message - The message being signed (certificate TBS data)
 * @param clientId - The client's identifier string
 * @returns Encoded partial signature in bytemare/frost wire format
 */
export function computePartialSignature(
  clientShare: Uint8Array,
  serverVerifyingShare: Uint8Array,
  clientVerifyingShare: Uint8Array,
  nonces: FrostNonces,
  commitmentList: Array<{
    identifier: string
    hiding: Uint8Array
    binding: Uint8Array
  }>,
  message: Uint8Array,
  clientId: string
): Uint8Array {
  // bytemare/frost KeyShare encoding format (same as generateNonces)
  // - Byte 0: group ID (0x06 for Ed25519)
  // - Byte 1: participant identifier (1 or 2 for 2-of-2)
  // - Secret scalar at offset 103 for 167-byte shares

  // Server is always participant 1, client is participant 2 in 2-of-2
  const serverId = ed25519_FROST.Identifier.fromNumber(1)

  // Extract secret share scalar (at fixed offset 103)
  const expectedScalarOffset = 103
  const signingShare = clientShare.slice(expectedScalarOffset, expectedScalarOffset + SCALAR_SIZE)

  // Extract verifying shares (public keys) from the PublicKeyShare format
  const serverVerifyingKey = extractVerifyingKey(serverVerifyingShare)
  const clientVerifyingKey = extractVerifyingKey(clientVerifyingShare)

  // Extract commitment polynomial from the verifying shares
  const commitments = extractCommitments(serverVerifyingShare, clientVerifyingShare)

  // Create FROST secret in @noble/curves format
  const secret = {
    identifier: clientId,
    signingShare: signingShare,
  }

  // Create FROST public config
  const pub = {
    signers: { min: 2, max: 2 },
    commitments: commitments,
    verifyingShares: {
      [serverId]: serverVerifyingKey,
      [clientId]: clientVerifyingKey,
    },
  }

  // Convert commitment list to the format expected by @noble/curves
  // Note: nonces are consumed (zeroed) by signShare
  const noncesForSign = {
    hiding: nonces.hiding,
    binding: nonces.binding,
  }

  // Call the FROST signShare function
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sigShare = ed25519_FROST.signShare(secret, pub, noncesForSign, commitmentList, message) as any

  // Get the actual bytes (TRet values may be functions or direct values)
  const sigShareBytes = typeof sigShare === 'function' ? sigShare() : sigShare

  // Read the numeric ID from byte 1 (it's the participant ID directly)
  const signerId = clientShare[1]

  return encodeSignatureShare(signerId, sigShareBytes as Uint8Array)
}

/**
 * High-level function to perform client's round 1 of FROST signing.
 * Generates nonces and returns commitment to send to server.
 *
 * @param clientShare - Client's encoded key share
 * @param serverVerifyingShare - Server's public key share
 * @param clientVerifyingShare - Client's public key share
 * @param _groupPublicKey - Group public key (32 bytes) - not used directly but kept for API consistency
 * @param message - Message to sign (TBS data)
 * @returns Encoded commitment and signing state for round 2
 */
export function clientRound1(
  clientShare: Uint8Array,
  serverVerifyingShare: Uint8Array,
  clientVerifyingShare: Uint8Array,
  _groupPublicKey: Uint8Array,
  message: Uint8Array
): {
  commitment: Uint8Array
  state: FrostSigningState
} {
  const { nonces, commitments, clientId } = generateNonces(
    clientShare,
    serverVerifyingShare,
    clientVerifyingShare
  )

  // Encode commitment in bytemare/frost format
  const commitment = encodeCommitment(
    2, // Client is always signer 2 in 2-of-2
    commitments.hiding,
    commitments.binding
  )

  return {
    commitment,
    state: {
      nonces,
      commitment,
      message,
      clientId,
    },
  }
}

/**
 * High-level function to perform client's round 2 of FROST signing.
 * Computes partial signature using server's commitment.
 *
 * @param clientShare - Client's encoded key share
 * @param serverVerifyingShare - Server's public key share
 * @param clientVerifyingShare - Client's public key share
 * @param _groupPublicKey - Group public key (32 bytes) - not used directly but kept for API consistency
 * @param state - Signing state from round 1
 * @param serverCommitment - Server's encoded commitment
 * @returns Encoded partial signature
 */
export function clientRound2(
  clientShare: Uint8Array,
  serverVerifyingShare: Uint8Array,
  clientVerifyingShare: Uint8Array,
  _groupPublicKey: Uint8Array,
  state: FrostSigningState,
  serverCommitment: Uint8Array
): Uint8Array {
  // Build commitment list from both parties
  const commitmentList = buildCommitmentList(serverCommitment, state.commitment)

  // Compute partial signature
  const partialSig = computePartialSignature(
    clientShare,
    serverVerifyingShare,
    clientVerifyingShare,
    state.nonces,
    commitmentList,
    state.message,
    state.clientId
  )

  // Zero nonces after use
  zeroMemory(state.nonces.hiding)
  zeroMemory(state.nonces.binding)

  return partialSig
}

// Re-export ed25519_FROST for use in tests
export { ed25519_FROST }
