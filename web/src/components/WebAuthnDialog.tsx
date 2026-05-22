/**
 * WebAuthnDialog Component
 *
 * Displays a dialog prompting the user to authenticate with WebAuthn
 * in order to unlock the SSH CA certificate authentication.
 * [req.4oofln] - Prompt for WebAuthn when SSH connection requires inactive worker
 */

import { useState, useRef } from "react"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog"

interface WebAuthnDialogProps {
  isOpen: boolean
  onAuthenticate: () => Promise<void>
  onCancel: () => void
  isAuthenticating?: boolean
  error?: string | null
}

export function WebAuthnDialog({
  isOpen,
  onAuthenticate,
  onCancel,
  isAuthenticating = false,
  error = null,
}: WebAuthnDialogProps) {
  const [localError, setLocalError] = useState<string | null>(null)
  // Use a ref to track auth in progress - prevents dialog from closing during WebAuthn
  const authInProgressRef = useRef(false)
  // Track whether we successfully completed auth (to allow dialog to close)
  const authSucceededRef = useRef(false)

  const handleAuthenticate = async () => {
    setLocalError(null)
    // Mark that we're starting auth - this prevents onCancel from being called
    // when the dialog closes during the auth process
    authInProgressRef.current = true
    authSucceededRef.current = false
    try {
      await onAuthenticate()
      // Auth completed successfully - mark it so dialog can close
      authSucceededRef.current = true
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Authentication failed")
    } finally {
      authInProgressRef.current = false
    }
  }

  // Handle dialog close - only call onCancel if auth is not in progress
  // and auth didn't succeed
  const handleOpenChange = (open: boolean) => {
    // Don't allow closing during authentication
    if (!open && authInProgressRef.current) {
      console.log('[WebAuthnDialog] Prevented close during authentication')
      return
    }
    // If auth succeeded, allow close without calling onCancel
    if (!open && authSucceededRef.current) {
      console.log('[WebAuthnDialog] Closed after successful auth')
      authSucceededRef.current = false
      return
    }
    // User is closing dialog without successful auth - call onCancel
    if (!open) {
      console.log('[WebAuthnDialog] Closed by user, calling onCancel')
      onCancel()
    }
  }

  const displayError = error || localError

  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Unlock SSH Certificate</AlertDialogTitle>
          <AlertDialogDescription>
            Authenticate with your passkey to enable certificate-based SSH authentication.
            This will unlock your SSH CA signing capability for the next 30 minutes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {displayError && (
          <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
            {displayError}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={isAuthenticating}>
            Use Password Instead
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleAuthenticate} disabled={isAuthenticating}>
            {isAuthenticating ? "Authenticating..." : "Authenticate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
