/**
 * FROST Web Worker
 *
 * Holds the client's FROST share in memory and performs signing operations.
 * The share is never accessible from the main thread, providing isolation
 * for sensitive cryptographic material.
 *
 * [req.qwdm15] - Main thread isolation: share only accessible within worker
 * [req.gvq1jj] - Memory-only storage: share never persisted to disk/IndexedDB
 * [req.xxu1i4] - PostMessage API: init, round1, round2, status, terminate
 * [req.obmwbr] - Memory zeroing: share zeroed on terminate
 * [req.2k5is9] - Inactivity timeout: 30 minutes (configurable)
 */

import {
  clientRound1,
  clientRound2,
  zeroMemory,
  type FrostSigningState,
} from '@/lib/crypto/frost'
import type {
  WorkerMessage,
  WorkerResponse,
  InitPayload,
  Round1Payload,
  Round2Payload,
  StatusResponse,
  SigningSessionState,
} from '@/types/sshca'

// Default inactivity timeout: 30 minutes
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Worker state - held in memory only, never persisted.
 * [req.qwdm15] [req.gvq1jj]
 */
interface WorkerState {
  // Client's FROST secret share (decrypted)
  share: Uint8Array | null
  // Group public key (CA public key)
  groupPublicKey: Uint8Array | null
  // Server's public verification share
  serverVerifyingShare: Uint8Array | null
  // Client's public verification share
  clientVerifyingShare: Uint8Array | null
  // Current signing session state
  signingState: FrostSigningState | null
  // Signing session metadata
  session: SigningSessionState | null
  // Inactivity timer handle
  inactivityTimer: ReturnType<typeof setTimeout> | null
  // Timestamp when the worker was initialized
  initTimestamp: number | null
  // Configured timeout in milliseconds
  timeoutMs: number
}

// Worker-local state - not accessible from main thread
const state: WorkerState = {
  share: null,
  groupPublicKey: null,
  serverVerifyingShare: null,
  clientVerifyingShare: null,
  signingState: null,
  session: null,
  inactivityTimer: null,
  initTimestamp: null,
  timeoutMs: DEFAULT_TIMEOUT_MS,
}

/**
 * Securely clears all sensitive data from memory.
 * [req.obmwbr]
 */
function clearState(): void {
  if (state.share) {
    zeroMemory(state.share)
    state.share = null
  }
  if (state.groupPublicKey) {
    zeroMemory(state.groupPublicKey)
    state.groupPublicKey = null
  }
  if (state.serverVerifyingShare) {
    zeroMemory(state.serverVerifyingShare)
    state.serverVerifyingShare = null
  }
  if (state.clientVerifyingShare) {
    zeroMemory(state.clientVerifyingShare)
    state.clientVerifyingShare = null
  }
  if (state.signingState) {
    // Clear nonces if present
    if (state.signingState.nonces) {
      zeroMemory(state.signingState.nonces.hiding)
      zeroMemory(state.signingState.nonces.binding)
    }
    state.signingState = null
  }
  state.session = null
  state.initTimestamp = null
  clearInactivityTimer()
}

/**
 * Clears the inactivity timer if set.
 */
function clearInactivityTimer(): void {
  if (state.inactivityTimer) {
    clearTimeout(state.inactivityTimer)
    state.inactivityTimer = null
  }
}

/**
 * Resets the inactivity timer. Called on each signing operation.
 * [req.2k5is9]
 */
function resetInactivityTimer(): void {
  clearInactivityTimer()
  state.initTimestamp = Date.now()
  state.inactivityTimer = setTimeout(() => {
    // Auto-terminate on inactivity
    handleTerminate()
  }, state.timeoutMs)
}

/**
 * Sends a response to the main thread.
 */
function postResponse(response: WorkerResponse): void {
  self.postMessage(response)
}

/**
 * Sends an error response to the main thread.
 */
function postError(message: string): void {
  postResponse({ type: 'error', payload: { message } })
}

/**
 * Handles the 'init' message - initializes the worker with the decrypted share.
 * [req.qwdm15] [req.gvq1jj]
 */
