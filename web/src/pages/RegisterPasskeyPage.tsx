import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser"
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createPasskeyEnrollment, enrollmentBegin, enrollmentComplete, getEnrollmentWebSocketURL } from "@/lib/api"
import { spake2InitB, spake2Finish, encodeMessage, decodeMessage } from "@/lib/crypto/spake2"
import { deriveKey, encrypt, decrypt } from "@/lib/crypto/aes"
import { encodeBase64, decodeBase64, deriveMasterKeyFromPrf } from "@/lib/crypto/prf"

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

                  const beginResp = await enrollmentBegin(enrollmentCode)
                  const options = (beginResp as { publicKey: PublicKeyCredentialCreationOptionsJSON }).publicKey

                  const credential = await startRegistration(options as PublicKeyCredentialCreationOptionsJSON)

                  const extResults = (credential as unknown as { getClientExtensionResults?: () => unknown }).getClientExtensionResults?.() as Record<string, unknown> | undefined
                  let prfResults: Uint8Array | null = null

                  if (extResults?.prf) {
                    const prfExt = extResults.prf as { enabled?: boolean; results?: { first?: ArrayBuffer | Uint8Array } }
                    if (prfExt.enabled) {
                      const getOptions = {
                        publicKey: {
                          challenge: options.challenge,
                          rpId: options.rp.id,
                          extensions: {
                            prf: {
                              eval: {
                                first: btoa(String.fromCharCode(...new TextEncoder().encode('devsesh-master-key-v1')))
                              }
                            }
                          }
                        }
                      }

                      try {
                        const assertion = await navigator.credentials.get(getOptions as unknown as CredentialRequestOptions)
                        const assertExtResults = (assertion as unknown as { getClientExtensionResults?: () => unknown }).getClientExtensionResults?.() as Record<string, unknown> | undefined
                        if (assertExtResults?.prf) {
                          const prfOut = assertExtResults.prf as { results?: { first?: ArrayBuffer | Uint8Array } }
                          if (prfOut.results?.first) {
                            const prfFirst = prfOut.results.first
                            if (prfFirst instanceof ArrayBuffer) {
                              prfResults = new Uint8Array(prfFirst)
                            } else if (prfFirst) {
                              prfResults = new Uint8Array(prfFirst)
                            }
                          }
                        }
                      } catch (e) {
                        console.warn('Could not get PRF results:', e)
                      }
                    }
                  }

                  if (!masterKeyRef.current) {
                    throw new Error("Master key not available")
                  }

                  let newMasterKey: Uint8Array
                  if (prfResults && prfResults.length > 0) {
                    const prfKey = await deriveMasterKeyFromPrf(prfResults)
                    const encrypted = await encrypt(prfKey, masterKeyRef.current)
                    newMasterKey = new Uint8Array(12 + encrypted.ciphertext.length)
                    newMasterKey.set(encrypted.nonce, 0)
                    newMasterKey.set(encrypted.ciphertext, 12)
                  } else {
                    newMasterKey = masterKeyRef.current
                  }

                  await enrollmentComplete(enrollmentCode, credential, encodeBase64(newMasterKey))

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
        if (status !== "success" && status !== "error") {
          setStatus("error")
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start enrollment")
      setStatus("error")
    }
  }

  const handleCancel = () => {
    if (wsRef.current) wsRef.current.close()
    if (timerRef.current) clearInterval(timerRef.current)
    setStatus("idle")
    setCode("")
    setExpiresAt(null)
    setTimeLeft(300)
    sessionKeyRef.current = null
    masterKeyRef.current = null
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
