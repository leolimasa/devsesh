import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { listHosts, createHost, updateHost, deleteHost } from "@/lib/api"
import { HostForm } from "@/components/HostForm"
import type { Host } from "@/types/api"

export default function HostsPage() {
  const [hosts, setHosts] = useState<Host[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [editingHost, setEditingHost] = useState<Host | null>(null)

  useEffect(() => {
    loadHosts()
  }, [])

  async function loadHosts() {
    try {
      setIsLoading(true)
      const data = await listHosts()
      setHosts(data)
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hosts")
    } finally {
      setIsLoading(false)
    }
  }

  async function handleCreate(host: { label: string; hostname: string }) {
    await createHost(host)
    setIsCreating(false)
    loadHosts()
  }

  async function handleUpdate(host: { label: string; hostname: string }) {
    if (!editingHost) return
    await updateHost(editingHost.id, host)
    setEditingHost(null)
    loadHosts()
  }

  async function handleDelete(id: number) {
    await deleteHost(id)
    loadHosts()
  }

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p>Loading hosts...</p>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="outline">Back to Dashboard</Button>
          </Link>
          <h1 className="text-2xl font-bold">Hosts</h1>
        </div>
        {!isCreating && (
          <Button onClick={() => setIsCreating(true)}>Add Host</Button>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive p-4 rounded-md mb-4">
          {error}
        </div>
      )}

      {isCreating && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create New Host</CardTitle>
          </CardHeader>
          <CardContent>
            <HostForm
              onSubmit={handleCreate}
              onCancel={() => setIsCreating(false)}
              submitLabel="Create Host"
            />
          </CardContent>
        </Card>
      )}

      {hosts.length === 0 && !isCreating ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hosts found. Add a host to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="md:hidden space-y-4">
          {hosts.map((host) => (
            <Card key={host.id}>
              <CardHeader>
                <CardTitle>{host.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div>
                  <span className="text-muted-foreground">Hostname: </span>
                  {host.hostname}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingHost(host)}
                  >
                    Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm">Delete</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Host?</AlertDialogTitle>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(host.id)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {hosts.length > 0 && (
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Hostname</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hosts.map((host) => (
                <TableRow key={host.id}>
                  <TableCell>{host.label}</TableCell>
                  <TableCell>{host.hostname}</TableCell>
                  <TableCell>{new Date(host.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingHost(host)}
                      >
                        Edit
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm">Delete</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Host?</AlertDialogTitle>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(host.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editingHost && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Edit Host</CardTitle>
            </CardHeader>
            <CardContent>
              <HostForm
                host={editingHost}
                onSubmit={handleUpdate}
                onCancel={() => setEditingHost(null)}
                submitLabel="Update Host"
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}