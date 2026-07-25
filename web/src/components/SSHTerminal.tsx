/**
 * SSHTerminal Component
 *
 * Always-present terminal whose connection lifecycle is driven by the parent
 * via an imperative handle. Supports certificate-based and password-based
 * authentication, auto-connect on mount, and auto-reconnect on unsolicited drop.
 */
import { forwardRef, useImperativeHandle, useEffect, useRef, useState, useCallback } from "react"
import { Terminal as XTerm } from "xterm"
import { FitAddon } from "xterm-addon-fit"
import "xterm/css/xterm.css"
import { SSHClient } from "@/lib/ssh-client"
import { PasswordDialog } from "@/components/PasswordDialog"
import { WebAuthnDialog } from "@/components/WebAuthnDialog"
import { useFROST } from "@/contexts/FROSTContext"
import type { Host } from "@/types/api"
import type { QuickKeyStep, ConnectionStatus } from "@/types/api"
import { encodeSpec } from "@/lib/quick-keys"
import { isDesktopViewport } from "@/lib/utils"
import { getMasterKey } from "@/lib/api"
import { loginBegin } from "@/lib/api"
import { clientLog } from "@/lib/api"
import { deriveMasterKeyFromPrf, getPrfSalt, parseEncryptedMasterKey, decodeBase64 } from "@/lib/crypto/prf"
import { decodeBase64URL, encodeBase64URL } from "@/lib/crypto/encoding"
import { decrypt } from "@/lib/crypto/aes"
import { encodeBase64 } from "@/lib/crypto/encoding"
import { useVisualViewport } from "@/hooks/useVisualViewport"

export type TerminalHandle = {
  connect: () => void
  disconnect: () => void
  sendKeys: (spec: QuickKeyStep[]) => void
  focus: () => void
}

type Status = ConnectionStatus

interface SSHTerminalProps {
  host: Host | null | undefined
  sessionName: string
  onStatusChange?: (status: Status) => void
  topBarHeight?: number
}

