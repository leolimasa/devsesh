/**
 * SSHTerminal Component
 *
 * Provides a terminal interface for SSH connections with support for both
 * certificate-based and password-based authentication.
 *
 * Certificate-based authentication (Phase 11):
 * - When the SSH client requests a certificate, checks if FROST worker is active
 * - If active, requests a certificate via FROST signing
 * - If inactive, prompts user to authenticate with WebAuthn to unlock the worker
 * - Falls back to password authentication if certificate auth fails/is rejected
 *
 * [req.4oofln] [req.3j5hnq]
 */

import { useEffect, useRef, useState, useCallback } from "react"
import { Terminal as XTerm } from "xterm"
import { FitAddon } from "xterm-addon-fit"
import "xterm/css/xterm.css"
import { SSHClient } from "@/lib/ssh-client"
import { PasswordDialog } from "@/components/PasswordDialog"
import { WebAuthnDialog } from "@/components/WebAuthnDialog"
import { useFROST } from "@/contexts/FROSTContext"
import type { Host } from "@/types/api"
import { getMasterKey } from "@/lib/api"
import { loginBegin } from "@/lib/api"
import { deriveMasterKeyFromPrf, getPrfSalt, parseEncryptedMasterKey, decodeBase64 } from "@/lib/crypto/prf"
import { decodeBase64URL } from "@/lib/crypto/encoding"
import { decrypt } from "@/lib/crypto/aes"
import { encodeBase64 } from "@/lib/crypto/encoding"

interface SSHTerminalProps {
  host: Host
  sessionName: string
  onDisconnect?: () => void
}

type Status = "disconnected" | "connecting" | "authenticating" | "connected" | "error"

