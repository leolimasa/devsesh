/**
 * Tests for FROST Web Worker functionality.
 *
 * Note: Web workers don't work in jsdom environment, so we test the worker
 * functions in isolation by simulating the message passing behavior.
 * The actual worker bundling is verified by the build process.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  WorkerMessage,
  WorkerResponse,
  InitPayload,
  Round1Payload,
  Round2Payload,
  StatusResponse,
} from '@/types/sshca'

// Mock the crypto module since it's complex and tested separately
vi.mock('@/lib/crypto/frost', () => ({
  clientRound1: vi.fn(() => ({
    commitment: new Uint8Array([1, 2, 3, 4]),
    state: {
      nonces: {
        hiding: new Uint8Array(32),
        binding: new Uint8Array(32),
      },
      commitment: new Uint8Array([1, 2, 3, 4]),
      message: new Uint8Array([5, 6, 7, 8]),
      clientId: 'test-client',
    },
  })),
  clientRound2: vi.fn(() => new Uint8Array([9, 10, 11, 12])),
  zeroMemory: vi.fn((arr: Uint8Array) => arr.fill(0)),
}))

// Simulate worker state and handlers for testing
// This mirrors the actual worker implementation
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

interface WorkerState {
  share: Uint8Array | null
  groupPublicKey: Uint8Array | null
  serverVerifyingShare: Uint8Array | null
  clientVerifyingShare: Uint8Array | null
  signingState: ReturnType<typeof import('@/lib/crypto/frost').clientRound1>['state'] | null
  session: { sessionId: string; round: string; commitment?: Uint8Array; partialSignature?: Uint8Array } | null
  inactivityTimer: ReturnType<typeof setTimeout> | null
  initTimestamp: number | null
  timeoutMs: number
}

function createWorkerSimulator() {
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

  const responses: WorkerResponse[] = []
  let terminated = false

  const postResponse = (response: WorkerResponse) => {
    responses.push(response)
  }

  const postError = (message: string) => {
    postResponse({ type: 'error', payload: { message } })
  }

  const clearState = () => {
    if (state.share) state.share.fill(0)
    state.share = null
    if (state.groupPublicKey) state.groupPublicKey.fill(0)
    state.groupPublicKey = null
    if (state.serverVerifyingShare) state.serverVerifyingShare.fill(0)
    state.serverVerifyingShare = null
    if (state.clientVerifyingShare) state.clientVerifyingShare.fill(0)
    state.clientVerifyingShare = null
    state.signingState = null
    state.session = null
    state.initTimestamp = null
    if (state.inactivityTimer) {
      clearTimeout(state.inactivityTimer)
      state.inactivityTimer = null
    }
  }

  const resetInactivityTimer = () => {
    if (state.inactivityTimer) {
      clearTimeout(state.inactivityTimer)
    }
    state.initTimestamp = Date.now()
    state.inactivityTimer = setTimeout(() => {
      handleMessage({ type: 'terminate' })
    }, state.timeoutMs)
  }

  const handleMessage = async (msg: WorkerMessage) => {
    const { clientRound1, clientRound2 } = await import('@/lib/crypto/frost')

    switch (msg.type) {
      case 'init': {
        const payload = msg.payload as InitPayload
        clearState()

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

        state.share = new Uint8Array(payload.share)
        state.groupPublicKey = new Uint8Array(payload.groupPublicKey)
        state.serverVerifyingShare = new Uint8Array(payload.verifyingShares.server)
        state.clientVerifyingShare = new Uint8Array(payload.verifyingShares.client)

        const timeoutMs = (payload as InitPayload & { timeoutMs?: number }).timeoutMs
        if (typeof timeoutMs === 'number' && timeoutMs > 0) {
          state.timeoutMs = timeoutMs
        }

        resetInactivityTimer()
        postResponse({ type: 'ready' })
        break
      }

      case 'round1': {
        const payload = msg.payload as Round1Payload
        if (!state.share || !state.groupPublicKey || !state.serverVerifyingShare || !state.clientVerifyingShare) {
          postError('Worker not initialized')
          return
        }

        if (!payload.message || !(payload.message instanceof Uint8Array)) {
          postError('Invalid message: must be Uint8Array')
          return
        }

        resetInactivityTimer()

        try {
          const { commitment, state: signingState } = clientRound1(
            state.share,
            state.serverVerifyingShare,
            state.clientVerifyingShare,
            state.groupPublicKey,
            payload.message
          )

          state.signingState = signingState
          state.session = {
            sessionId: '',
            round: 'round1',
            commitment,
          }

          postResponse({ type: 'commitment', payload: { commitment } })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error during round1'
          postError(message)
        }
        break
      }

      case 'round2': {
        const payload = msg.payload as Round2Payload
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

        resetInactivityTimer()

        try {
          const partialSignature = clientRound2(
            state.share,
            state.serverVerifyingShare,
            state.clientVerifyingShare,
            state.groupPublicKey,
            state.signingState,
            payload.serverCommitment
          )

          state.signingState = null
          if (state.session) {
            state.session.round = 'round2'
            state.session.partialSignature = partialSignature
          }

          postResponse({ type: 'partial_sig', payload: { partialSignature } })
          state.session = null
        } catch (err) {
          state.signingState = null
          state.session = null
          const message = err instanceof Error ? err.message : 'Unknown error during round2'
          postError(message)
        }
        break
      }

      case 'status': {
        const isActive = state.share !== null
        let remainingTime: number | null = null

        if (isActive && state.initTimestamp !== null) {
          const elapsed = Date.now() - state.initTimestamp
          remainingTime = Math.max(0, state.timeoutMs - elapsed)
        }

        const response: StatusResponse = {
          isActive,
          remainingTime,
          currentSession: state.session ? { ...state.session, round: state.session.round as 'idle' | 'round1' | 'round2' | 'complete' } : null,
        }

        postResponse({ type: 'status', payload: response })
        break
      }

      case 'terminate': {
        clearState()
        postResponse({ type: 'terminated' })
        terminated = true
        break
      }

      default:
        postError(`Unknown message type: ${msg.type}`)
    }
  }

  return {
    handleMessage,
    getResponses: () => responses,
    getLastResponse: () => responses[responses.length - 1],
    clearResponses: () => { responses.length = 0 },
    isTerminated: () => terminated,
    getState: () => state,
  }
}

describe('FROST Worker', () => {
  let worker: ReturnType<typeof createWorkerSimulator>

  beforeEach(() => {
    worker = createWorkerSimulator()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('init', () => {
    it('initializes with valid payload', async () => {
      const payload: InitPayload = {
        share: new Uint8Array(100).fill(1),
        groupPublicKey: new Uint8Array(32).fill(2),
        verifyingShares: {
          server: new Uint8Array(100).fill(3),
          client: new Uint8Array(100).fill(4),
        },
      }

      await worker.handleMessage({ type: 'init', payload })

      const response = worker.getLastResponse()
      expect(response.type).toBe('ready')
    })

    it('rejects invalid share', async () => {
      const payload = {
        share: null,
        groupPublicKey: new Uint8Array(32),
        verifyingShares: {
          server: new Uint8Array(100),
          client: new Uint8Array(100),
        },
      } as unknown as InitPayload

      await worker.handleMessage({ type: 'init', payload })

      const response = worker.getLastResponse()
      expect(response.type).toBe('error')
      expect((response.payload as { message: string }).message).toContain('Invalid share')
    })

    it('rejects invalid groupPublicKey', async () => {
      const payload = {
        share: new Uint8Array(100),
        groupPublicKey: null,
        verifyingShares: {
          server: new Uint8Array(100),
          client: new Uint8Array(100),
        },
      } as unknown as InitPayload

      await worker.handleMessage({ type: 'init', payload })

      const response = worker.getLastResponse()
      expect(response.type).toBe('error')
      expect((response.payload as { message: string }).message).toContain('Invalid groupPublicKey')
    })

    it('accepts custom timeout', async () => {
      const customTimeout = 5 * 60 * 1000 // 5 minutes
      const payload: InitPayload & { timeoutMs: number } = {
        share: new Uint8Array(100).fill(1),
        groupPublicKey: new Uint8Array(32).fill(2),
        verifyingShares: {
          server: new Uint8Array(100).fill(3),
          client: new Uint8Array(100).fill(4),
        },
        timeoutMs: customTimeout,
      }

      await worker.handleMessage({ type: 'init', payload })

      expect(worker.getState().timeoutMs).toBe(customTimeout)
    })
  })

  describe('status', () => {
    it('returns inactive status when not initialized', async () => {
      await worker.handleMessage({ type: 'status' })

      const response = worker.getLastResponse()
      expect(response.type).toBe('status')
      const payload = response.payload as StatusResponse
      expect(payload.isActive).toBe(false)
      expect(payload.remainingTime).toBeNull()
    })

    it('returns active status with remaining time after init', async () => {
      const initPayload: InitPayload = {
        share: new Uint8Array(100).fill(1),
        groupPublicKey: new Uint8Array(32).fill(2),
        verifyingShares: {
          server: new Uint8Array(100).fill(3),
          client: new Uint8Array(100).fill(4),
        },
      }

      await worker.handleMessage({ type: 'init', payload: initPayload })
      worker.clearResponses()

      // Advance time a bit
      vi.advanceTimersByTime(5000)

      await worker.handleMessage({ type: 'status' })

      const response = worker.getLastResponse()
      expect(response.type).toBe('status')
      const payload = response.payload as StatusResponse
      expect(payload.isActive).toBe(true)
      expect(payload.remainingTime).toBeLessThan(DEFAULT_TIMEOUT_MS)
      expect(payload.remainingTime).toBeGreaterThan(0)
    })
  })

  describe('round1', () => {
    it('rejects when not initialized', async () => {
      await worker.handleMessage({
        type: 'round1',
        payload: { message: new Uint8Array([1, 2, 3]) } as Round1Payload,
      })

      const response = worker.getLastResponse()
      expect(response.type).toBe('error')
      expect((response.payload as { message: string }).message).toContain('not initialized')
    })

    it('generates commitment when initialized', async () => {
      // Initialize first
      const initPayload: InitPayload = {
        share: new Uint8Array(100).fill(1),
        groupPublicKey: new Uint8Array(32).fill(2),
        verifyingShares: {
          server: new Uint8Array(100).fill(3),
          client: new Uint8Array(100).fill(4),
        },
      }
      await worker.handleMessage({ type: 'init', payload: initPayload })
      worker.clearResponses()

      // Round 1
      await worker.handleMessage({
        type: 'round1',
        payload: { message: new Uint8Array([1, 2, 3, 4]) } as Round1Payload,
      })

      const response = worker.getLastResponse()
      expect(response.type).toBe('commitment')
      expect((response.payload as { commitment: Uint8Array }).commitment).toBeInstanceOf(Uint8Array)
    })

    it('rejects invalid message', async () => {
      // Initialize first
      const initPayload: InitPayload = {
        share: new Uint8Array(100).fill(1),
        groupPublicKey: new Uint8Array(32).fill(2),
        verifyingShares: {
          server: new Uint8Array(100).fill(3),
          client: new Uint8Array(100).fill(4),
        },
      }
      await worker.handleMessage({ type: 'init', payload: initPayload })
      worker.clearResponses()

      // Round 1 with invalid message
      await worker.handleMessage({
        type: 'round1',
        payload: { message: null } as unknown as Round1Payload,
      })

      const response = worker.getLastResponse()
      expect(response.type).toBe('error')
      expect((response.payload as { message: string }).message).toContain('Invalid message')
    })
  })

  describe('round2', () => {
    it('rejects when not initialized', async () => {
      await worker.handleMessage({
        type: 'round2',
        payload: { serverCommitment: new Uint8Array([1, 2, 3]) } as Round2Payload,
      })

      const response = worker.getLastResponse()
      expect(response.type).toBe('error')
      expect((response.payload as { message: string }).message).toContain('not initialized')
    })

    it('rejects when no signing session', async () => {
      // Initialize first
      const initPayload: InitPayload = {
        share: new Uint8Array(100).fill(1),
        groupPublicKey: new Uint8Array(32).fill(2),
        verifyingShares: {
          server: new Uint8Array(100).fill(3),
          client: new Uint8Array(100).fill(4),
        },
      }
      await worker.handleMessage({ type: 'init', payload: initPayload })
      worker.clearResponses()

      // Try round 2 without round 1
      await worker.handleMessage({
        type: 'round2',
        payload: { serverCommitment: new Uint8Array([1, 2, 3]) } as Round2Payload,
      })

      const response = worker.getLastResponse()
      expect(response.type).toBe('error')
      expect((response.payload as { message: string }).message).toContain('No active signing session')
    })

    it('computes partial signature after round1', async () => {
      // Initialize first
      const initPayload: InitPayload = {
        share: new Uint8Array(100).fill(1),
        groupPublicKey: new Uint8Array(32).fill(2),
        verifyingShares: {
          server: new Uint8Array(100).fill(3),
          client: new Uint8Array(100).fill(4),
        },
      }
      await worker.handleMessage({ type: 'init', payload: initPayload })

      // Round 1
      await worker.handleMessage({
        type: 'round1',
        payload: { message: new Uint8Array([1, 2, 3, 4]) } as Round1Payload,
      })
      worker.clearResponses()

      // Round 2
      await worker.handleMessage({
        type: 'round2',
        payload: { serverCommitment: new Uint8Array(75).fill(6) } as Round2Payload,
      })

      const response = worker.getLastResponse()
      expect(response.type).toBe('partial_sig')
      expect((response.payload as { partialSignature: Uint8Array }).partialSignature).toBeInstanceOf(Uint8Array)
    })
  })

  describe('terminate', () => {
    it('terminates and clears state', async () => {
      // Initialize first
      const initPayload: InitPayload = {
        share: new Uint8Array(100).fill(1),
        groupPublicKey: new Uint8Array(32).fill(2),
        verifyingShares: {
          server: new Uint8Array(100).fill(3),
          client: new Uint8Array(100).fill(4),
        },
      }
      await worker.handleMessage({ type: 'init', payload: initPayload })
      worker.clearResponses()

      // Terminate
      await worker.handleMessage({ type: 'terminate' })

      const response = worker.getLastResponse()
      expect(response.type).toBe('terminated')
      expect(worker.isTerminated()).toBe(true)

      // State should be cleared
      const state = worker.getState()
      expect(state.share).toBeNull()
      expect(state.groupPublicKey).toBeNull()
    })
  })

  describe('inactivity timeout', () => {
    it('auto-terminates after timeout', async () => {
      // Initialize with short timeout
      const shortTimeout = 1000 // 1 second
      const initPayload: InitPayload & { timeoutMs: number } = {
        share: new Uint8Array(100).fill(1),
        groupPublicKey: new Uint8Array(32).fill(2),
        verifyingShares: {
          server: new Uint8Array(100).fill(3),
          client: new Uint8Array(100).fill(4),
        },
        timeoutMs: shortTimeout,
      }
      await worker.handleMessage({ type: 'init', payload: initPayload })
      worker.clearResponses()

      // Advance past timeout and run pending timers
      await vi.advanceTimersByTimeAsync(shortTimeout + 100)

      // Should have received terminated response
      const response = worker.getLastResponse()
      expect(response.type).toBe('terminated')
      expect(worker.isTerminated()).toBe(true)
    })

    it('resets timeout on signing operations', async () => {
      // Initialize with short timeout
      const shortTimeout = 1000 // 1 second
      const initPayload: InitPayload & { timeoutMs: number } = {
        share: new Uint8Array(100).fill(1),
        groupPublicKey: new Uint8Array(32).fill(2),
        verifyingShares: {
          server: new Uint8Array(100).fill(3),
          client: new Uint8Array(100).fill(4),
        },
        timeoutMs: shortTimeout,
      }
      await worker.handleMessage({ type: 'init', payload: initPayload })

      // Advance halfway
      await vi.advanceTimersByTimeAsync(shortTimeout / 2)

      // Perform round1 (resets timer)
      await worker.handleMessage({
        type: 'round1',
        payload: { message: new Uint8Array([1, 2, 3, 4]) } as Round1Payload,
      })

      // Advance past original timeout
      await vi.advanceTimersByTimeAsync(shortTimeout / 2 + 100)

      // Should NOT be terminated yet (timer was reset)
      expect(worker.isTerminated()).toBe(false)

      // Advance past new timeout
      await vi.advanceTimersByTimeAsync(shortTimeout)

      // Now should be terminated
      expect(worker.isTerminated()).toBe(true)
    })
  })

  describe('error handling', () => {
    it('handles unknown message type', async () => {
      await worker.handleMessage({ type: 'unknown' as 'init' })

      const response = worker.getLastResponse()
      expect(response.type).toBe('error')
      expect((response.payload as { message: string }).message).toContain('Unknown message type')
    })
  })
})
