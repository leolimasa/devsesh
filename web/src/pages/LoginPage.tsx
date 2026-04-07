import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { startAuthentication } from "@simplewebauthn/browser"
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { checkUsersExist, loginBegin, loginFinish } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [noUsers, setNoUsers] = useState(false)
  const navigate = useNavigate()
  const { login } = useAuth()

  useEffect(() => {
    checkUsersExist()
      .then((status) => {
        setNoUsers(!status.exists)
      })
      .catch(() => {
        setNoUsers(false)
      })
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const response = await loginBegin(email) as { publicKey: PublicKeyCredentialRequestOptionsJSON }
      const credential = await startAuthentication(response.publicKey)
      const result = await loginFinish(email, credential)

      login(result.token, { id: 0, email, token: result.token })
      navigate("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Sign In</CardTitle>
          <CardDescription>
            Enter your email to sign in with your passkey
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
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
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in with Passkey"}
            </Button>
            {noUsers && (
              <p className="text-sm text-center text-muted-foreground">
                No users found.{" "}
                <a href="/register" className="text-primary hover:underline">
                  Create an account
                </a>
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}