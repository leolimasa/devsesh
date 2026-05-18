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
  // Use a ref to track auth success immediately (not subject to async state updates)
  const authInProgressRef = useRef(false)

  const handleAuthenticate = async () => {
    setLocalError(null)
    // Mark that we're starting auth - this prevents onCancel from being called
    // when the dialog closes during the auth process
    authInProgressRef.current = true
    try {
      await onAuthenticate()
      // Auth completed successfully - the dialog will close but we shouldn't call onCancel
    } catch (err) {
      authInProgressRef.current = false
      setLocalError(err instanceof Error ? err.message : "Authentication failed")
    }
  }

  // Handle dialog close - only call onCancel if auth is not in progress
  const handleOpenChange = (open: boolean) => {
    if (!open && !authInProgressRef.current) {
      onCancel()
    }
    // Reset when dialog closes
    if (!open) {
      authInProgressRef.current = false
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