export const SSHTerminal = forwardRef<TerminalHandle, SSHTerminalProps>(
  function SSHTerminal({ host, sessionName, onStatusChange, topBarHeight = 0 }, ref) {
    const terminalRef = useRef<HTMLDivElement>(null)
    const xtermRef = useRef<XTerm | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const sshClientRef = useRef<SSHClient | null>(null)
    const [status, setStatus] = useState<Status>("disconnected")
    const [showPasswordDialog, setShowPasswordDialog] = useState(false)
    const [showWebAuthnDialog, setShowWebAuthnDialog] = useState(false)
    const [webAuthnAuthenticating, setWebAuthnAuthenticating] = useState(false)
    const [webAuthnError, setWebAuthnError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const userDisconnectedRef = useRef(false)
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const reconnectAttemptRef = useRef(0)
    const hasExecutedRef = useRef(false)
    const mountedRef = useRef(true)

    // Track true unmount (this effect's cleanup only runs when the component
    // is actually destroyed, not when host.id / ssh_user change). Used to stop
    // a scheduled reconnect from resurrecting a torn-down client.
    useEffect(() => {
      mountedRef.current = true
      return () => { mountedRef.current = false }
    }, [])

    const { isActive, initWorker, requestCert } = useFROST()
    const { height: viewportHeight } = useVisualViewport()

    const handleCertificateRequestRef = useRef<() => Promise<void>>(() => Promise.resolve())

    // Report status changes to parent
    useEffect(() => {
      onStatusChange?.(status)
    }, [status, onStatusChange])

    // --- WebAuthn unlock for FROST (same logic as before, extracted for reuse) ---
    const handleWebAuthnAuth = useCallback(async () => {
      setWebAuthnAuthenticating(true)
      setWebAuthnError(null)

      let stage = "init"
      const diag: Record<string, unknown> = {
        hasPublicKeyCredential: typeof window !== "undefined" && "PublicKeyCredential" in window,
        ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
      }

      try {
        const userStr = localStorage.getItem("user")
        if (!userStr) {
          throw new Error("No user found. Please log in again.")
        }
        const user = JSON.parse(userStr)

        const prfSalt = getPrfSalt()
        const prfSaltBuffer = prfSalt.buffer.slice(
          prfSalt.byteOffset,
          prfSalt.byteOffset + prfSalt.byteLength
        )

        stage = "login-begin"
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

        const challengeBuffer = decodeBase64URL(options.publicKey.challenge)
        const allowCredentials = options.publicKey.allowCredentials?.map((cred) => ({
          id: decodeBase64URL(cred.id),
          type: cred.type,
          transports: cred.transports,
        }))

        const publicKeyOptions: PublicKeyCredentialRequestOptions = {
          challenge: challengeBuffer,
          timeout: options.publicKey.timeout,
          rpId: options.publicKey.rpId,
          userVerification: options.publicKey.userVerification,
          allowCredentials,
          extensions: {
            prf: {
              eval: { first: prfSaltBuffer }
            }
          } as AuthenticationExtensionsClientInputs
        }
        diag.rpId = options.publicKey.rpId
        diag.allowCredentialsCount = allowCredentials?.length ?? 0
        diag.origin = typeof window !== "undefined" ? window.location.origin : ""

        stage = "webauthn-get"
        const credential = await navigator.credentials.get({ publicKey: publicKeyOptions }) as PublicKeyCredential
        if (!credential) {
          throw new Error("WebAuthn authentication cancelled")
        }

        stage = "prf-extract"
        const extResults = credential.getClientExtensionResults() as {
          prf?: { results?: { first?: ArrayBuffer } }
        }
        diag.prfEnabled = !!(extResults as { prf?: { enabled?: boolean } })?.prf?.enabled
        diag.prfHasResults = !!extResults?.prf?.results?.first

        if (!extResults?.prf?.results?.first) {
          throw new Error("WebAuthn PRF extension required but not available")
        }

        const prfOutput = new Uint8Array(extResults.prf.results.first)

        stage = "fetch-master-key"
        const credentialId = encodeBase64URL(new Uint8Array(credential.rawId))
        diag.credentialIdLen = credential.rawId.byteLength
        const { encrypted_master_key } = await getMasterKey(credentialId)
        const { data: encryptedPayload } = parseEncryptedMasterKey(new Uint8Array(decodeBase64(encrypted_master_key)))

        stage = "derive-decrypt"
        const prfKey = await deriveMasterKeyFromPrf(prfOutput)
        const nonce = encryptedPayload.slice(0, 12)
        const ciphertext = encryptedPayload.slice(12)
        const masterKey = await decrypt(prfKey, nonce, ciphertext)

        stage = "init-worker"
        await initWorker(masterKey)

        stage = "request-cert"
        const client = sshClientRef.current
        if (!client) {
          throw new Error("SSH client not available")
        }
        const result = await requestCert(host?.id ?? 0)
        const privateKeyBase64 = encodeBase64(result.userPrivateKey)
        client.resolveCertificate(result.certificate, privateKeyBase64)

        setShowWebAuthnDialog(false)
      } catch (err) {
        const e = err as { name?: string; message?: string; stack?: string }
        const name = e?.name ? `${e.name}: ` : ""
        setWebAuthnError(err instanceof Error ? `${name}${err.message}` : "Authentication failed")
        clientLog({
          event: "ssh-unlock-error",
          stage,
          errorName: e?.name ?? null,
          errorMessage: e?.message ?? String(err),
          errorStack: e?.stack ?? null,
          ...diag,
        })
      } finally {
        setWebAuthnAuthenticating(false)
      }
    }, [initWorker, requestCert, host?.id])

    // Handle certificate request from SSH client
    const handleCertificateRequest = useCallback(async () => {
      const client = sshClientRef.current
      if (!client) return

      try {
        if (!isActive) {
          setShowWebAuthnDialog(true)
          return
        }

        const result = await requestCert(host?.id ?? 0)
        const privateKeyBase64 = encodeBase64(result.userPrivateKey)
        client.resolveCertificate(result.certificate, privateKeyBase64)
      } catch (err) {
        console.error("[SSHTerminal] Certificate request failed:", err)
        client.rejectCertificate()
      }
    }, [isActive, requestCert, host?.id])

    useEffect(() => {
      handleCertificateRequestRef.current = handleCertificateRequest
    }, [handleCertificateRequest])

    const handleWebAuthnCancel = useCallback(() => {
      setShowWebAuthnDialog(false)
      setWebAuthnError(null)
      if (sshClientRef.current) {
        sshClientRef.current.rejectCertificate()
      }
    }, [])

    // Internal disconnect that tracks user intent
    const doDisconnect = useCallback(() => {
      userDisconnectedRef.current = true
      if (sshClientRef.current) {
        try { sshClientRef.current.disconnect() } catch { /* ignore */ }
      }
      setStatus("disconnected")
      hasExecutedRef.current = false
    }, [])

    // Internal connect
    const doConnect = useCallback(() => {
      if (!mountedRef.current || !host || !sshClientRef.current) return
      userDisconnectedRef.current = false
      const sshUser = host.ssh_user || "root"
      sshClientRef.current.connect(host.id, sshUser)
      setStatus("connecting")
    }, [host])

    // Auto-reconnect on unsolicited drop
    const maybeReconnect = useCallback(() => {
      if (userDisconnectedRef.current || !mountedRef.current) return
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      const backoff = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000)
      reconnectTimeoutRef.current = setTimeout(() => {
        if (userDisconnectedRef.current || !mountedRef.current) return
        reconnectAttemptRef.current++
        doConnect()
      }, backoff)
    }, [doConnect])

    // Imperative handle for parent
    useImperativeHandle(ref, () => ({
      connect: doConnect,
      disconnect: doDisconnect,
      sendKeys: (spec: QuickKeyStep[]) => {
        if (sshClientRef.current) {
          const bytes = encodeSpec(spec)
          sshClientRef.current.sendInput(bytes)
          // Refocus the terminal on desktop so typing continues there. On
          // mobile we deliberately skip it: focusing xterm's textarea pops the
          // on-screen keyboard, which is unwanted when firing quick keys by
          // touch.
          if (isDesktopViewport()) {
            xtermRef.current?.focus()
          }
        }
      },
      focus: () => {
        xtermRef.current?.focus()
      },
    }), [doConnect, doDisconnect])

    // --- Main lifecycle: create terminal, SSH client, wire events ---
    useEffect(() => {
      if (!terminalRef.current) return

      // Fresh lifecycle: re-enable auto-reconnect for this client instance.
      userDisconnectedRef.current = false

      const term = new XTerm({
        cursorBlink: true,
        // Keep the block cursor a solid block even when the terminal isn't
        // focused. By default an unfocused block renders as a faint hollow
        // outline, which reads as the cursor "disappearing" in neovim normal
        // mode. (We intentionally do NOT auto-focus the terminal.)
        cursorInactiveStyle: "block",
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

      const client = new SSHClient()
      sshClientRef.current = client

      client.on("output", (data: string) => {
        try { term.write(data) } catch { /* ignore */ }
      })

      client.on("status", (newStatus: string, _err?: string) => {
        setStatus(newStatus as Status)
        // On unsolicited drop, try auto-reconnect
        if (newStatus === "disconnected" || newStatus === "error") {
          if (!userDisconnectedRef.current) {
            maybeReconnect()
          }
        }
        if (newStatus === "connected") {
          reconnectAttemptRef.current = 0
        }
      })

      client.on("password-request", () => {
        setStatus("authenticating")
        setShowPasswordDialog(true)
      })

      client.on("certificate-request", () => {
        setStatus("authenticating")
        handleCertificateRequestRef.current()
      })

      client.on("certificate-auth-failed", (reason: string) => {
        console.error("[SSHTerminal] Certificate auth failed:", reason)
      })

      client.init()
        .then(() => {
          setLoading(false)
          // Auto-connect if host is present
          if (host) {
            const sshUser = host.ssh_user || "root"
            client.connect(host.id, sshUser)
            setStatus("connecting")
          }
        })
        .catch(() => {
          setLoading(false)
          setStatus("error")
        })

      term.onData((data) => {
        if (sshClientRef.current) {
          sshClientRef.current.sendInput(data)
        }
      })

      return () => {
        // Mark this teardown as intentional so the "disconnected" event that
        // disconnect() may emit does not schedule a reconnect.
        userDisconnectedRef.current = true
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
        try { client.disconnect() } catch { /* ignore */ }
        try { term.dispose() } catch { /* ignore */ }
      }
      // Deliberately re-create terminal only on host.id and ssh_user changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [host?.id, host?.ssh_user])

    // --- tmux attach when connected ---
    useEffect(() => {
      if (status === "connected" && sshClientRef.current && !hasExecutedRef.current) {
        hasExecutedRef.current = true
        sshClientRef.current.exec(`tmux attach -t ${sessionName}`)
        // The pty was opened at the default size while the terminal container
        // was still hidden/settling (its width/height aren't known until the
        // layout settles after first paint), so tmux would draw at the wrong
        // size until the next resize event. Once attached, fit to the real
        // container and push the size so it's correct on first load. The short
        // delay lets tmux finish attaching so the resize triggers a redraw.
        const t = setTimeout(() => {
          if (fitAddonRef.current && xtermRef.current && sshClientRef.current) {
            fitAddonRef.current.fit()
            const { rows, cols } = xtermRef.current
            sshClientRef.current.resize(rows, cols)
          }
        }, 300)
        return () => clearTimeout(t)
      }
    }, [status, sessionName])

    // --- Keyboard-aware sizing via visualViewport ---
    useEffect(() => {
      if (!fitAddonRef.current || !xtermRef.current || !sshClientRef.current) return
      const term = xtermRef.current
      const fitAddon = fitAddonRef.current
      // Small delay to let the layout settle
      const timer = setTimeout(() => {
        fitAddon.fit()
        const { rows, cols } = term
        sshClientRef.current?.resize(rows, cols)
      }, 50)
      return () => clearTimeout(timer)
    }, [viewportHeight, loading])

    const handlePasswordSubmit = useCallback((password: string) => {
      if (sshClientRef.current) {
        sshClientRef.current.resolvePassword(password)
        setShowPasswordDialog(false)
        setStatus("connecting")
      }
    }, [])

    const handlePasswordCancel = useCallback(() => {
      // Cancelling auth is an explicit "stop" — mark it so the resulting
      // disconnect does not trigger auto-reconnect (which would re-open the
      // WebAuthn/password dialogs in a loop).
      userDisconnectedRef.current = true
      hasExecutedRef.current = false
      if (sshClientRef.current) {
        sshClientRef.current.rejectPassword()
        sshClientRef.current.disconnect()
        setShowPasswordDialog(false)
        setStatus("disconnected")
      }
    }, [])

    return (
      <div className="flex flex-col h-full">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <span>Loading SSH client...</span>
          </div>
        )}
        <div
          ref={terminalRef}
          className={loading ? "hidden" : "flex-1"}
          style={{
            height: viewportHeight > 0 ? `${viewportHeight - topBarHeight}px` : "100%",
          }}
        />
        <PasswordDialog
          isOpen={showPasswordDialog}
          username={host?.ssh_user || "root"}
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
)
