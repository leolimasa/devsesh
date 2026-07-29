import { useState, useEffect, useRef } from "react"
import { browserSupportsWebAuthn, bufferToBase64URLString } from "@simplewebauthn/browser"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { getToken, getMasterKey, getEnrollmentWebSocketURL } from "@/lib/api"
import { spake2Init, spake2Finish, encodeMessage, decodeMessage } from "@/lib/crypto/spake2"
import { deriveKey, encrypt, decrypt } from "@/lib/crypto/aes"
import { deriveMasterKeyFromPrf, decodeBase64, decodeBase64URL, encodeBase64, encodeBase64URL, parseEncryptedMasterKey, getPrfSalt, buildPrfGetExtension } from "@/lib/crypto/prf"

type Status = "idle" | "authenticating" | "connecting" | "handshaking" | "transferring" | "success" | "error"

interface AuthBeginResponse {
  options: unknown
  sessionKey: string
}

export default function AddPasskeyPage() {
  const [code, setCode] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState("")
  const wsRef = useRef<WebSocket | null>(null)
  const sessionKeyRef = useRef<Uint8Array | null>(null)
  const completedRef = useRef(false)
  const statusRef = useRef<Status>("idle")

  // Update both status state and ref to avoid stale closures
  const updateStatus = (newStatus: Status) => {
    statusRef.current = newStatus
    setStatus(newStatus)
  }

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  const formatCode = (input: string): string => {
    const cleaned = input.replace(/-/g, "").toUpperCase()
    if (cleaned.length > 4) {
      return cleaned.slice(0, 4) + "-" + cleaned.slice(4)
    }
    return cleaned
  }

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCode(e.target.value)
    setCode(formatted)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    completedRef.current = false

    const cleanCode = code.replace(/-/g, "")
    if (!/^[A-Z0-9]{8}$/.test(cleanCode)) {
      setError("Please enter a valid 8-character code (letters and numbers only)")
      return
    }

    if (!browserSupportsWebAuthn()) {
      setError("WebAuthn is not supported")
      return
    }

    const token = getToken()
    if (!token) {
      setError("You must be logged in to add a passkey")
      updateStatus("error")
      return
    }

    try {
      updateStatus("authenticating")

      const beginResp = await fetch('/api/v1/auth/passkeys/auth-begin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      })
      
      if (!beginResp.ok) {
        throw new Error('Failed to get authentication options')
      }

      const { options: authOptions, sessionKey: sessKey }: AuthBeginResponse = await beginResp.json()

      const opts = authOptions as { publicKey: { challenge: string; allowCredentials?: { id: string }[]; rpId?: string; extensions?: Record<string, unknown> } }

      const pkOpts = opts.publicKey

      // Add PRF extension with proper ArrayBuffer salt
      const prfSalt = getPrfSalt()
      // Create a new ArrayBuffer to be safe in case getPrfSalt returns a view of a larger buffer
      const prfSaltBuffer = prfSalt.buffer.slice(
        prfSalt.byteOffset,
        prfSalt.byteOffset + prfSalt.byteLength
      )
      const mappedAllowCredentials = pkOpts.allowCredentials?.map(cred => ({
        ...cred,
        id: decodeBase64URL(cred.id)
      }))
      const adjustedOptions = {
        ...pkOpts,
        challenge: decodeBase64URL(pkOpts.challenge),
        allowCredentials: mappedAllowCredentials,
        extensions: {
          ...pkOpts.extensions,
          // evalByCredential so Safari/iOS returns the enrollment-time PRF (a bare
          // eval with multiple allowCredentials mismatches -> OperationError).
          prf: buildPrfGetExtension(
            (mappedAllowCredentials ?? []).map(c => c.id as ArrayBuffer),
            prfSaltBuffer
          )
        }
      }

      const assertion = await navigator.credentials.get({ publicKey: adjustedOptions as unknown as PublicKeyCredentialRequestOptions })

      if (!assertion) {
        throw new Error('No credential returned')
      }

      const credential = assertion as PublicKeyCredential
      const response = credential.response as AuthenticatorAssertionResponse
      
      // The server (go-webauthn) expects userHandle base64url-encoded. Encode the
      // raw handle bytes directly; UTF-8 decoding here would send an unparseable
      // value for discoverable credentials (e.g. iOS passkeys used as Machine A).
      let userHandleStr: string | null = null
      if (response.userHandle) {
        userHandleStr = encodeBase64URL(new Uint8Array(response.userHandle))
      }
      
      const credJSON = {
        id: credential.id,
        rawId: bufferToBase64URLString(credential.rawId),
        response: {
          clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
          authenticatorData: bufferToBase64URLString(response.authenticatorData),
          signature: bufferToBase64URLString(response.signature),
          userHandle: userHandleStr
        },
        type: 'public-key',
        clientExtensionResults: (credential as unknown as { getClientExtensionResults?: () => unknown }).getClientExtensionResults?.() || {}
      }

      const finishResp = await fetch('/api/v1/auth/passkeys/auth-finish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          session_key: sessKey,
          credential: credJSON
        })
      })

      if (!finishResp.ok) {
        throw new Error('Authentication verification failed')
      }

      const extResults = (credential as unknown as { getClientExtensionResults?: () => unknown }).getClientExtensionResults?.() as Record<string, unknown> | undefined
      let prfResults: Uint8Array | null = null

      if (extResults?.prf) {
        const prfExt = extResults.prf as { results?: { first?: ArrayBuffer | Uint8Array } }
        if (prfExt.results?.first) {
          const prfFirst = prfExt.results.first
          if (prfFirst instanceof ArrayBuffer) {
            prfResults = new Uint8Array(prfFirst)
          } else if (prfFirst) {
            prfResults = new Uint8Array(prfFirst)
          }
        }
      }

      let prfKeyDerived: Uint8Array | null = null
      if (prfResults && prfResults.length > 0) {
        prfKeyDerived = await deriveMasterKeyFromPrf(prfResults)
      }

      updateStatus("connecting")

      const wsURL = getEnrollmentWebSocketURL(cleanCode, token)
      const ws = new WebSocket(wsURL)
      wsRef.current = ws

      // Best-effort relay of a failure to the peer (Machine B) so it doesn't
      // hang waiting for a payload that will never arrive.
      const sendPeerError = (message: string) => {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", message }))
          }
        } catch {
          // best effort only
        }
      }

      ws.onopen = () => {
        updateStatus("handshaking")
      }

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data)

          if (msg.type === "error") {
            // The other device reported a failure (e.g. its authenticator
            // rejected the WebAuthn ceremony). Surface it instead of hanging.
            setError(msg.message || "The other device reported an error")
            updateStatus("error")
            ws.close()
            return
          }

          if (msg.type === "spake2_b") {
            const otherMsg = decodeMessage(msg.message)

            const { state, message: spake2Msg } = await spake2Init(cleanCode, true)

            const result = await spake2Finish(state, otherMsg)
            const key = await deriveKey(new Uint8Array(result.sharedSecret), "encryption-key")
            sessionKeyRef.current = key

            ws.send(JSON.stringify({
              type: "spake2_a",
              message: encodeMessage(spake2Msg)
            }))

            updateStatus("transferring")

            try {
              if (!prfKeyDerived) {
                throw new Error("No PRF key available for decrypting master key")
              }
              // This passkey may have a wrapped master key per device (synced
              // passkeys have a device-specific PRF). Try each blob with this
              // device's PRF; the AES-GCM tag validates the one wrapped here.
              const credentialId = encodeBase64URL(new Uint8Array(credential.rawId))
              const { blobs } = await getMasterKey(credentialId)
              let decryptedMasterKey: Uint8Array | null = null
              for (const blob of blobs) {
                try {
                  const { data } = parseEncryptedMasterKey(decodeBase64(blob))
                  decryptedMasterKey = await decrypt(prfKeyDerived, data.slice(0, 12), data.slice(12))
                  break
                } catch {
                  // Wrong device's blob — try the next.
                }
              }
              if (!decryptedMasterKey) {
                throw new Error("This device can't unlock the master key with this passkey.")
              }

              const { ciphertext, nonce } = await encrypt(key, decryptedMasterKey)

              ws.send(JSON.stringify({
                type: "encrypted_payload",
                nonce: encodeBase64(nonce),
                ciphertext: encodeBase64(ciphertext)
              }))
            } catch (err) {
              console.error("Failed to transfer master key:", err)
              const message = err instanceof Error ? err.message : "Failed to transfer master key"
              setError(message)
              updateStatus("error")
              sendPeerError(message)
              ws.close()
            }
          } else if (msg.type === "encrypted_payload") {
            if (!sessionKeyRef.current) {
              throw new Error("Session key not available")
            }

            const nonce = decodeBase64(msg.nonce)
            const ciphertext = decodeBase64(msg.ciphertext)

            const decrypted = await decrypt(sessionKeyRef.current, nonce, ciphertext)
            const decoded = new TextDecoder().decode(decrypted)

            if (decoded === "received") {
              completedRef.current = true
              updateStatus("success")
              ws.close()
            }
          }
        } catch (err) {
          console.error("WebSocket error:", err)
          setError("Connection error")
          updateStatus("error")
        }
      }

      ws.onerror = () => {
        setError("Connection failed")
        updateStatus("error")
      }

      ws.onclose = () => {
        if (!completedRef.current && statusRef.current !== "error") {
          setError("Connection closed unexpectedly")
          updateStatus("error")
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred")
      updateStatus("error")
    }
  }

  const handleCancel = () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    updateStatus("idle")
    sessionKeyRef.current = null
    completedRef.current = false
  }

  const serverUrl = typeof window !== "undefined" ? window.location.origin : ""

  const isIdleOrError = status === "idle" || status === "error"
  const isInProgress = status === "authenticating" || status === "connecting" || status === "handshaking" || status === "transferring"

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Add Passkey</CardTitle>
          <CardDescription>
            Add a passkey from another device to your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="p-3 rounded-md bg-yellow-10 border border-yellow-20">
              <p className="text-sm text-yellow-800 font-medium">Only enter codes from devices YOU control</p>
            </div>

            <div className="p-3 rounded-md bg-muted">
              <p className="text-sm text-muted-foreground">
                On the other device, visit: <br />
                <code className="text-xs bg-muted-foreground/20 px-1 rounded">{serverUrl}/passkeys/enroll</code>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="code">Enrollment Code</Label>
              <Input
                id="code"
                type="text"
                placeholder="XXXX-XXXX"
                value={code}
                onChange={handleCodeChange}
                maxLength={9}
                disabled={!isIdleOrError}
                required
                // Match the display font on the other device so the typed code
                // reads the same — JetBrains Mono with a slashed zero (0 vs O).
                style={{
                  fontFamily: '"JetBrainsMono Nerd Font Mono", ui-monospace, monospace',
                  fontFeatureSettings: '"zero" 1',
                }}
              />
            </div>

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            {!isIdleOrError && status !== "success" && (
              <div className="p-3 rounded-md bg-muted">
                <p className="text-sm text-center">
                  {status === "authenticating" && "Verifying your identity..."}
                  {status === "connecting" && "Connecting to other device..."}
                  {status === "handshaking" && "Performing key exchange..."}
                  {status === "transferring" && "Transferring master key..."}
                </p>
              </div>
            )}

            {status === "success" && (
              <div className="p-3 rounded-md bg-green-10 border border-green-20">
                <p className="text-sm text-green-800 font-medium">Passkey added successfully!</p>
              </div>
            )}

            {isIdleOrError && (
              <Button
                type="submit"
                className="w-full"
                disabled={isInProgress}
              >
                {status === "error" ? "Retry" : "Link Device"}
              </Button>
            )}

            {!isIdleOrError && status !== "success" && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleCancel}
              >
                Cancel
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
