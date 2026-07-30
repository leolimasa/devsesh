/**
 * SSHTerminal Component
 *
 * Always-present terminal whose connection lifecycle is driven by the parent
 * via an imperative handle. Supports certificate-based and password-based
 * authentication, auto-connect on mount, and auto-reconnect on unsolicited drop.
 */
import { forwardRef, useImperativeHandle, useEffect, useRef, useState, useCallback } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
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
import { deriveMasterKeyFromPrf, getPrfSalt, parseEncryptedMasterKey, decodeBase64, buildPrfGetExtension } from "@/lib/crypto/prf"
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

// Ceiling on consecutive auto-reconnect attempts before we stop and require a
// manual reconnect. Bounds the churn from a session that can't establish.
const MAX_RECONNECT_ATTEMPTS = 8

// Thrown by the unlock flow when no stored blob decrypts with this device's PRF:
// this device has never wrapped the master key and must be provisioned.
class NeedsProvisionError extends Error {
  constructor() {
    super("device not provisioned for SSH")
    this.name = "NeedsProvisionError"
  }
}

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
    // Mirrors the wasm-reported status synchronously so effects can gate on the
    // real connection state without waiting for a React re-render.
    const statusRef = useRef<Status>("disconnected")
    // Flips true once the wasm client is initialized, so the connect effect
    // knows it can start connecting.
    const [ready, setReady] = useState(false)
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
    // Ref indirection so the (mount-once) status callback always calls the
    // latest reconnect logic, which closes over the current host.
    const maybeReconnectRef = useRef<() => void>(() => {})
    const attachTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Track true unmount (this effect's cleanup only runs when the component
    // is actually destroyed, not when host.id / ssh_user change). Used to stop
    // a scheduled reconnect from resurrecting a torn-down client.
    useEffect(() => {
      mountedRef.current = true
      return () => { mountedRef.current = false }
    }, [])

    const { initWorker, requestCert, ensureAlive } = useFROST()
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
            // evalByCredential (keyed per credential) so Safari/iOS returns the
            // same PRF it produced at enrollment; a bare eval with multiple
            // allowCredentials yields a mismatched PRF and OperationError there.
            prf: buildPrfGetExtension(
              (allowCredentials ?? []).map((c) => c.id as ArrayBuffer),
              prfSaltBuffer
            )
          } as AuthenticationExtensionsClientInputs
        }
        diag.rpId = options.publicKey.rpId
        diag.allowCredentialsCount = allowCredentials?.length ?? 0
        diag.prfExtShape = (allowCredentials?.length ?? 0) > 0 ? "evalByCredential" : "eval"
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
        // Non-sensitive fingerprint of the unlock PRF output, to compare against
        // the enrollment-time fingerprint when diagnosing the iOS unlock failure.
        diag.prfFirst4 = Array.from(prfOutput.slice(0, 4)).join(",")

        stage = "fetch-master-key"
        const credentialId = encodeBase64URL(new Uint8Array(credential.rawId))
        diag.credentialIdShort = credentialId.slice(0, 12)
        diag.credentialIdLen = credential.rawId.byteLength
        const { blobs } = await getMasterKey(credentialId)

        stage = "derive-decrypt"
        // A synced passkey has one wrapped master key per device (device-specific
        // PRF). Try each blob with this device's PRF; the AES-GCM tag validates
        // exactly the one wrapped here. If none decrypt, this device has no blob
        // yet and must be provisioned.
        const prfKey = await deriveMasterKeyFromPrf(prfOutput)
        let masterKey: Uint8Array | null = null
        for (const blob of blobs) {
          try {
            const { data } = parseEncryptedMasterKey(new Uint8Array(decodeBase64(blob)))
            masterKey = await decrypt(prfKey, data.slice(0, 12), data.slice(12))
            break
          } catch {
            // Wrong device's blob (tag mismatch) — try the next.
          }
        }
        diag.blobCount = blobs.length
        if (!masterKey) {
          throw new NeedsProvisionError()
        }

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
        // No stored blob decrypts with this device's PRF → this device isn't
        // provisioned. Auto-launch the "set up this device" flow (option A): it
        // adds a per-device blob for the existing synced passkey via a working
        // device, without minting a new passkey.
        if (err instanceof NeedsProvisionError) {
          setShowWebAuthnDialog(false)
          window.location.href = "/passkeys/enroll?reason=ssh-provision"
          return
        }
        if (stage === "derive-decrypt" && e?.name === "OperationError") {
          setWebAuthnError(
            "This passkey can't unlock SSH on this device (it was set up on another device). " +
              "Tap Authenticate again and choose a passkey created on this device, or enroll one here."
          )
        } else {
          const name = e?.name ? `${e.name}: ` : ""
          setWebAuthnError(err instanceof Error ? `${name}${err.message}` : "Authentication failed")
        }
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
        // Authoritatively verify the FROST worker is alive rather than trusting
        // the polled isActive flag, which stays stale-true when iOS kills the
        // worker on background. If it's gone, prompt a re-unlock (one tap)
        // instead of hanging on a dead worker.
        const alive = await ensureAlive()
        if (!alive) {
          setShowWebAuthnDialog(true)
          return
        }

        const result = await requestCert(host?.id ?? 0)
        const privateKeyBase64 = encodeBase64(result.userPrivateKey)
        client.resolveCertificate(result.certificate, privateKeyBase64)
      } catch (err) {
        // Any cert-request failure on reconnect (dead worker, expired session,
        // signing-ws hiccup) must stay RECOVERABLE: surface the unlock dialog so
        // a single tap re-authenticates, rather than failing the reconnect with a
        // generic error (the "fails to reconnect when I come back" report).
        const e = err as { name?: string; message?: string }
        clientLog({
          event: "ssh-cert-request-error",
          errorName: e?.name ?? null,
          errorMessage: e?.message ?? String(err),
          ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
        }).catch(() => {})
        setShowWebAuthnDialog(true)
      }
    }, [ensureAlive, requestCert, host?.id])

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

    // Stable key identifying this session's host in the wasm connection pool.
    const hostKey = host ? String(host.id) : ""

    // Internal disconnect that tracks user intent (disconnects the current host).
    const doDisconnect = useCallback(() => {
      userDisconnectedRef.current = true
      if (sshClientRef.current && hostKey) {
        try { sshClientRef.current.disconnect(hostKey) } catch { /* ignore */ }
      }
      statusRef.current = "disconnected"
      setStatus("disconnected")
      hasExecutedRef.current = false
    }, [hostKey])

    // Internal connect: activate (or establish) the pooled connection for this
    // host. Switching to a host we're already connected to reuses it — no
    // re-auth. We force status back to "connecting" so the attach effect waits
    // for a real "connected" before running `tmux attach`.
    const doConnect = useCallback(() => {
      if (!mountedRef.current || !host || !sshClientRef.current) return
      userDisconnectedRef.current = false
      const sshUser = host.ssh_user || "root"
      // Set "connecting" BEFORE connect(): for a host we're already pooled-
      // connected to, connect() reuses it and fires the "connected" status
      // callback SYNCHRONOUSLY (client.go reuse path). If we forced "connecting"
      // *after* the call we'd clobber that "connected", and since wasm never
      // re-emits it for a reused connection the status would be pinned at
      // "connecting" forever — the attach effect would never run and the
      // terminal would never update (the A->B->A stuck-in-Connecting bug). For a
      // brand-new host, connect() emits asynchronously, so "connecting" here is
      // still correct and the later "connected" fires the attach.
      statusRef.current = "connecting"
      setStatus("connecting")
      sshClientRef.current.connect(String(host.id), host.id, sshUser)
    }, [host])

    // Auto-reconnect on unsolicited drop, with a ceiling. A session that can't
    // establish (e.g. a passkey that can't unlock, or a dead upstream) must NOT
    // retry forever: unbounded reconnects churn WebSocket/proxy connections that
    // leak memory in the caddy/tailscale layer and pin the UI in a permanent
    // reconnect loop. After MAX_RECONNECT_ATTEMPTS we stop and surface the manual
    // Connect button. The counter resets to 0 on a successful connect and on an
    // explicit recover (network back / tab visible), so legitimate transient
    // drops still recover automatically.
    const maybeReconnect = useCallback(() => {
      if (userDisconnectedRef.current || !mountedRef.current) return
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        statusRef.current = "error"
        setStatus("error")
        return
      }
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      const backoff = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000)
      reconnectTimeoutRef.current = setTimeout(() => {
        if (userDisconnectedRef.current || !mountedRef.current) return
        reconnectAttemptRef.current++
        doConnect()
      }, backoff)
    }, [doConnect])

    useEffect(() => { maybeReconnectRef.current = maybeReconnect }, [maybeReconnect])

    // Recover promptly when the network comes back (e.g. wifi returns). A drop
    // can leave the active connection wedged; on `online` (or the tab becoming
    // visible again) force a fresh reconnect: drop any stale/zombie pooled
    // connection first so connect() re-handshakes instead of reusing it.
    useEffect(() => {
      const recover = () => {
        if (!mountedRef.current || !host) return
        if (statusRef.current === "connected") return
        if (hostKey && sshClientRef.current) {
          try { sshClientRef.current.disconnect(hostKey) } catch { /* ignore */ }
        }
        reconnectAttemptRef.current = 0
        doConnect()
      }
      const onVisible = () => { if (document.visibilityState === "visible") recover() }
      window.addEventListener("online", recover)
      document.addEventListener("visibilitychange", onVisible)
      return () => {
        window.removeEventListener("online", recover)
        document.removeEventListener("visibilitychange", onVisible)
      }
    }, [host, hostKey, doConnect])

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

    // --- Create the terminal + SSH client ONCE. The connection pool lives in
    // the wasm client and is keyed by host, so we do NOT tear it down when the
    // host or session changes — only on unmount (disconnectAll). ---
    useEffect(() => {
      if (!terminalRef.current) return

      userDisconnectedRef.current = false

      const term = new XTerm({
        cursorBlink: true,
        // Keep the block cursor a solid block even when the terminal isn't
        // focused. By default an unfocused block renders as a faint hollow
        // outline, which reads as the cursor "disappearing" in neovim normal
        // mode.
        cursorInactiveStyle: "block",
        fontSize: 14,
        fontFamily: "'JetBrainsMono Nerd Font Mono', monospace",
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

      // Auto-focus on page load so the user can start typing immediately —
      // desktop only. On mobile, focusing xterm's textarea pops the on-screen
      // keyboard, which is unwanted before the user taps into the terminal.
      if (isDesktopViewport()) {
        term.focus()
      }

      // The Nerd Font is a web font (font-display: swap), so the first fit may
      // measure the fallback metrics. Re-fit and push the size once the font is
      // ready so the grid matches the actual glyph width.
      if (typeof document !== "undefined" && document.fonts?.ready) {
        document.fonts.ready.then(() => {
          try {
            fitAddon.fit()
            const { rows, cols } = term
            sshClientRef.current?.resize(rows, cols)
          } catch { /* ignore */ }
        })
      }

      const client = new SSHClient()
      sshClientRef.current = client

      client.on("output", (data: string) => {
        try { term.write(data) } catch { /* ignore */ }
      })

      client.on("status", (newStatus: string, _err?: string) => {
        statusRef.current = newStatus as Status
        setStatus(newStatus as Status)
        // On unsolicited drop, try auto-reconnect the active host.
        if (newStatus === "disconnected" || newStatus === "error") {
          if (!userDisconnectedRef.current) {
            maybeReconnectRef.current()
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
          setReady(true)
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
        // disconnect may emit does not schedule a reconnect. Tear down every
        // pooled connection so no host is left connected after we leave.
        userDisconnectedRef.current = true
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
        if (attachTimeoutRef.current) clearTimeout(attachTimeoutRef.current)
        try { client.disconnectAll() } catch { /* ignore */ }
        try { term.dispose() } catch { /* ignore */ }
      }
      // Mount once — the pooled connection survives host/session changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // --- Connect/activate the pooled connection for the current host. Fires
    // once the wasm client is ready and whenever the host changes. Reusing a
    // host we're already connected to does NOT re-authenticate. ---
    useEffect(() => {
      if (!ready || !host) return
      doConnect()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, host?.id, host?.ssh_user])

    // --- Attach tmux, and re-attach when the session (or host) changes. Gated
    // on the LIVE status (statusRef) so it never runs against a half-open
    // connection: for a brand-new host it waits for "connected"; for a same-host
    // session switch it fires immediately and the wasm client preempts the old
    // `tmux attach` on the same connection (no reconnect/re-auth). ---
    useEffect(() => {
      if (statusRef.current !== "connected" || !sshClientRef.current || !hostKey) return
      hasExecutedRef.current = true
      // Fit and push the size to the client BEFORE attaching so the new pty is
      // opened at the real terminal dimensions (the wasm client remembers the
      // last size). Otherwise tmux draws at the default 24x80 for a beat and
      // then jumps to full size — the small-then-grow flash on session switch.
      if (fitAddonRef.current && xtermRef.current) {
        try { fitAddonRef.current.fit() } catch { /* ignore */ }
        const { rows, cols } = xtermRef.current
        sshClientRef.current.resize(rows, cols)
      }
      sshClientRef.current.exec(hostKey, `tmux attach -t ${sessionName}`)
      // Desktop: focus the terminal so the user can type immediately after
      // opening or switching a session. On mobile we skip it — focusing xterm's
      // textarea pops the on-screen keyboard before the user taps in.
      if (isDesktopViewport()) xtermRef.current?.focus()
      // Re-fit once more after tmux settles, in case the container height
      // changed during the switch (e.g. the top bar height re-measured).
      if (attachTimeoutRef.current) clearTimeout(attachTimeoutRef.current)
      attachTimeoutRef.current = setTimeout(() => {
        if (fitAddonRef.current && xtermRef.current && sshClientRef.current) {
          fitAddonRef.current.fit()
          const { rows, cols } = xtermRef.current
          sshClientRef.current.resize(rows, cols)
        }
      }, 300)
      return () => { if (attachTimeoutRef.current) clearTimeout(attachTimeoutRef.current) }
    }, [status, sessionName, hostKey])

    // --- Keep the terminal fitted to its container ---
    // Re-fit when the visual viewport (keyboard), the loading->visible
    // transition, or the measured top-bar height changes. topBarHeight is
    // essential: it settles after first paint, and without re-fitting the
    // terminal keeps an over-tall grid that overflows its container and covers
    // the (bottom, on mobile) bar.
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
    }, [viewportHeight, topBarHeight, loading])

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
        if (hostKey) sshClientRef.current.disconnect(hostKey)
        setShowPasswordDialog(false)
        statusRef.current = "disconnected"
        setStatus("disconnected")
      }
    }, [hostKey])

    return (
      <div className="flex flex-col h-full">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <span>Loading SSH client...</span>
          </div>
        )}
        <div
          ref={terminalRef}
          // overflow-hidden so a transiently over-tall xterm grid can never
          // spill out and cover the bar (which would block taps on it).
          className={loading ? "hidden" : "flex-1 overflow-hidden"}
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
