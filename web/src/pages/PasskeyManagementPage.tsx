import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { startRegistration } from "@simplewebauthn/browser"
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { listPasskeys, addPasskeyBegin, addPasskeyFinish, deletePasskey } from "@/lib/api"
import type { Passkey } from "@/types/api"

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString()
}

export default function PasskeyManagementPage() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const navigate = useNavigate()

  const loadPasskeys = async () => {
    try {
      const data = await listPasskeys()
      setPasskeys(data)
    } catch (err) {
      console.error("Failed to load passkeys:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPasskeys()
  }, [])

  const handleAddPasskey = async () => {
    setAdding(true)
    setError("")
    try {
      const options = await addPasskeyBegin()
      const credential = await startRegistration(options as PublicKeyCredentialCreationOptionsJSON)
      await addPasskeyFinish(credential)
      await loadPasskeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add passkey")
    } finally {
      setAdding(false)
    }
  }

  const handleDeletePasskey = async () => {
    if (!deletingId) return
    try {
      await deletePasskey(deletingId)
      await loadPasskeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete passkey")
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen p-4">
        <Card className="max-w-2xl mx-auto">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Loading passkeys...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            Back
          </Button>
          <h1 className="text-2xl font-bold">Passkey Management</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Your Passkeys</CardTitle>
            <CardDescription>
              Manage the passkeys associated with your account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            {passkeys.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No passkeys found</p>
            ) : (
              <div className="space-y-2">
                {passkeys.map((passkey) => (
                  <div
                    key={passkey.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div>
                      <p className="font-mono text-sm">{passkey.id.substring(0, 8)}...</p>
                      <p className="text-xs text-muted-foreground">
                        Created: {formatDate(passkey.created_at)}
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setDeletingId(passkey.id)}
                      disabled={passkeys.length <= 1}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Button onClick={handleAddPasskey} disabled={adding}>
              {adding ? "Adding..." : "Add Passkey"}
            </Button>
          </CardContent>
        </Card>

        <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Passkey</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this passkey? This action cannot be undone.
                Note: You must have at least one passkey associated with your account.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeletePasskey}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}