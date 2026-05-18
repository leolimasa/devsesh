/**
 * FROST Ed25519 Cryptographic Operations
 *
 * Implements client-side FROST threshold signing using @noble/curves.
 * Compatible with the bytemare/frost Go library used on the server.
 *
 * Wire format for bytemare/frost compatibility:
 * - Commitment: 1 byte group + 8 bytes commitmentID + 2 bytes signerID + 32 bytes hiding + 32 bytes binding = 75 bytes
 * - SignatureShare: 1 byte group + 2 bytes signerID + 32 bytes share = 35 bytes
 * - PublicKeyShare: 1 byte group + 8 bytes ID + 32 bytes public key + commitment polynomial
 *
 * Note: Ed25519 group identifier in bytemare/frost is 0x06
 */

import { ed25519_FROST, ed25519 } from '@noble/curves/ed25519.js'
import type {
  FROSTShare,
  FROSTCommitment,
} from '@/types/sshca'

// Ed25519 group identifier used by bytemare/frost
const ED25519_GROUP_ID = 0x06

// Size constants for Ed25519
const SCALAR_SIZE = 32
const ELEMENT_SIZE = 32

/**
 * Nonce pair generated during round 1 of FROST signing.
 * Must be kept secret and never reused.
 */
export interface FrostNonces {
  hiding: Uint8Array
  binding: Uint8Array
}

/**
 * State maintained during a FROST signing session.
 * Contains the nonces generated in round 1 for use in round 2.
 */
export interface FrostSigningState {
  nonces: FrostNonces
  commitment: Uint8Array
  message: Uint8Array
  clientId: string
}

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
function extractVerifyingKey(publicKeyShare: Uint8Array): Uint8Array {
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
function extractCommitments(
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

// Note: readBigEndianInt was removed as the bytemare/frost encoding uses
// fixed-position fields rather than variable-length encoding

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
  //
  // The secret scalar position can be found by searching for the end of
  // the public key material (which is 32 bytes) plus additional structure.

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

  // The commitment format for bytemare/frost:
  // 1 byte: group ID (0x06 for Ed25519)
  // 8 bytes: commitment ID (little-endian uint64, usually 0 or session-specific)
  // 2 bytes: signer ID (little-endian uint16)
  // 32 bytes: hiding nonce commitment (point)
  // 32 bytes: binding nonce commitment (point)

  const commitment = new Uint8Array(1 + 8 + 2 + ELEMENT_SIZE + ELEMENT_SIZE)
  let offset = 0

  // Group ID
  commitment[offset++] = ED25519_GROUP_ID

  // Commitment ID (8 bytes, set to 0)
  offset += 8 // Already zeroed

  // Signer ID (2 bytes, little-endian)
  commitment[offset++] = identifier & 0xff
  commitment[offset++] = (identifier >> 8) & 0xff

  // Compute hiding commitment point: hiding_nonce * G
  const hidingCommitment = scalarMultiplyBase(nonces.hiding)
  commitment.set(hidingCommitment, offset)
  offset += ELEMENT_SIZE

  // Compute binding commitment point: binding_nonce * G
  const bindingCommitment = scalarMultiplyBase(nonces.binding)
  commitment.set(bindingCommitment, offset)

  return commitment
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

  // Encode in bytemare/frost format:
  // 1 byte: group ID
  // 2 bytes: signer ID (little-endian uint16)
  // 32 bytes: signature share scalar

  // Read the numeric ID from byte 1 (it's the participant ID directly)
  const signerId = clientShare[1]

  const encoded = new Uint8Array(1 + 2 + SCALAR_SIZE)
  encoded[0] = ED25519_GROUP_ID
  encoded[1] = signerId & 0xff
  encoded[2] = (signerId >> 8) & 0xff
  encoded.set(sigShareBytes as Uint8Array, 3)

  return encoded
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
 * Securely zeroes a byte array to clear sensitive data from memory.
 * [req.obmwbr]
 *
 * @param data - The byte array to zero
 */
export function zeroMemory(data: Uint8Array): void {
  data.fill(0)
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
