import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { Host } from "@/types/api"

interface HostFormProps {
  host?: Host
  onSubmit: (host: { label: string; hostname: string; ssh_user?: string; ssh_port?: number; ssh_principal?: string }) => void
  onCancel?: () => void
  submitLabel?: string
}

export function HostForm({ host, onSubmit, onCancel, submitLabel = "Save" }: HostFormProps) {
  const [label, setLabel] = useState(host?.label || "")
  const [hostname, setHostname] = useState(host?.hostname || "")
  const [sshUser, setSSHUser] = useState(host?.ssh_user || "")
  const [sshPort, setSSHPort] = useState(host?.ssh_port || 22)
  const [sshPrincipal, setSSHPrincipal] = useState(host?.ssh_principal || "")
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
      await onSubmit({
        label: label.trim(),
        hostname: hostname.trim(),
        ssh_user: sshUser.trim() || undefined,
        ssh_port: sshPort || undefined,
        ssh_principal: sshPrincipal.trim() || undefined
      })
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
      <div>
        <label htmlFor="host-ssh-user" className="block text-sm font-medium mb-1">
          SSH User
        </label>
        <Input
          id="host-ssh-user"
          type="text"
          value={sshUser}
          onChange={(e) => setSSHUser(e.target.value)}
          placeholder="e.g., ubuntu (optional)"
          disabled={isLoading}
        />
      </div>
      <div>
        <label htmlFor="host-ssh-port" className="block text-sm font-medium mb-1">
          SSH Port
        </label>
        <Input
          id="host-ssh-port"
          type="number"
          value={sshPort}
          onChange={(e) => setSSHPort(parseInt(e.target.value) || 22)}
          placeholder="22"
          disabled={isLoading}
        />
      </div>
      <div>
        <label htmlFor="host-ssh-principal" className="block text-sm font-medium mb-1">
          SSH Principal
        </label>
        <Input
          id="host-ssh-principal"
          type="text"
          value={sshPrincipal}
          onChange={(e) => setSSHPrincipal(e.target.value)}
          placeholder="e.g., ubuntu (for CA auth, defaults to SSH User)"
          disabled={isLoading}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Principal for SSH certificate authentication. If not set, SSH User is used.
        </p>
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