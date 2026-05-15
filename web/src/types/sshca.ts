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
}

export interface Round1Payload {
  message: Uint8Array
  clientCommitment: Uint8Array
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

export interface PartialSignature {
  challenge: Uint8Array
  response: Uint8Array
}

export interface CertificateResult {
  certificate: string
  serial: number
}