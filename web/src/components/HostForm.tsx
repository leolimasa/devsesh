import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { Host } from "@/types/api"

interface HostFormProps {
  host?: Host
  onSubmit: (host: { label: string; hostname: string }) => void
  onCancel?: () => void
  submitLabel?: string
}

export function HostForm({ host, onSubmit, onCancel, submitLabel = "Save" }: HostFormProps) {
  const [label, setLabel] = useState(host?.label || "")
  const [hostname, setHostname] = useState(host?.hostname || "")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    if (!label.trim()) {
      setError("Label is required")
      setIsLoading(false)
      return
    }
    if (!hostname.trim()) {
      setError("Hostname is required")
      setIsLoading(false)
      return
    }

    try {
      await onSubmit({ label: label.trim(), hostname: hostname.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="host-label" className="block text-sm font-medium mb-1">
          Label
        </label>
        <Input
          id="host-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g., My Laptop"
          disabled={isLoading}
        />
      </div>
      <div>
        <label htmlFor="host-hostname" className="block text-sm font-medium mb-1">
          Hostname
        </label>
        <Input
          id="host-hostname"
          type="text"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="e.g., laptop.local or 192.168.1.100"
          disabled={isLoading}
        />
      </div>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Saving..." : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}