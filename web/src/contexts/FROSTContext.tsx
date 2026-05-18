/**
 * FROST Context
 *
 * React context provider for the FROSTClient, making it available
 * throughout the component tree. Provides:
 * - The FROSTClient instance
 * - Worker status (active, remaining time)
 * - Initialization with master key (for encrypted share decryption)
 * - Certificate request capability
 *
 * Used by SSH terminal components and host management UI.
 * [req.35jehk] [req.4oofln] [req.qogtvx]
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { FROSTClient } from '@/lib/frost-client'
import { getSSHCAConfig } from '@/lib/api'
import { decodeBase64 } from '@/lib/crypto/encoding'
import type { CertificateResult } from '@/types/sshca'

interface FROSTContextType {
  client: FROSTClient | null
  isActive: boolean
  remainingTime: number
  /**
   * Initialize the FROST worker with the encrypted client share.
   * [req.qogtvx] Requires master key derived from WebAuthn PRF to decrypt the share.
   *
   * @param masterKey - The master key derived from WebAuthn PRF output
   */
  initWorker: (masterKey: Uint8Array) => Promise<void>
  requestCert: (hostId: number) => Promise<CertificateResult>
  terminate: () => Promise<void>
}

const FROSTContext = createContext<FROSTContextType | undefined>(undefined)

export function FROSTProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<FROSTClient | null>(null)
  const [isActive, setIsActive] = useState(false)
  const [remainingTime, setRemainingTime] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Create client on mount
  useEffect(() => {
    const client = new FROSTClient()
    clientRef.current = client

    // Poll worker status every second
    intervalRef.current = setInterval(() => {
      if (clientRef.current) {
        setIsActive(clientRef.current.isActive())
        setRemainingTime(clientRef.current.getRemainingTime())
      }
    }, 1000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
      clientRef.current?.terminate().catch(console.error)
    }
  }, [])

  /**
   * Initialize the FROST worker with the encrypted client share.
   * [req.qogtvx] Requires master key derived from WebAuthn PRF to decrypt the share.
   */
  const initWorker = useCallback(async (masterKey: Uint8Array) => {
    console.log('[FROSTContext] initWorker called, masterKey length:', masterKey.length)
    console.log('[FROSTContext] masterKey first 4 bytes:', Array.from(masterKey.slice(0, 4)).join(','))

    if (!clientRef.current) {
      throw new Error('Client not initialized')
    }

    // Fetch the SSH CA config from the server (includes encrypted client share)
    const config = await getSSHCAConfig()
    console.log('[FROSTContext] Got SSH CA config, client_share length:', config.client_share.length)

    // Decode the encrypted client share from base64
    // Format: nonce (12 bytes) || ciphertext
    const encryptedShare = decodeBase64(config.client_share)
    console.log('[FROSTContext] Decoded encrypted share length:', encryptedShare.length)
    console.log('[FROSTContext] Encrypted share first 4 bytes:', Array.from(encryptedShare.slice(0, 4)).join(','))

    // Initialize with encrypted share and master key - worker will decrypt
    await clientRef.current.initWithShare(encryptedShare, masterKey)
    console.log('[FROSTContext] initWithShare completed')
    setIsActive(true)
  }, [])

  const requestCert = useCallback(async (hostId: number) => {
    if (!clientRef.current) {
      throw new Error('Client not initialized')
    }
    const result = await clientRef.current.requestCertificate(hostId)
    return result
  }, [])

  const terminate = useCallback(async () => {
    if (clientRef.current) {
      await clientRef.current.terminate()
      setRemainingTime(0)
    }
    setIsActive(false)
  }, [])

  return (
    <FROSTContext.Provider
      value={{
        client: clientRef.current,
        isActive,
        remainingTime,
        initWorker,
        requestCert,
        terminate,
      }}
    >
      {children}
    </FROSTContext.Provider>
  )
}

export function useFROST(): FROSTContextType {
  const context = useContext(FROSTContext)
  if (context === undefined) {
    throw new Error('useFROST must be used within a FROSTProvider')
  }
  return context
}