export function SSHTerminal({ host, sessionName, onDisconnect }: SSHTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sshClientRef = useRef<SSHClient | null>(null)
  const [status, setStatus] = useState<Status>("disconnected")
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [showWebAuthnDialog, setShowWebAuthnDialog] = useState(false)
  const [webAuthnAuthenticating, setWebAuthnAuthenticating] = useState(false)
  const [webAuthnError, setWebAuthnError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const { isActive, initWorker, requestCert } = useFROST()

  // Ref to store the latest handleCertificateRequest callback
  // This avoids the useEffect re-running when the callback changes
  const handleCertificateRequestRef = useRef<() => Promise<void>>(() => Promise.resolve())

  // Handle WebAuthn authentication to unlock FROST worker
  const handleWebAuthnAuth = useCallback(async () => {
    setWebAuthnAuthenticating(true)
    setWebAuthnError(null)

    try {
      // Get the user's email from localStorage
      const userStr = localStorage.getItem("user")
      if (!userStr) {
        throw new Error("No user found. Please log in again.")
      }
      const user = JSON.parse(userStr)

      // Get encrypted master key from server
      const { encrypted_master_key } = await getMasterKey()
      const encryptedData = decodeBase64(encrypted_master_key)
      const { data: encryptedPayload } = parseEncryptedMasterKey(new Uint8Array(encryptedData))

      // Start WebAuthn authentication with PRF to get master key
      const prfSalt = getPrfSalt()
      const prfSaltBuffer = prfSalt.buffer.slice(
        prfSalt.byteOffset,
        prfSalt.byteOffset + prfSalt.byteLength
      )

      // Get WebAuthn options from server (returns JSON with base64-encoded values)
      const options = await loginBegin(user.email) as {
        publicKey: {
          challenge: string
          timeout?: number
          rpId?: string
          userVerification?: UserVerificationRequirement
          allowCredentials?: Array<{
            id: string
            type: PublicKeyCredentialType
            transports?: AuthenticatorTransport[]
          }>
        }
      }

      // Convert base64url-encoded values to ArrayBuffer (WebAuthn uses base64url encoding)
      const challengeBuffer = decodeBase64URL(options.publicKey.challenge)

      // Debug: log credential IDs being used
      console.log('[SSHTerminal] allowCredentials from server:', options.publicKey.allowCredentials?.map(c => c.id))

      const allowCredentials = options.publicKey.allowCredentials?.map((cred) => {
        const decoded = decodeBase64URL(cred.id)
        console.log('[SSHTerminal] Decoded credential ID, length:', decoded.length)
        return {
          id: decoded,
          type: cred.type,
          transports: cred.transports,
        }
      })

      // Build PublicKeyCredentialRequestOptions with ArrayBuffer values and PRF extension
      console.log('[SSHTerminal] PRF get() rpId:', options.publicKey.rpId)
      console.log('[SSHTerminal] PRF salt length:', prfSalt.length)

      const publicKeyOptions: PublicKeyCredentialRequestOptions = {
        challenge: challengeBuffer,
        timeout: options.publicKey.timeout,
        rpId: options.publicKey.rpId,
        userVerification: options.publicKey.userVerification,
        allowCredentials,
        extensions: {
          prf: {
            eval: {
              first: prfSaltBuffer
            }
          }
        } as AuthenticationExtensionsClientInputs
      }

      // Authenticate with WebAuthn
      console.log('[SSHTerminal] Calling get() for PRF output...')
      const credential = await navigator.credentials.get({ publicKey: publicKeyOptions }) as PublicKeyCredential
      console.log('[SSHTerminal] PRF get() completed')
      if (!credential) {
        throw new Error("WebAuthn authentication cancelled")
      }

      // Extract PRF results
      const extResults = credential.getClientExtensionResults() as {
        prf?: { results?: { first?: ArrayBuffer } }
      }

      if (!extResults?.prf?.results?.first) {
        throw new Error("WebAuthn PRF extension required but not available")
      }

      const prfOutput = new Uint8Array(extResults.prf.results.first)
      console.log('[SSHTerminal] PRF output first 4 bytes:', Array.from(prfOutput.slice(0, 4)).join(','))

      // Derive master key from PRF output
      const prfKey = await deriveMasterKeyFromPrf(prfOutput)
      console.log('[SSHTerminal] Derived prfKey first 4 bytes:', Array.from(prfKey.slice(0, 4)).join(','))

      // Decrypt the master key
      const nonce = encryptedPayload.slice(0, 12)
      const ciphertext = encryptedPayload.slice(12)
      console.log('[SSHTerminal] Encrypted master key nonce first 4 bytes:', Array.from(nonce.slice(0, 4)).join(','))
      const masterKey = await decrypt(prfKey, nonce, ciphertext)
      console.log('[SSHTerminal] Decrypted masterKey first 4 bytes:', Array.from(masterKey.slice(0, 4)).join(','))

      // Initialize the FROST worker with the master key
      console.log('[SSHTerminal] Calling initWorker with masterKey length:', masterKey.length)
      await initWorker(masterKey)
      console.log('[SSHTerminal] initWorker completed, continuing with certificate request...')

      // Request certificate directly here instead of going through handleCertificateRequest
      // because React state updates are async and isActive won't be updated yet
      const client = sshClientRef.current
      console.log('[SSHTerminal] Got client ref:', client ? 'yes' : 'no')
      if (!client) {
        throw new Error("SSH client not available")
      }

      console.log('[SSHTerminal] FROST initialized, requesting certificate for host:', host.id)
      const result = await requestCert(host.id)
      console.log('[SSHTerminal] Certificate received, serial:', result.serial)

      // Provide the certificate and private key to the SSH client
      const privateKeyBase64 = encodeBase64(result.userPrivateKey)
      client.resolveCertificate(result.certificate, privateKeyBase64)
      console.log('[SSHTerminal] Certificate provided to SSH client')

      // Close the WebAuthn dialog AFTER certificate is provided
      setShowWebAuthnDialog(false)

    } catch (err) {
      console.error("[SSHTerminal] WebAuthn auth failed:", err)
      setWebAuthnError(err instanceof Error ? err.message : "Authentication failed")
      // Reject certificate to fall back to password auth
      if (sshClientRef.current) {
        sshClientRef.current.rejectCertificate()
      }
    } finally {
      setWebAuthnAuthenticating(false)
    }
  }, [initWorker, requestCert, host.id])

  // Handle certificate request from SSH client
  const handleCertificateRequest = useCallback(async () => {
    console.log('[SSHTerminal] handleCertificateRequest called, isActive:', isActive)
    const client = sshClientRef.current
    if (!client) {
      console.log('[SSHTerminal] handleCertificateRequest: no client, returning')
      return
    }

    try {
      // Check if FROST worker is active
      if (!isActive) {
        // Show WebAuthn dialog to unlock worker
        console.log('[SSHTerminal] FROST not active, showing WebAuthn dialog')
        setShowWebAuthnDialog(true)
        return
      }

      // Request certificate from FROST
      console.log('[SSHTerminal] FROST is active, requesting certificate for host:', host.id)
      const result = await requestCert(host.id)
      console.log('[SSHTerminal] Certificate received, serial:', result.serial)

      // Provide the certificate and private key to the SSH client
      // Private key needs to be base64-encoded
      const privateKeyBase64 = encodeBase64(result.userPrivateKey)
      client.resolveCertificate(result.certificate, privateKeyBase64)

    } catch (err) {
      console.error("[SSHTerminal] Certificate request failed:", err)
      console.log("[SSHTerminal] Rejecting certificate due to error in handleCertificateRequest")
      // Fall back to password auth
      client.rejectCertificate()
    }
  }, [isActive, requestCert, host.id])

  // Keep the ref updated with the latest callback
  useEffect(() => {
    handleCertificateRequestRef.current = handleCertificateRequest
  }, [handleCertificateRequest])

  // Handle canceling WebAuthn and falling back to password
  const handleWebAuthnCancel = useCallback(() => {
    console.log("[SSHTerminal] handleWebAuthnCancel called - user clicked 'Use Password Instead'")
    setShowWebAuthnDialog(false)
    setWebAuthnError(null)

    // Reject certificate auth to fall back to password
    if (sshClientRef.current) {
      console.log("[SSHTerminal] Rejecting certificate due to WebAuthn cancel")
      sshClientRef.current.rejectCertificate()
    }
  }, [])

  useEffect(() => {
    if (!terminalRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "monospace",
      theme: {
        background: "#1a1a1a",
        foreground: "#ffffff",
        cursor: "#ffffff",
      },
      rows: 24,
      cols: 80,
    })
    xtermRef.current = term

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    term.open(terminalRef.current)
    fitAddon.fit()

    // WebGL addon can cause issues on cleanup, so we skip it for stability
    // The canvas renderer works fine for our use case

    const client = new SSHClient()
    sshClientRef.current = client

    client.on("output", (data: string) => {
      try {
        term.write(data)
      } catch (e) {
        console.error("[SSHTerminal] Error writing to terminal:", e)
      }
    })

    client.on("status", (newStatus: string, err?: string) => {
      setStatus(newStatus as Status)
      if (err) {
        setError(err)
      } else {
        setError(null)
      }
    })

    client.on("password-request", () => {
      setStatus("authenticating")
      setShowPasswordDialog(true)
    })

    // Handle certificate request - this is triggered by the WASM client when
    // certificate authentication is available
    // We use a ref to get the latest callback without re-running this effect
    client.on("certificate-request", () => {
      setStatus("authenticating")
      handleCertificateRequestRef.current()
    })

    client.init()
      .then(() => {
        setLoading(false)
        const sshUser = host.ssh_user || "root"
        client.connect(host.id, sshUser)
        setStatus("connecting")
      })
      .catch((err) => {
        setLoading(false)
        setError(err.message)
        setStatus("error")
      })

    const handleResize = () => {
      fitAddon.fit()
      if (sshClientRef.current) {
        const { rows, cols } = term
        sshClientRef.current.resize(rows, cols)
      }
    }

    window.addEventListener("resize", handleResize)

    term.onData((data) => {
      if (sshClientRef.current) {
        sshClientRef.current.sendInput(data)
      }
    })

    return () => {
      window.removeEventListener("resize", handleResize)
      // Wrap cleanup in try-catch to prevent crashes
      try {
        client.disconnect()
      } catch (e) {
        console.error("Error disconnecting SSH client:", e)
      }
      try {
        term.dispose()
      } catch (e) {
        console.error("Error disposing terminal:", e)
      }
    }
  // Note: handleCertificateRequest is accessed via ref to avoid re-running this effect
  }, [host.id, host.ssh_user])

  const handlePasswordSubmit = (password: string) => {
    if (sshClientRef.current) {
      sshClientRef.current.resolvePassword(password)
      setShowPasswordDialog(false)
      setStatus("connecting")
    }
  }

  const handlePasswordCancel = () => {
    if (sshClientRef.current) {
      sshClientRef.current.rejectPassword()
      sshClientRef.current.disconnect()
      setShowPasswordDialog(false)
      setStatus("disconnected")
    }
  }

  const hasExecutedRef = useRef(false)

  useEffect(() => {
    if (status === "connected" && sshClientRef.current && !hasExecutedRef.current) {
      hasExecutedRef.current = true
      sshClientRef.current.exec(`tmux attach -t ${sessionName}`)
    }
  }, [status, sessionName])

  const handleDisconnect = () => {
    if (sshClientRef.current) {
      sshClientRef.current.disconnect()
    }
    setStatus("disconnected")
    onDisconnect?.()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-2 bg-muted">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {status === "connected" && "🟢 Connected"}
            {status === "connecting" && "🟡 Connecting..."}
            {status === "authenticating" && "🟡 Authenticating..."}
            {status === "error" && "🔴 Error"}
            {status === "disconnected" && "🔴 Disconnected"}
          </span>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
        {status !== "disconnected" && (
          <button
            onClick={handleDisconnect}
            className="px-3 py-1 text-sm bg-destructive text-white rounded hover:bg-destructive/90"
          >
            Disconnect
          </button>
        )}
      </div>
      {loading && (
        <div className="flex items-center justify-center h-full">
          <span>Loading SSH client...</span>
        </div>
      )}
      <div ref={terminalRef} className={loading ? "hidden" : "flex-1"} />
      <PasswordDialog
        isOpen={showPasswordDialog}
        username={host.ssh_user || "root"}
        onSubmit={handlePasswordSubmit}
        onCancel={handlePasswordCancel}
      />
      <WebAuthnDialog
        isOpen={showWebAuthnDialog}
        onAuthenticate={handleWebAuthnAuth}
        onCancel={handleWebAuthnCancel}
        isAuthenticating={webAuthnAuthenticating}
        error={webAuthnError}
      />
    </div>
  )
}
