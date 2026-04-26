import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { browserSupportsWebAuthn, bufferToBase64URLString } from "@simplewebauthn/browser"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { registerBegin, registerFinish } from "@/lib/api"
import { generateMasterKey, deriveMasterKeyFromPrf, encodeBase64, formatEncryptedMasterKey, getPrfSalt, decodeBase64URL } from "@/lib/crypto/prf"
import { encrypt } from "@/lib/crypto/aes"

// Convert base64url to ArrayBuffer
function base64urlToBuffer(base64url: string): ArrayBuffer {
  return decodeBase64URL(base64url).buffer
}

export default function RegisterPage() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [webAuthnSupported, setWebAuthnSupported] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    setWebAuthnSupported(browserSupportsWebAuthn())
  }, [])

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    if (!browserSupportsWebAuthn()) {
      setError("WebAuthn is not supported. Please use HTTPS or localhost.")
      setLoading(false)
      return
    }

    try {
      // Get registration options from server
      const response = await registerBegin(email) as {
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

      const pubKey = response.publicKey
      const prfSalt = getPrfSalt()

      // Convert JSON options to native WebAuthn format
      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        challenge: base64urlToBuffer(pubKey.challenge),
        rp: pubKey.rp,
        user: {
          id: base64urlToBuffer(pubKey.user.id),
          name: pubKey.user.name,
          displayName: pubKey.user.displayName
        },
        pubKeyCredParams: pubKey.pubKeyCredParams.map(p => ({
          type: p.type as PublicKeyCredentialType,
          alg: p.alg
        })),
        timeout: pubKey.timeout,
        excludeCredentials: pubKey.excludeCredentials?.map(c => ({
          id: base64urlToBuffer(c.id),
          type: c.type as PublicKeyCredentialType,
          transports: c.transports as AuthenticatorTransport[] | undefined
        })),
        authenticatorSelection: pubKey.authenticatorSelection as AuthenticatorSelectionCriteria,
        attestation: pubKey.attestation as AttestationConveyancePreference,
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

      let encryptedMasterKey: string
      const masterKey = generateMasterKey()

      if (extResults?.prf?.results?.first) {
        const prfOutput = new Uint8Array(extResults.prf.results.first)

        // Derive encryption key from PRF output
        const prfKey = await deriveMasterKeyFromPrf(prfOutput)

        // Encrypt the master key
        const { nonce, ciphertext } = await encrypt(prfKey, masterKey)

        // Combine nonce + ciphertext with version byte
        const combined = new Uint8Array(12 + ciphertext.length)
        combined.set(nonce, 0)
        combined.set(ciphertext, 12)
        const versioned = formatEncryptedMasterKey(combined)
        encryptedMasterKey = encodeBase64(versioned)
      } else {
        // PRF not available - REQUIRED for security
        throw new Error('WebAuthn PRF extension is required for registration')
      }

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
        authenticatorAttachment: (credential as any).authenticatorAttachment,
      }

      await registerFinish(email, credentialJSON, encryptedMasterKey)
      navigate("/login")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Create Account</CardTitle>
          <CardDescription>
            Enter your email to create a new account with a passkey
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister} className="space-y-4">
            {!webAuthnSupported && (
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive font-medium">WebAuthn is not supported</p>
                <p className="text-xs text-destructive/80 mt-1">
                  Passkeys require a secure context (HTTPS or localhost). Please access this site via HTTPS or localhost.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading || !webAuthnSupported}>
              {loading ? "Creating account..." : "Create Account with Passkey"}
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              Already have an account?{" "}
              <a href="/login" className="text-primary hover:underline">
                Sign in
              </a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