function handleInit(payload: InitPayload): void {
  // Clear any existing state
  clearState()

  // Validate payload
  if (!payload.share || !(payload.share instanceof Uint8Array)) {
    postError('Invalid share: must be Uint8Array')
    return
  }
  if (!payload.groupPublicKey || !(payload.groupPublicKey instanceof Uint8Array)) {
    postError('Invalid groupPublicKey: must be Uint8Array')
    return
  }
  if (!payload.verifyingShares?.server || !(payload.verifyingShares.server instanceof Uint8Array)) {
    postError('Invalid verifyingShares.server: must be Uint8Array')
    return
  }
  if (!payload.verifyingShares?.client || !(payload.verifyingShares.client instanceof Uint8Array)) {
    postError('Invalid verifyingShares.client: must be Uint8Array')
    return
  }

  // Store the share and keys
  state.share = new Uint8Array(payload.share)
  state.groupPublicKey = new Uint8Array(payload.groupPublicKey)
  state.serverVerifyingShare = new Uint8Array(payload.verifyingShares.server)
  state.clientVerifyingShare = new Uint8Array(payload.verifyingShares.client)

  // Initialize timeout from payload if provided, otherwise use default
  if (typeof payload.timeoutMs === 'number' && payload.timeoutMs > 0) {
    state.timeoutMs = payload.timeoutMs
  }

  // Start inactivity timer
  resetInactivityTimer()

  postResponse({ type: 'ready' })
}

/**
 * Handles the 'round1' message - generates nonces and commitment.
 * [req.5xcc6i] [req.ey98nq]
 */
function handleRound1(payload: Round1Payload): void {
  if (!state.share || !state.groupPublicKey || !state.serverVerifyingShare || !state.clientVerifyingShare) {
    postError('Worker not initialized')
    return
  }

  if (!payload.message || !(payload.message instanceof Uint8Array)) {
    postError('Invalid message: must be Uint8Array')
    return
  }

  // Reset inactivity timer on signing operation
  resetInactivityTimer()

  try {
    // Perform client's round 1
    const { commitment, state: signingState } = clientRound1(
      state.share,
      state.serverVerifyingShare,
      state.clientVerifyingShare,
      state.groupPublicKey,
      payload.message
    )

    // Store signing state for round 2
    state.signingState = signingState
    state.session = {
      sessionId: '',
      round: 'round1',
      commitment,
    }

    postResponse({
      type: 'commitment',
      payload: { commitment },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during round1'
    postError(message)
  }
}

/**
 * Handles the 'round2' message - computes partial signature.
 * [req.o3lf24]
 */
function handleRound2(payload: Round2Payload): void {
  if (!state.share || !state.groupPublicKey || !state.serverVerifyingShare || !state.clientVerifyingShare) {
    postError('Worker not initialized')
    return
  }

  if (!state.signingState) {
    postError('No active signing session (call round1 first)')
    return
  }

  if (!payload.serverCommitment || !(payload.serverCommitment instanceof Uint8Array)) {
    postError('Invalid serverCommitment: must be Uint8Array')
    return
  }

  // Reset inactivity timer on signing operation
  resetInactivityTimer()

  try {
    // Perform client's round 2
    const partialSignature = clientRound2(
      state.share,
      state.serverVerifyingShare,
      state.clientVerifyingShare,
      state.groupPublicKey,
      state.signingState,
      payload.serverCommitment
    )

    // Clear signing state after use (nonces are already zeroed by clientRound2)
    state.signingState = null
    if (state.session) {
      state.session.round = 'round2'
      state.session.partialSignature = partialSignature
    }

    postResponse({
      type: 'partial_sig',
      payload: { partialSignature },
    })

    // Reset session after successful round 2
    state.session = null
  } catch (err) {
    // Clear signing state on error
    state.signingState = null
    state.session = null
    const message = err instanceof Error ? err.message : 'Unknown error during round2'
    postError(message)
  }
}

/**
 * Handles the 'status' message - returns current worker state.
 * [req.35jehk]
 */
function handleStatus(): void {
  const isActive = state.share !== null
  let remainingTime: number | null = null

  if (isActive && state.initTimestamp !== null) {
    const elapsed = Date.now() - state.initTimestamp
    remainingTime = Math.max(0, state.timeoutMs - elapsed)
  }

  const response: StatusResponse = {
    isActive,
    remainingTime,
    currentSession: state.session ? { ...state.session } : null,
  }

  postResponse({ type: 'status', payload: response })
}

/**
 * Handles the 'terminate' message - clears all state and closes the worker.
 * [req.obmwbr]
 */
function handleTerminate(): void {
  clearState()
  postResponse({ type: 'terminated' })
  // Close the worker
  self.close()
}

/**
 * Main message handler.
 * [req.xxu1i4]
 */
self.onmessage = (event: MessageEvent<WorkerMessage>): void => {
  const { type, payload } = event.data

  switch (type) {
    case 'init':
      handleInit(payload as InitPayload)
      break
    case 'round1':
      handleRound1(payload as Round1Payload)
      break
    case 'round2':
      handleRound2(payload as Round2Payload)
      break
    case 'status':
      handleStatus()
      break
    case 'terminate':
      handleTerminate()
      break
    default:
      postError(`Unknown message type: ${type}`)
  }
}
