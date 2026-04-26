import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { browserSupportsWebAuthn, bufferToBase64URLString } from "@simplewebauthn/browser"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createPasskeyEnrollment, enrollmentBegin, enrollmentComplete, getEnrollmentWebSocketURL } from "@/lib/api"
import { spake2InitB, spake2Finish, encodeMessage, decodeMessage } from "@/lib/crypto/spake2"
import { deriveKey, encrypt, decrypt } from "@/lib/crypto/aes"
import { encodeBase64, decodeBase64, decodeBase64URL, deriveMasterKeyFromPrf, formatEncryptedMasterKey, getPrfSalt } from "@/lib/crypto/prf"

// Convert base64url to ArrayBuffer
function base64urlToBuffer(base64url: string): ArrayBuffer {
  return decodeBase64URL(base64url).buffer
}

type Status = "idle" | "waiting" | "handshaking" | "registering" | "success" | "error"

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
  const isCancellingRef = useRef(false)

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
          setStatus("error")
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
      setStatus("waiting")

      // getEnrollmentWebSocketURL already returns full URL with protocol
      const wsURL = getEnrollmentWebSocketURL(enrollmentCode)

      const ws = new WebSocket(wsURL)
      wsRef.current = ws

      const { state, message: spake2Msg } = await spake2InitB(enrollmentCode)

      ws.onopen = () => {
        setStatus("handshaking")
        ws.send(JSON.stringify({
          type: "spake2_b",
          message: encodeMessage(spake2Msg)
        }))
      }

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data)

          if (msg.type === "spake2_a") {
            const otherMsg = decodeMessage(msg.message)

            const result = await spake2Finish(state, otherMsg)
            const key = await deriveKey(new Uint8Array(result.sharedSecret), "encryption-key")
            sessionKeyRef.current = key

            setStatus("waiting")

            ws.onmessage = async (evt) => {
              const encryptedMsg = JSON.parse(evt.data)
              if (encryptedMsg.type === "encrypted_payload") {
                setStatus("registering")

                try {
                  if (!sessionKeyRef.current) {
                    throw new Error("Session key not available")
                  }

                  const nonce = decodeBase64(encryptedMsg.nonce)
                  const ciphertext = decodeBase64(encryptedMsg.ciphertext)

                  const decrypted = await decrypt(sessionKeyRef.current, nonce, ciphertext)
                  masterKeyRef.current = decrypted

                  const beginResp = await enrollmentBegin(enrollmentCode) as {
                    publicKey: {
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
                  }
                  const options = beginResp.publicKey
                  const prfSalt = getPrfSalt()

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
                          first: prfSalt.buffer
                        }
                      }
                    } as AuthenticationExtensionsClientInputs
                  }

                  // Call native WebAuthn API
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

                  if (!masterKeyRef.current) {
                    throw new Error("Master key not available")
                  }

                  if (!extResults?.prf?.results?.first) {
                    throw new Error('WebAuthn PRF extension is required for passkey registration')
                  }

                  const prfOutput = new Uint8Array(extResults.prf.results.first)
                  const prfKey = await deriveMasterKeyFromPrf(prfOutput)
                  const encrypted = await encrypt(prfKey, masterKeyRef.current)
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

                  await enrollmentComplete(enrollmentCode, credentialJSON, encodeBase64(newMasterKey))

                  // Actually encrypt the confirmation message with the session key
                  if (!sessionKeyRef.current) {
                    throw new Error("Session key not available for confirmation")
                  }
                  const confirmationData = new TextEncoder().encode("received")
                  const { nonce: confNonce, ciphertext: confCiphertext } = await encrypt(sessionKeyRef.current, confirmationData)

                  ws.send(JSON.stringify({
                    type: "encrypted_payload",
                    nonce: encodeBase64(confNonce),
                    ciphertext: encodeBase64(confCiphertext),
                  }))

                  setStatus("success")

                  setTimeout(() => {
                    navigate("/login")
                  }, 2000)
                } catch (err) {
                  console.error("Registration error:", err)
                  setError("Failed to complete registration")
                  setStatus("error")
                }
              }
            }
          }
        } catch (err) {
          console.error("Failed to process message:", err)
          setError("Failed to process message")
          setStatus("error")
        }
      }

      ws.onerror = () => {
        setError("Connection error")
        setStatus("error")
      }

      ws.onclose = () => {
        if (!isCancellingRef.current && status !== "success" && status !== "error") {
          setStatus("error")
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start enrollment")
      setStatus("error")
    }
  }

  const handleCancel = () => {
    isCancellingRef.current = true
    if (timerRef.current) clearInterval(timerRef.current)
    setStatus("idle")
    setCode("")
    setExpiresAt(null)
    setTimeLeft(300)
    sessionKeyRef.current = null
    masterKeyRef.current = null
    if (wsRef.current) wsRef.current.close()
  }

  const isInProgress = status === "waiting" || status === "handshaking" || status === "registering" || status === "error" || status === "success"

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

              {expiresAt && timeLeft > 0 && (
                <div className="text-center text-sm text-muted-foreground">
                  Expires in: {formatTime(timeLeft)}
                </div>
              )}

              <div className="p-3 rounded-md bg-muted text-center">
                {status === "waiting" && "Waiting for other device to connect..."}
                {status === "handshaking" && "Performing key exchange..."}
                {status === "registering" && "Creating passkey..."}
                {status === "success" && "Passkey registered successfully!"}
                {status === "error" && error}
              </div>

              <Button onClick={handleCancel} variant="outline" className="w-full">
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
