import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser"
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { registerBegin, registerFinish } from "@/lib/api"
import { generateMasterKey, deriveMasterKeyFromPrf, encodeBase64 } from "@/lib/crypto/prf"
import { encrypt } from "@/lib/crypto/aes"

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
      const response = await registerBegin(email) as { publicKey: PublicKeyCredentialCreationOptionsJSON }

      const pubKey = response.publicKey

      const credential = await startRegistration(pubKey)

      const masterKey = generateMasterKey()

      // Try to get PRF extension results to encrypt the master key
      const extResults = credential.clientExtensionResults as Record<string, unknown> | undefined
      let encryptedMasterKey: string

      if (extResults?.prf) {
        const prfExt = extResults.prf as { results?: { first?: ArrayBuffer | Uint8Array } }
        if (prfExt.results?.first) {
          const prfFirst = prfExt.results.first
          const prfOutput = prfFirst instanceof ArrayBuffer
            ? new Uint8Array(prfFirst)
            : new Uint8Array(prfFirst)

          // Derive encryption key from PRF output
          const prfKey = await deriveMasterKeyFromPrf(prfOutput)

          // Encrypt the master key
          const { nonce, ciphertext } = await encrypt(prfKey, masterKey)

          // Combine nonce + ciphertext
          const combined = new Uint8Array(12 + ciphertext.length)
          combined.set(nonce, 0)
          combined.set(ciphertext, 12)
          encryptedMasterKey = encodeBase64(combined)
        } else {
          // PRF not available, send master key as-is (will work but less secure)
          // This fallback is for devices that don't support PRF
          encryptedMasterKey = encodeBase64(masterKey)
        }
      } else {
        // PRF not available, send master key as-is
        encryptedMasterKey = encodeBase64(masterKey)
      }

      await registerFinish(email, credential, encryptedMasterKey)
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
