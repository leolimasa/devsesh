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
import { decodeBase64 } from '@/lib/crypto/encoding'

/**
 * Computes SHA256 fingerprint of an Ed25519 public key in OpenSSH format.
 * Returns the fingerprint in SHA256:base64 format matching ssh-keygen output.
 */
async function computeFingerprint(publicKeyBytes: Uint8Array): Promise<string> {
  // OpenSSH wire format for Ed25519 public key:
  // 4 bytes: length of key type string (big-endian)
  // key type string: "ssh-ed25519"
  // 4 bytes: length of public key (big-endian)
  // public key bytes (32 bytes for Ed25519)

  const keyType = new TextEncoder().encode('ssh-ed25519')
  const keyTypeLen = new Uint8Array(4)
  new DataView(keyTypeLen.buffer).setUint32(0, keyType.length, false)

  const keyLen = new Uint8Array(4)
  new DataView(keyLen.buffer).setUint32(0, publicKeyBytes.length, false)

  const wireFormat = new Uint8Array(
    keyTypeLen.length + keyType.length + keyLen.length + publicKeyBytes.length
  )
  let offset = 0
  wireFormat.set(keyTypeLen, offset)
  offset += keyTypeLen.length
  wireFormat.set(keyType, offset)
  offset += keyType.length
  wireFormat.set(keyLen, offset)
  offset += keyLen.length
  wireFormat.set(publicKeyBytes, offset)

  const hashBuffer = await crypto.subtle.digest('SHA-256', wireFormat)
  const hashArray = new Uint8Array(hashBuffer)

  // Convert to base64 without padding (matching ssh-keygen format)
  const base64 = btoa(String.fromCharCode(...hashArray)).replace(/=+$/, '')

  return `SHA256:${base64}`
}

/**
 * Formats the public key in OpenSSH authorized_keys format.
 */
function formatOpenSSHKey(publicKeyBytes: Uint8Array): string {
  // OpenSSH wire format
  const keyType = new TextEncoder().encode('ssh-ed25519')
  const keyTypeLen = new Uint8Array(4)
  new DataView(keyTypeLen.buffer).setUint32(0, keyType.length, false)

  const keyLen = new Uint8Array(4)
  new DataView(keyLen.buffer).setUint32(0, publicKeyBytes.length, false)

  const wireFormat = new Uint8Array(
    keyTypeLen.length + keyType.length + keyLen.length + publicKeyBytes.length
  )
  let offset = 0
  wireFormat.set(keyTypeLen, offset)
  offset += keyTypeLen.length
  wireFormat.set(keyType, offset)
  offset += keyType.length
  wireFormat.set(keyLen, offset)
  offset += keyLen.length
  wireFormat.set(publicKeyBytes, offset)

  const base64 = btoa(String.fromCharCode(...wireFormat))
  return `ssh-ed25519 ${base64} devsesh-ca`
}

export function CAPublicKeyDownload() {
  const [publicKey, setPublicKey] = useState<Uint8Array | null>(null)
  const [fingerprint, setFingerprint] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadPublicKey() {
      try {
        const response = await getSSHCAPublicKey()
        const keyBytes = decodeBase64(response.public_key)
        setPublicKey(keyBytes)

        const fp = await computeFingerprint(keyBytes)
        setFingerprint(fp)
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

    const content = formatOpenSSHKey(publicKey)
    const blob = new Blob([content], { type: 'text/plain' })
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
