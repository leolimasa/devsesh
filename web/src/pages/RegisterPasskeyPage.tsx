import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { browserSupportsWebAuthn, bufferToBase64URLString } from "@simplewebauthn/browser"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createPasskeyEnrollment, enrollmentBegin, enrollmentComplete, getEnrollmentWebSocketURL } from "@/lib/api"
import { spake2InitB, spake2Finish, encodeMessage, decodeMessage } from "@/lib/crypto/spake2"
import { deriveKey, encrypt, decrypt } from "@/lib/crypto/aes"
import { encodeBase64, encodeBase64URL, decodeBase64, decodeBase64URL, deriveMasterKeyFromPrf, formatEncryptedMasterKey, getPrfSalt, buildPrfGetExtension } from "@/lib/crypto/prf"

// Convert base64url to ArrayBuffer
function base64urlToBuffer(base64url: string): ArrayBuffer {
  return decodeBase64URL(base64url).buffer
}

// Shape of the WebAuthn creation options returned by enrollmentBegin.
type CreationOptions = {
  challenge: string
  rp: { name: string; id?: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: Array<{ type: string; alg: number }>
  timeout?: number
  excludeCredentials?: Array<{ id: string; type: string; transports?: string[] }>
  authenticatorSelection?: {
    authenticatorAttachment?: string
    residentKey?: string
    requireResidentKey?: boolean
    userVerification?: string
  }
  attestation?: string
}

type Status = "idle" | "waiting" | "handshaking" | "ready" | "registering" | "success" | "error"

export default function RegisterPasskeyPage() {
  const [code, setCode] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState("")
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [timeLeft, setTimeLeft] = useState(300)
  const navigate = useNavigate()
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionKeyRef = useRef<Uint8Array | null>(null)
  const masterKeyRef = useRef<Uint8Array | null>(null)
  const optionsRef = useRef<CreationOptions | null>(null)
  const isCancellingRef = useRef(false)
  const statusRef = useRef<Status>("idle")

  // Keep the status state and ref in sync so WebSocket callbacks (which capture
  // a stale `status` closure) can read the current value reliably.
  const updateStatus = (newStatus: Status) => {
    statusRef.current = newStatus
    setStatus(newStatus)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  useEffect(() => {
    if (expiresAt) {
      timerRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
        setTimeLeft(remaining)
        if (remaining === 0) {
          setError("Code expired")
          updateStatus("error")
          if (wsRef.current) wsRef.current.close()
        }
      }, 1000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [expiresAt])

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  // Best-effort relay of a failure to the peer (Machine A) so it doesn't hang
  // waiting for a confirmation that will never arrive.
  const sendPeerError = (message: string) => {
    const ws = wsRef.current
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message }))
      }
    } catch {
      // best effort only
    }
  }

  const handleStart = async () => {
    if (!browserSupportsWebAuthn()) {
      setError("WebAuthn is not supported")
      return
    }

    try {
      isCancellingRef.current = false
      const { code: enrollmentCode } = await createPasskeyEnrollment()
      setCode(enrollmentCode)
      setExpiresAt(new Date(Date.now() + 5 * 60 * 1000))
      updateStatus("waiting")

      // getEnrollmentWebSocketURL already returns full URL with protocol
      const wsURL = getEnrollmentWebSocketURL(enrollmentCode)

      const ws = new WebSocket(wsURL)
      wsRef.current = ws

      const { state, message: spake2Msg } = await spake2InitB(enrollmentCode)

      ws.onopen = () => {
        // Just wait for peer_connected notification, don't send spake2_b yet
        updateStatus("waiting")
      }

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data)

          if (msg.type === "error") {
            setError(msg.message || "The other device reported an error")
            updateStatus("error")
            return
          }

          if (msg.type === "peer_connected") {
            // Machine A has connected, now send spake2_b to start the handshake
            updateStatus("handshaking")
            ws.send(JSON.stringify({
              type: "spake2_b",
              message: encodeMessage(spake2Msg)
            }))
            return
          }

          if (msg.type === "spake2_a") {
            const otherMsg = decodeMessage(msg.message)

            const result = await spake2Finish(state, otherMsg)
            const key = await deriveKey(new Uint8Array(result.sharedSecret), "encryption-key")
            sessionKeyRef.current = key

            updateStatus("waiting")

            ws.onmessage = async (evt) => {
              try {
                const encryptedMsg = JSON.parse(evt.data)

                if (encryptedMsg.type === "error") {
                  setError(encryptedMsg.message || "The other device reported an error")
                  updateStatus("error")
                  return
                }

                if (encryptedMsg.type === "encrypted_payload") {
                  if (!sessionKeyRef.current) {
                    throw new Error("Session key not available")
                  }

                  const nonce = decodeBase64(encryptedMsg.nonce)
                  const ciphertext = decodeBase64(encryptedMsg.ciphertext)

                  const decrypted = await decrypt(sessionKeyRef.current, nonce, ciphertext)
                  masterKeyRef.current = decrypted

                  // Prefetch the creation options now so the "Create Passkey" tap
                  // can call navigator.credentials.create() as its very first
                  // action. Safari/iOS require WebAuthn to run under transient
                  // user activation, which a fresh tap provides but an async
                  // WebSocket callback does not.
                  const beginResp = await enrollmentBegin(enrollmentCode) as { publicKey: CreationOptions }
                  optionsRef.current = beginResp.publicKey

                  updateStatus("ready")
                }
              } catch (err) {
                console.error("Failed to prepare registration:", err)
                const message = err instanceof Error ? err.message : "Failed to prepare registration"
                setError(message)
                updateStatus("error")
                sendPeerError(message)
              }
            }
          }
        } catch (err) {
          console.error("Failed to process message:", err)
          const message = err instanceof Error ? err.message : "Failed to process message"
          setError(message)
          updateStatus("error")
          sendPeerError(message)
        }
      }

      ws.onerror = () => {
        setError("Connection error")
        updateStatus("error")
      }

      ws.onclose = () => {
        if (!isCancellingRef.current && statusRef.current !== "success" && statusRef.current !== "error") {
          updateStatus("error")
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start enrollment")
      updateStatus("error")
    }
  }

  // Runs from an explicit user tap so the WebAuthn ceremony has transient
  // activation (required by Safari/iOS). All the network round-trips that would
  // consume the activation window (handshake, master-key transfer, options
  // fetch) have already happened by this point.
  const completeRegistration = async () => {
    const ws = wsRef.current
    const masterKey = masterKeyRef.current
    const sessionKey = sessionKeyRef.current
    const options = optionsRef.current

    if (!masterKey || !sessionKey || !options) {
      setError("Enrollment state was lost. Please start over.")
      updateStatus("error")
      return
    }

    updateStatus("registering")

    try {
      const prfSalt = getPrfSalt()
      // Create a new ArrayBuffer to be safe in case getPrfSalt returns a view of a larger buffer
      const prfSaltBuffer = prfSalt.buffer.slice(
        prfSalt.byteOffset,
        prfSalt.byteOffset + prfSalt.byteLength
      )

      // Convert JSON options to native WebAuthn format
      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        challenge: base64urlToBuffer(options.challenge),
        rp: options.rp,
        user: {
          id: base64urlToBuffer(options.user.id),
          name: options.user.name,
          displayName: options.user.displayName
        },
        pubKeyCredParams: options.pubKeyCredParams.map(p => ({
          type: p.type as PublicKeyCredentialType,
          alg: p.alg
        })),
        timeout: options.timeout,
        excludeCredentials: options.excludeCredentials?.map(c => ({
          id: base64urlToBuffer(c.id),
          type: c.type as PublicKeyCredentialType,
          transports: c.transports as AuthenticatorTransport[] | undefined
        })),
        authenticatorSelection: options.authenticatorSelection as AuthenticatorSelectionCriteria,
        attestation: options.attestation as AttestationConveyancePreference,
        // Add PRF extension with proper ArrayBuffer salt
        extensions: {
          prf: {
            eval: {
              first: prfSaltBuffer
            }
          }
        } as AuthenticationExtensionsClientInputs
      }

      // Call native WebAuthn API (runs under the tap's user activation).
      const credentialResponse = await navigator.credentials.create({ publicKey: publicKeyOptions })
      if (!credentialResponse) {
        throw new Error('Registration was cancelled')
      }

      const credential = credentialResponse as PublicKeyCredential
      const attestationResponse = credential.response as AuthenticatorAttestationResponse

      // Extract PRF extension results
      const extResults = credential.getClientExtensionResults() as {
        prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
      }

      let prfOutput: Uint8Array | null = null

      // Check if PRF results were returned during creation (some authenticators support this)
      if (extResults?.prf?.results?.first) {
        prfOutput = new Uint8Array(extResults.prf.results.first)
      } else if (extResults?.prf?.enabled) {
        // PRF is supported but results weren't returned during create()
        // This is common for hardware security keys - we need to do a get() call
        const assertionOptions: PublicKeyCredentialRequestOptions = {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: options.rp.id || window.location.hostname,
          allowCredentials: [{
            id: credential.rawId,
            type: 'public-key' as const,
          }],
          userVerification: 'required',
          extensions: {
            // evalByCredential (keyed to this new credential) so the PRF matches
            // what the SSH-unlock get() will later request per-credential.
            prf: buildPrfGetExtension([credential.rawId], prfSaltBuffer)
          } as AuthenticationExtensionsClientInputs
        }

        const assertion = await navigator.credentials.get({ publicKey: assertionOptions })
        if (!assertion) {
          throw new Error('Failed to get PRF output from authenticator')
        }

        const assertionExtResults = (assertion as PublicKeyCredential).getClientExtensionResults() as {
          prf?: { results?: { first?: ArrayBuffer } }
        }

        if (assertionExtResults?.prf?.results?.first) {
          prfOutput = new Uint8Array(assertionExtResults.prf.results.first)
        }
      }

      if (!prfOutput) {
        throw new Error('WebAuthn PRF extension is required for passkey registration. Your authenticator must support the PRF/hmac-secret extension.')
      }

      const prfKey = await deriveMasterKeyFromPrf(prfOutput)
      const encrypted = await encrypt(prfKey, masterKey)
      // Combine nonce + ciphertext
      const combined = new Uint8Array(12 + encrypted.ciphertext.length)
      combined.set(encrypted.nonce, 0)
      combined.set(encrypted.ciphertext, 12)
      // Add version byte
      const newMasterKey = formatEncryptedMasterKey(combined)

      // Convert credential to JSON format for server
      const credentialJSON = {
        id: credential.id,
        rawId: bufferToBase64URLString(credential.rawId),
        response: {
          attestationObject: bufferToBase64URLString(attestationResponse.attestationObject),
          clientDataJSON: bufferToBase64URLString(attestationResponse.clientDataJSON),
          transports: attestationResponse.getTransports?.() || [],
          publicKey: attestationResponse.getPublicKey?.()
            ? bufferToBase64URLString(attestationResponse.getPublicKey()!)
            : undefined,
          publicKeyAlgorithm: attestationResponse.getPublicKeyAlgorithm?.(),
          authenticatorData: attestationResponse.getAuthenticatorData?.()
            ? bufferToBase64URLString(attestationResponse.getAuthenticatorData!())
            : undefined,
        },
        type: credential.type,
        clientExtensionResults: credential.getClientExtensionResults(),
        authenticatorAttachment: (credential as PublicKeyCredential & { authenticatorAttachment?: string }).authenticatorAttachment,
      }

      await enrollmentComplete(code, credentialJSON, encodeBase64(newMasterKey))

      // This passkey was just created on THIS device, so its master-key blob is
      // wrapped with this device's PRF and will unlock SSH here. Pin it as this
      // device's SSH-unlock credential so unlock uses it directly (Safari's PRF
      // is device-specific; a synced passkey enrolled elsewhere can't unlock
      // here). Keep the key in sync with SSHTerminal's SSH_UNLOCK_CRED_KEY.
      try {
        localStorage.setItem("ssh-unlock-cred", encodeBase64URL(new Uint8Array(credential.rawId)))
      } catch { /* ignore */ }

      // Confirm to Machine A (encrypted with the session key) that we're done.
      const confirmationData = new TextEncoder().encode("received")
      const { nonce: confNonce, ciphertext: confCiphertext } = await encrypt(sessionKey, confirmationData)

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "encrypted_payload",
          nonce: encodeBase64(confNonce),
          ciphertext: encodeBase64(confCiphertext),
        }))
      }

      updateStatus("success")

      setTimeout(() => {
        navigate("/login")
      }, 2000)
    } catch (err) {
      console.error("Registration error:", err)
      const message = err instanceof Error ? err.message : "Failed to complete registration"
      setError(message)
      updateStatus("error")
      sendPeerError(message)
    }
  }

  const handleCancel = () => {
    isCancellingRef.current = true
    if (timerRef.current) clearInterval(timerRef.current)
    updateStatus("idle")
    setCode("")
    setExpiresAt(null)
    setTimeLeft(300)
    setError("")
    sessionKeyRef.current = null
    masterKeyRef.current = null
    optionsRef.current = null
    if (wsRef.current) wsRef.current.close()
  }

  const isInProgress = status === "waiting" || status === "handshaking" || status === "ready" || status === "registering" || status === "error" || status === "success"

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Register Passkey</CardTitle>
          <CardDescription>
            Register a new passkey on this device
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === "idle" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Click the button below to generate an enrollment code.
                You will need to enter this code on another device that is already logged in.
              </p>
              <Button onClick={handleStart} className="w-full">
                Start Enrollment
              </Button>
            </div>
          )}

          {isInProgress && (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">Your enrollment code:</p>
                <p className="text-3xl font-mono font-bold tracking-wider">
                  {code.slice(0, 4)}-{code.slice(4)}
                </p>
              </div>

              {expiresAt && timeLeft > 0 && status !== "success" && (
                <div className="text-center text-sm text-muted-foreground">
                  Expires in: {formatTime(timeLeft)}
                </div>
              )}

              <div className="p-3 rounded-md bg-muted text-center">
                {status === "waiting" && "Waiting for other device to connect..."}
                {status === "handshaking" && "Performing key exchange..."}
                {status === "ready" && "Connected. Tap below to create your passkey on this device."}
                {status === "registering" && "Creating passkey..."}
                {status === "success" && "Passkey registered successfully!"}
                {status === "error" && error}
              </div>

              {status === "ready" && (
                <Button onClick={completeRegistration} className="w-full">
                  Create Passkey
                </Button>
              )}

              {status !== "success" && (
                <Button onClick={handleCancel} variant="outline" className="w-full">
                  Cancel
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
