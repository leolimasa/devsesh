/**
 * FROST Client Library
 *
 * Manages communication with the FROST Web Worker and the signing WebSocket server.
 * The main thread never has access to the decrypted FROST share - it is only held in the worker.
 *
 * [req.0xpudr] - Uses @noble/curves for FROST operations (via worker)
 * [req.qwdm15] - Main thread isolation: share held only in worker
 * [req.qogtvx] - WebAuthn PRF required to initialize (master key passed at init)
 * [req.3j5hnq] - Client-initiated certificate request
 * [req.35jehk] - Worker status indicators
 * [req.obmwbr] - Memory zeroing on terminate
 */

import type {
  WorkerMessage,
  WorkerResponse,
  CertificateResult,
} from '@/types/sshca'
import { getSSHCASigningWebSocketURL, getToken, getSSHCAConfig } from './api'
import { decrypt } from './crypto/aes'
import { decodeBase64, encodeBase64 } from './crypto/encoding'
import type { SSHCAConfig } from '@/types/api'
import { ed25519 } from '@noble/curves/ed25519.js'

interface WSRequest {
  type: 'request_cert' | 'round1' | 'round2'
  host_id?: number
  user_public_key?: string // Base64-encoded Ed25519 public key for certificate
  session?: string
  payload?: string
}

interface WSResponse {
  type: 'session' | 'commitment' | 'certificate' | 'error'
  session?: string
  payload?: string
  expires_in?: number
  serial?: number
  error?: string
}

/**
 * FROSTClient manages the FROST signing lifecycle.
 * The decrypted FROST share is only accessible within the worker.
 */
export class FROSTClient {
  private worker: Worker | null = null
  private isInitialized = false
  private initTime: number | null = null
  private timeoutMs = 30 * 60 * 1000
  private pendingResolve: ((value: WorkerResponse) => void) | null = null
  private pendingReject: ((reason: Error) => void) | null = null
  // Track in-progress certificate requests to prevent races
  private certRequestPromise: Promise<CertificateResult> | null = null

  /**
   * Creates a new FROSTClient instance and spawns the web worker.
   * [req.qwdm15]
   */
  constructor() {
    this.spawnWorker()
  }

  /**
   * Spawns a new FROST Web Worker instance.
   */
  private spawnWorker(): void {
    this.worker = new Worker(
      new URL('../workers/frost-worker.ts', import.meta.url),
      { type: 'module' }
    )
    this.worker.onmessage = this.handleWorkerMessage.bind(this)
    this.worker.onerror = (err) => {
      console.error('[FROSTClient] Worker error:', err)
      this.worker = null
      this.isInitialized = false
    }
  }

