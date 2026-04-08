import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { pairExchange, pairComplete } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"

export default function PairPage() {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { login } = useAuth()

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      // First, exchange/approve the pairing code (requires JWT auth)
      await pairExchange(code)
      
      // Wait a moment for the code to be approved
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Then, get the JWT token from the CLI (no JWT auth needed)
      const result = await pairComplete(code)
      setSuccess(true)
      login(result.token, { id: 0, email: "", token: result.token })
      setTimeout(() => navigate("/dashboard"), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Pair Device</CardTitle>
          <CardDescription>
            Enter the pairing code from your CLI to connect your device
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePair} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Pairing Code</Label>
              <Input
                id="code"
                type="text"
                placeholder="ABC123"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={6}
                required
                className="text-center text-2xl tracking-widest font-mono"
              />
            </div>
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
            {success && (
              <p className="text-sm text-green-500 text-center">
                Device paired successfully! Redirecting to dashboard...
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading || success}>
              {loading ? "Pairing..." : "Pair Device"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}