import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { pairExchange, listHosts } from "@/lib/api"
import type { Host } from "@/types/api"

export default function PairPage() {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hosts, setHosts] = useState<Host[]>([])
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null)
  const [showNewHost, setShowNewHost] = useState(false)
  const [newHostLabel, setNewHostLabel] = useState("")
  const [newHostHostname, setNewHostHostname] = useState("")
  const navigate = useNavigate()

  useEffect(() => {
    loadHosts()
  }, [])

  async function loadHosts() {
    try {
      const data = await listHosts()
      setHosts(data)
    } catch (err) {
      console.error("Failed to load hosts:", err)
    }
  }

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      if (showNewHost) {
        if (!newHostLabel.trim() || !newHostHostname.trim()) {
          setError("Label and hostname are required")
          setLoading(false)
          return
        }
        await pairExchange(code, undefined, { label: newHostLabel.trim(), hostname: newHostHostname.trim() })
      } else if (selectedHostId) {
        await pairExchange(code, selectedHostId, undefined)
      } else {
        setError("Please select or create a host")
        setLoading(false)
        return
      }
      setSuccess(true)
      setTimeout(() => navigate("/dashboard"), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed")
    } finally {
      setLoading(false)
    }
  }

  const canPair = code.length === 6 && (selectedHostId !== null || showNewHost)

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

            <div className="space-y-2">
              <Label htmlFor="host">Host</Label>
              {!showNewHost ? (
                <div className="space-y-2">
                  <select
                    id="host"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={selectedHostId || ""}
                    onChange={(e) => setSelectedHostId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Select a host...</option>
                    {hosts.map((host) => (
                      <option key={host.id} value={host.id}>
                        {host.label} ({host.hostname})
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowNewHost(true)}
                  >
                    Create New Host
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    type="text"
                    placeholder="Label (e.g., My Laptop)"
                    value={newHostLabel}
                    onChange={(e) => setNewHostLabel(e.target.value)}
                  />
                  <Input
                    type="text"
                    placeholder="Hostname (e.g., laptop.local)"
                    value={newHostHostname}
                    onChange={(e) => setNewHostHostname(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setShowNewHost(false)
                      setNewHostLabel("")
                      setNewHostHostname("")
                    }}
                  >
                    Use Existing Host
                  </Button>
                </div>
              )}
            </div>

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
            {success && (
              <p className="text-sm text-green-500 text-center">
                Device paired successfully! Redirecting to dashboard...
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading || success || !canPair}>
              {loading ? "Pairing..." : "Pair Device"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}