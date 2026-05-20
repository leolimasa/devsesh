/**
 * SSH CA TypeScript type definitions
 * Contains types for FROST key shares, signing sessions, and worker communication
 */

export interface FROSTShare {
  identifier: Uint8Array
  secretShare: Uint8Array
  groupPublicKey: Uint8Array
  verifyingShare: Uint8Array
}

export interface SigningSessionState {
  sessionId: string
  round: 'idle' | 'round1' | 'round2' | 'complete'
  commitment?: Uint8Array
  partialSignature?: Uint8Array
}

export type WorkerMessageType = 'init' | 'round1' | 'round2' | 'status' | 'terminate'

export interface WorkerMessage {
  type: WorkerMessageType
  payload?: unknown
}

export interface WorkerResponse {
  type: 'ready' | 'commitment' | 'partial_sig' | 'error' | 'terminated' | 'status'
  payload?: unknown
}

export interface InitPayload {
  share: Uint8Array
  groupPublicKey: Uint8Array
  verifyingShares: {
    server: Uint8Array
    client: Uint8Array
  }
  /** Optional timeout in milliseconds. Default is 30 minutes. [req.2k5is9] */
  timeoutMs?: number
}

export interface Round1Payload {
  message: Uint8Array
}

export interface Round2Payload {
  serverCommitment: Uint8Array
}

export interface StatusResponse {
  isActive: boolean
  remainingTime: number | null
  currentSession: SigningSessionState | null
}

export interface FROSTCommitment {
  hiding: Uint8Array
  binding: Uint8Array
}

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

export interface PartialSignature {
  challenge: Uint8Array
  response: Uint8Array
}

export interface CertificateResult {
  /** Base64-encoded signed SSH certificate */
  certificate: string
  /** Certificate serial number */
  serial: number
  /** Ed25519 ephemeral private key (32 bytes seed) used to sign SSH auth challenges */
  userPrivateKey: Uint8Array
  /** Ed25519 ephemeral public key (32 bytes) that was certified */
  userPublicKey: Uint8Array
}
