/**
 * CA Public Key Download Component
 *
 * Allows users to download their SSH CA public key in OpenSSH format.
 * Displays the SHA256 fingerprint for verification.
 * [req.23hk63] [req.0lpwy4]
 */

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getSSHCAPublicKey } from '@/lib/api'
import { sha256 } from '@noble/hashes/sha2.js'

/**
 * Compute SSH fingerprint from OpenSSH format public key.
 * The fingerprint is SHA256 hash of the wire-format key (the base64 part).
 */
function computeFingerprint(openSSHKey: string): string {
  // OpenSSH format: "ssh-ed25519 <base64> <comment>"
  const parts = openSSHKey.split(' ')
  if (parts.length < 2) {
    return 'Invalid key format'
  }

  // Decode the base64 wire format
  const wireFormat = atob(parts[1])
  const wireBytes = new Uint8Array(wireFormat.length)
  for (let i = 0; i < wireFormat.length; i++) {
    wireBytes[i] = wireFormat.charCodeAt(i)
  }

  // Hash it
  const hash = sha256(wireBytes)

  // Format as SHA256:base64 (without padding)
  const base64Hash = btoa(String.fromCharCode(...hash))
    .replace(/=+$/, '')

  return `SHA256:${base64Hash}`
}

export function CAPublicKeyDownload() {
  const [publicKey, setPublicKey] = useState<string>('')
  const [fingerprint, setFingerprint] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadPublicKey() {
      try {
        const response = await getSSHCAPublicKey()
        // The API returns the key already in OpenSSH format
        setPublicKey(response.public_key)
        setFingerprint(computeFingerprint(response.public_key))
      } catch (err) {
        if (err instanceof Error && err.message.includes('404')) {
          setError('SSH CA not configured. Register with a passkey that supports PRF.')
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load CA public key')
        }
      } finally {
        setIsLoading(false)
      }
    }

    loadPublicKey()
  }, [])

  const handleDownload = () => {
    if (!publicKey) return

    const blob = new Blob([publicKey], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = 'devsesh-ca.pub'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleCopyFingerprint = async () => {
    if (fingerprint) {
      await navigator.clipboard.writeText(fingerprint)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>SSH CA Public Key</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>SSH CA Public Key</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>SSH CA Public Key</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Fingerprint</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted p-2 rounded overflow-x-auto">
              {fingerprint}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopyFingerprint}>
              Copy
            </Button>
          </div>
        </div>
        <div>
          <p className="text-sm text-muted-foreground mb-2">
            Add this CA to your servers' <code className="text-xs bg-muted px-1 rounded">TrustedUserCAKeys</code> to enable certificate authentication.
          </p>
          <Button onClick={handleDownload}>
            Download CA Public Key
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
