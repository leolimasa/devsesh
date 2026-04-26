import { useState, useEffect, useRef } from "react"
import { browserSupportsWebAuthn } from "@simplewebauthn/browser"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { getToken, getMasterKey, getEnrollmentWebSocketURL } from "@/lib/api"
import { spake2Init, spake2Finish, encodeMessage, decodeMessage } from "@/lib/crypto/spake2"
import { deriveKey, encrypt, decrypt } from "@/lib/crypto/aes"
import { deriveMasterKeyFromPrf, decodeBase64, encodeBase64 } from "@/lib/crypto/prf"

type Status = "idle" | "authenticating" | "connecting" | "handshaking" | "transferring" | "success" | "error"

interface AuthBeginResponse {
  options: unknown
  sessionKey: string
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) {
    binary += String.fromCharCode(b)
  }
  return btoa(binary)
}

export default function AddPasskeyPage() {
  const [code, setCode] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState("")
  const wsRef = useRef<WebSocket | null>(null)
  const sessionKeyRef = useRef<Uint8Array | null>(null)
  const completedRef = useRef(false)

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
      setStatus("error")
      return
    }

    try {
      setStatus("authenticating")

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

      const opts = authOptions as { challenge: string; allowCredentials?: { id: string }[]; rpId?: string }

      const adjustedOptions = {
        ...opts,
        challenge: base64ToUint8Array(opts.challenge),
        allowCredentials: opts.allowCredentials?.map(cred => ({
          ...cred,
          id: base64ToUint8Array(cred.id)
        }))
      }

      const assertion = await navigator.credentials.get({ publicKey: adjustedOptions as unknown as PublicKeyCredentialRequestOptions })

      if (!assertion) {
        throw new Error('No credential returned')
      }

      const credential = assertion as PublicKeyCredential

      const clientDataJSON = await (credential.response as AuthenticatorAssertionResponse).clientDataJSON
      const authenticatorData = new Uint8Array((credential.response as AuthenticatorAssertionResponse).authenticatorData)
      const signature = new Uint8Array((credential.response as AuthenticatorAssertionResponse).signature)
      const userHandle = (credential.response as AuthenticatorAssertionResponse).userHandle ?
        new Uint8Array((credential.response as AuthenticatorAssertionResponse).userHandle!) : null

      const credJSON = {
        id: credential.id,
        rawId: uint8ArrayToBase64(new Uint8Array(credential.rawId)),
        response: {
          clientDataJSON: uint8ArrayToBase64(new Uint8Array(clientDataJSON)),
          authenticatorData: uint8ArrayToBase64(authenticatorData),
          signature: uint8ArrayToBase64(signature),
          userHandle: userHandle ? uint8ArrayToBase64(userHandle) : null
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

      setStatus("connecting")

      const wsURL = getEnrollmentWebSocketURL(cleanCode, token)
      const ws = new WebSocket(wsURL)
      wsRef.current = ws

      ws.onopen = () => {
        setStatus("handshaking")
      }

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data)

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

            setStatus("transferring")

            try {
              const masterKeyResp = await getMasterKey()
              const encryptedMasterKeyBytes = decodeBase64(masterKeyResp.encrypted_master_key)

              let decryptedMasterKey: Uint8Array
              if (prfKeyDerived) {
                decryptedMasterKey = await decrypt(prfKeyDerived, encryptedMasterKeyBytes.slice(0, 12), encryptedMasterKeyBytes.slice(12))
              } else {
                throw new Error("No PRF key available")
              }

              const { ciphertext, nonce } = await encrypt(key, decryptedMasterKey)

              ws.send(JSON.stringify({
                type: "encrypted_payload",
                nonce: encodeBase64(nonce),
                ciphertext: encodeBase64(ciphertext)
              }))
            } catch (err) {
              console.error("Failed to transfer master key:", err)
              setError("Failed to transfer master key")
              setStatus("error")
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
              setStatus("success")
              ws.close()
            }
          }
        } catch (err) {
          console.error("WebSocket error:", err)
          setError("Connection error")
          setStatus("error")
        }
      }

      ws.onerror = () => {
        setError("Connection failed")
        setStatus("error")
      }

      ws.onclose = () => {
        if (!completedRef.current && status !== "error") {
          setError("Connection closed unexpectedly")
          setStatus("error")
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred")
      setStatus("error")
    }
  }

  const handleCancel = () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setStatus("idle")
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