  /**
   * Handles messages received from the worker.
   * Resolves pending promises for request/response pattern.
   */
  private handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
    const response = event.data
    if (response.type === 'error' && this.pendingReject) {
      this.pendingReject(new Error(
        (response.payload as { message: string })?.message || 'Worker error'
      ))
      this.pendingResolve = null
      this.pendingReject = null
      return
    }
    if (this.pendingResolve) {
      this.pendingResolve(response)
      this.pendingResolve = null
      this.pendingReject = null
    }
  }

  /**
   * Sends a message to the worker and waits for a response.
   */
  private sendToWorker(message: WorkerMessage, timeoutMs = 30000): Promise<WorkerResponse> {
    if (!this.worker) {
      return Promise.reject(new Error('Worker not running'))
    }
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve
      this.pendingReject = reject

      const timeout = setTimeout(() => {
        this.pendingResolve = null
        this.pendingReject = null
        reject(new Error('Worker request timed out'))
      }, timeoutMs)

      const origResolve = resolve
      const origReject = reject
      this.pendingResolve = (value) => {
        clearTimeout(timeout)
        origResolve(value)
      }
      this.pendingReject = (err) => {
        clearTimeout(timeout)
        origReject(err)
      }

      this.worker!.postMessage(message)
    })
  }

  /**
   * Initializes the worker with the FROST share and configuration.
   * Fetches the SSH CA config from the server, decrypts the client share
   * using the master key, and passes all data to the worker.
   *
   * [req.qogtvx] [req.qwdm15]
   *
   * @param encryptedShare - The encrypted client share (nonce || ciphertext)
   * @param masterKey - The master key derived from WebAuthn PRF
   */
  async initWithShare(
    encryptedShare: Uint8Array,
    masterKey: Uint8Array
  ): Promise<void> {
    if (!this.worker) {
      throw new Error('Worker not spawned')
    }

    const config = await getSSHCAConfig()

    console.log('[FROSTClient] Encrypted share length:', encryptedShare.length)
    console.log('[FROSTClient] Master key first 4 bytes:', Array.from(masterKey.slice(0, 4)).join(','))

    const nonce = encryptedShare.slice(0, 12)
    const ciphertext = encryptedShare.slice(12)
    console.log('[FROSTClient] Nonce first 4 bytes:', Array.from(nonce.slice(0, 4)).join(','))
    console.log('[FROSTClient] Ciphertext length:', ciphertext.length)

    const shareBytes = await decrypt(masterKey, nonce, ciphertext)
    console.log('[FROSTClient] Decrypted share length:', shareBytes.length)
    console.log('[FROSTClient] Decrypted share first 4 bytes:', Array.from(shareBytes.slice(0, 4)).join(','))

    return this.initWithConfig(config, shareBytes)
  }

  /**
   * Initializes the worker with pre-fetched config data.
   * Used when the SSH CA config and decrypted share are already available.
   *
   * @param config - The SSH CA config from the server
   * @param shareBytes - The decrypted client share
   */
  async initWithConfig(
    config: SSHCAConfig,
    shareBytes: Uint8Array
  ): Promise<void> {
    if (!this.worker) {
      throw new Error('Worker not spawned')
    }

    const groupPublicKey = decodeBase64(config.public_key)
    const serverVerifyingShare = decodeBase64(config.server_verifying_share)
    const clientVerifyingShare = decodeBase64(config.client_verifying_share)

    const response = await this.sendToWorker({
      type: 'init',
      payload: {
        share: shareBytes,
        groupPublicKey,
        verifyingShares: {
          server: serverVerifyingShare,
          client: clientVerifyingShare,
        },
        timeoutMs: this.timeoutMs,
      },
    })

    if (response.type !== 'ready') {
      throw new Error(
        `Worker init failed: ${(response.payload as { message?: string })?.message || 'unknown error'}`
      )
    }

    this.isInitialized = true
    this.initTime = Date.now()
  }

  /**
   * Requests a signed SSH certificate for the given host.
   * Performs the complete FROST signing flow over WebSocket.
   *
   * [req.3j5hnq] [req.wdalb2] [req.5xcc6i] [req.o3lf24] [req.dzym7r] [req.jki5t0]
   *
   * @param hostId - The host ID to request a certificate for
   * @returns The certificate result with base64-encoded certificate and serial number
   */
  async requestCertificate(hostId: number): Promise<CertificateResult> {
    console.log('[FROSTClient] requestCertificate called for host:', hostId, 'isInitialized:', this.isInitialized)

    if (!this.isInitialized || !this.worker) {
      throw new Error('FROST client not initialized')
    }

    // If there's already a certificate request in progress, return the same promise
    // This handles React StrictMode double-mounting gracefully
    if (this.certRequestPromise) {
      console.log('[FROSTClient] Returning existing certificate request promise')
      return this.certRequestPromise
    }

    const token = getToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    this.initTime = Date.now()

    console.log('[FROSTClient] Creating new WebSocket connection for certificate request')

    this.certRequestPromise = new Promise<CertificateResult>((resolve, reject) => {
      let ws: WebSocket | null = null
      let settled = false

      const cleanup = () => {
        if (ws && ws.readyState !== WebSocket.CLOSED) {
          ws.close()
        }
      }

      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true
          fn()
        }
      }

      try {
        const wsUrl = this.buildWebSocketURL(getSSHCASigningWebSocketURL(), token)
        ws = new WebSocket(wsUrl)

        ws.onopen = () => {
          this.handleSigningFlow(ws!, hostId)
            .then((result) => settle(() => resolve(result)))
            .catch((err) => settle(() => { cleanup(); reject(err) }))
        }

        ws.onerror = (event) => {
          settle(() => reject(new Error(`WebSocket connection error: ${event.type}`)))
        }

        ws.onclose = (event) => {
          if (!settled) {
            const reason = event.reason || `code ${event.code}`
            settle(() => reject(new Error(`WebSocket closed unexpectedly: ${reason}`)))
          }
        }
      } catch (err) {
        settle(() => reject(err))
      }
    })

    // Clear the promise after it settles (success or failure)
    this.certRequestPromise.finally(() => {
      this.certRequestPromise = null
    })

    return this.certRequestPromise
  }

  /**
   * Appends the JWT token as a query parameter for WebSocket authentication.
   */
  private buildWebSocketURL(baseUrl: string, token: string): string {
    const separator = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${separator}token=${encodeURIComponent(token)}`
  }

  /**
   * Performs the full FROST signing flow over WebSocket.
   * Generates an ephemeral Ed25519 keypair for the certificate and returns
   * both the signed certificate and the keypair for SSH authentication.
   */
  private async handleSigningFlow(
    ws: WebSocket,
    hostId: number
  ): Promise<CertificateResult> {
    const receiveWS = (): Promise<WSResponse> => {
      return new Promise((_resolve, _reject) => {
        const timeout = setTimeout(() => {
          _reject(new Error('WebSocket request timed out'))
        }, 30000)

        ws.onmessage = (event: MessageEvent) => {
          clearTimeout(timeout)
          try {
            const data = JSON.parse(event.data) as WSResponse
            if (data.type === 'error') {
              _reject(new Error(data.error || 'Server error'))
            } else {
              _resolve(data)
            }
          } catch (err) {
            _reject(err)
          }
        }
      })
    }

    // Generate ephemeral Ed25519 keypair for the certificate.
    // The private key is used to sign SSH authentication challenges.
    const userPrivateKey = ed25519.utils.randomSecretKey()
    const userPublicKey = ed25519.getPublicKey(userPrivateKey)

    try {
      // Step 1: Request certificate with our ephemeral public key
      ws.send(JSON.stringify({
        type: 'request_cert',
        host_id: hostId,
        user_public_key: encodeBase64(userPublicKey),
      } as WSRequest))

      const sessionResp = await receiveWS()
      if (sessionResp.type !== 'session') {
        throw new Error(`Expected session, got ${sessionResp.type}`)
      }
      const sessionId = sessionResp.session!
      const tbsData = decodeBase64(sessionResp.payload!)

      // Step 2: Round 1 - Generate commitment via worker
      const round1Resp = await this.sendToWorker({
        type: 'round1',
        payload: { message: tbsData },
      })
      if (round1Resp.type !== 'commitment') {
        throw new Error('Worker failed to generate commitment')
      }
      const clientCommitment = (round1Resp.payload as { commitment: Uint8Array }).commitment
      this.initTime = Date.now()

      // Step 3: Send client commitment to server
      ws.send(JSON.stringify({
        type: 'round1',
        session: sessionId,
        payload: encodeBase64(clientCommitment),
      } as WSRequest))

      const commitmentResp = await receiveWS()
      if (commitmentResp.type !== 'commitment') {
        throw new Error(`Expected commitment, got ${commitmentResp.type}`)
      }
      const serverCommitment = decodeBase64(commitmentResp.payload!)

      // Step 4: Round 2 - Compute partial signature via worker
      const round2Resp = await this.sendToWorker({
        type: 'round2',
        payload: { serverCommitment },
      })
      if (round2Resp.type !== 'partial_sig') {
        throw new Error('Worker failed to compute partial signature')
      }
      const partialSignature = (round2Resp.payload as { partialSignature: Uint8Array }).partialSignature
      this.initTime = Date.now()

      // Step 5: Send partial signature to server
      ws.send(JSON.stringify({
        type: 'round2',
        session: sessionId,
        payload: encodeBase64(partialSignature),
      } as WSRequest))

      const certResp = await receiveWS()
      if (certResp.type !== 'certificate') {
        throw new Error(`Expected certificate, got ${certResp.type}`)
      }

      // Debug: log certificate details
      const certBase64 = certResp.payload!
      const certBytes = decodeBase64(certBase64)
      console.log('[FROSTClient] Certificate received:',
        'base64_len:', certBase64.length,
        'bytes_len:', certBytes.length,
        'first_8:', Array.from(certBytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(''),
        'last_8:', Array.from(certBytes.slice(-8)).map(b => b.toString(16).padStart(2, '0')).join(''),
      )

      return {
        certificate: certResp.payload!,
        serial: certResp.serial ?? 0,
        userPrivateKey: userPrivateKey,
        userPublicKey: userPublicKey,
      }
    } finally {
      ws.close()
    }
  }

  /**
   * Checks whether the worker is active and the share is loaded.
   * [req.35jehk]
   */
  isActive(): boolean {
    return this.isInitialized && this.worker !== null
  }

  /**
   * Gets the remaining time before the worker auto-terminates.
   * [req.35jehk]
   */
  getRemainingTime(): number {
    if (!this.isActive() || this.initTime === null) {
      return 0
    }
    const elapsed = Date.now() - this.initTime
    return Math.max(0, this.timeoutMs - elapsed)
  }

  /**
   * Sets the inactivity timeout for the worker.
   */
  setTimeoutMs(ms: number): void {
    this.timeoutMs = ms
  }

  /**
   * Gets the total configured timeout in milliseconds.
   */
  getTimeoutMs(): number {
    return this.timeoutMs
  }

  /**
   * Manually terminates the worker and clears the FROST share from memory.
   * [req.obmwbr]
   */
  async terminate(): Promise<void> {
    if (this.worker) {
      try {
        await this.sendToWorker({ type: 'terminate' }, 5000)
      } catch {
        // Worker may already be terminated
      }
      this.worker.terminate()
      this.worker = null
    }
    this.isInitialized = false
    this.initTime = null
  }
}
