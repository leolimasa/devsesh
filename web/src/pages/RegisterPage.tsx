import { useState, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { browserSupportsWebAuthn, bufferToBase64URLString } from "@simplewebauthn/browser"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { registerBegin, registerFinish, updateSSHCAClientShare } from "@/lib/api"
import { generateMasterKey, deriveMasterKeyFromPrf, encodeBase64, formatEncryptedMasterKey, getPrfSalt, decodeBase64URL, decodeBase64 } from "@/lib/crypto/prf"
import { encrypt } from "@/lib/crypto/aes"
import { useAuth } from "@/contexts/AuthContext"

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
  const { login } = useAuth()

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
      // Create a new ArrayBuffer to be safe in case getPrfSalt returns a view of a larger buffer
      const prfSaltBuffer = prfSalt.buffer.slice(
        prfSalt.byteOffset,
        prfSalt.byteOffset + prfSalt.byteLength
      )

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
              first: prfSaltBuffer
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

      // Debug: log credential ID
      console.log('[RegisterPage] credential.id:', credential.id)
      console.log('[RegisterPage] credential.rawId length:', credential.rawId.byteLength)

      // Extract PRF extension results
      const extResults = credential.getClientExtensionResults() as {
        prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
      }

      let encryptedMasterKey: string
      const masterKey = generateMasterKey()
      let prfOutput: Uint8Array | null = null

      // Always use get() to obtain PRF output for consistency with login flow.
      // Even if create() returns PRF results, some authenticators (including Chromium's
      // virtual authenticator) may produce different PRF outputs between create() and get().
      // By always using get(), we ensure the same PRF derivation path is used for both
      // registration and login, guaranteeing consistent master key derivation.
      if (extResults?.prf?.enabled || extResults?.prf?.results?.first) {
        // PRF is supported but results weren't returned during create()
        // This is common for hardware security keys - we need to do a get() call
        // to actually get the PRF output

        const rpIdToUse = pubKey.rp.id || window.location.hostname
        console.log('[RegisterPage] PRF get() rpId:', rpIdToUse)
        console.log('[RegisterPage] PRF salt length:', prfSalt.length)

        const assertionOptions: PublicKeyCredentialRequestOptions = {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: rpIdToUse,
          allowCredentials: [{
            id: credential.rawId,
            type: 'public-key' as const,
          }],
          userVerification: 'required',
          extensions: {
            prf: {
              eval: {
                first: prfSaltBuffer
              }
            }
          } as AuthenticationExtensionsClientInputs
        }

        console.log('[RegisterPage] Calling get() for PRF output...')
        const assertion = await navigator.credentials.get({ publicKey: assertionOptions })
        console.log('[RegisterPage] PRF get() completed')
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
        // PRF not available - REQUIRED for security
        throw new Error('WebAuthn PRF extension is required for registration. Your authenticator must support the PRF/hmac-secret extension.')
      }

      // Derive encryption key from PRF output
      console.log('[RegisterPage] PRF output first 4 bytes:', Array.from(prfOutput.slice(0, 4)).join(','))
      const prfKey = await deriveMasterKeyFromPrf(prfOutput)
      console.log('[RegisterPage] Derived prfKey first 4 bytes:', Array.from(prfKey.slice(0, 4)).join(','))
      console.log('[RegisterPage] masterKey first 4 bytes:', Array.from(masterKey.slice(0, 4)).join(','))

      // Encrypt the master key
      const { nonce, ciphertext } = await encrypt(prfKey, masterKey)
      console.log('[RegisterPage] Encryption nonce first 4 bytes:', Array.from(nonce.slice(0, 4)).join(','))

      // Combine nonce + ciphertext with version byte
      const combined = new Uint8Array(12 + ciphertext.length)
      combined.set(nonce, 0)
      combined.set(ciphertext, 12)
      const versioned = formatEncryptedMasterKey(combined)
      encryptedMasterKey = encodeBase64(versioned)

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

      const registerResponse = await registerFinish(email, credentialJSON, encryptedMasterKey)

      // Auto-login with the token returned from registration
      if (!registerResponse.token) {
        throw new Error("Registration succeeded but no token was returned")
      }
      login(registerResponse.token, { id: 0, email, token: registerResponse.token })

      // If the server returned a client share, encrypt it with the master key and upload it
      if (registerResponse.client_share) {
        // Decode the plaintext client share
        const clientShareBytes = decodeBase64(registerResponse.client_share)
        console.log('[RegisterPage] Plaintext client share length:', clientShareBytes.length)
        console.log('[RegisterPage] Plaintext client share first 4 bytes:', Array.from(clientShareBytes.slice(0, 4)).join(','))

        // Encrypt the client share with the master key
        const { nonce: shareNonce, ciphertext: shareCiphertext } = await encrypt(masterKey, clientShareBytes)
        console.log('[RegisterPage] Client share encryption nonce first 4 bytes:', Array.from(shareNonce.slice(0, 4)).join(','))
        console.log('[RegisterPage] Client share ciphertext length:', shareCiphertext.length)

        // Combine nonce + ciphertext
        const encryptedShare = new Uint8Array(12 + shareCiphertext.length)
        encryptedShare.set(shareNonce, 0)
        encryptedShare.set(shareCiphertext, 12)

        // Upload the encrypted client share to the server immediately (we're now logged in)
        await updateSSHCAClientShare(encodeBase64(encryptedShare))
      }

      navigate("/dashboard")
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
              <Link to="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
