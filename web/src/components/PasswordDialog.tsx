import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface PasswordDialogProps {
  isOpen: boolean
  username: string
  onSubmit: (password: string) => void
  onCancel: () => void
}

export function PasswordDialog({ isOpen, username, onSubmit, onCancel }: PasswordDialogProps) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim()) {
      setError("Password is required")
      return
    }
    onSubmit(password)
    setPassword("")
    setError("")
  }

  const handleCancel = () => {
    setPassword("")
    setError("")
    onCancel()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 w-96 shadow-lg">
        <h2 className="text-lg font-semibold mb-4">SSH Password Authentication</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Username</label>
            <Input value={username} disabled className="bg-muted" />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
            />
            {error && <p className="text-sm text-destructive mt-1">{error}</p>}
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit">Connect</Button>
          </div>
        </form>
      </div>
    </div>
  )
}