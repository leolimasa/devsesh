import type { SessionUpdate } from "@/types/api"

// Thin wrappers over the async Clipboard API.
//
// WebKit (Safari/iOS) only allows a clipboard WRITE from inside a user gesture,
// and invalidates it if you `await` anything (e.g. a fetch) first. So callers
// must invoke writeClipboard SYNCHRONOUSLY at the top of a click/keydown handler
// with the text already in hand — see the copy buffer + pill flow.

// writeClipboard writes text to the OS clipboard. Call it synchronously inside a
// user-gesture handler (no awaited work before it) so WebKit keeps the activation.
export function writeClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

// readClipboard reads the OS clipboard. Call it from inside a keydown gesture
// (e.g. the paste shortcut); the browser may prompt for permission the first time.
export function readClipboard(): Promise<string> {
  return navigator.clipboard.readText()
}

export type ClipboardBuffer = { text: string; bytes: number; status: "ready" | "copied" | "error" }

// clipboardKeyAction maps a keydown to a terminal clipboard action, using the
// platform-correct shortcuts: paste is ⌘V on mac / Ctrl+Shift+V elsewhere; the
// flush-to-OS-clipboard hotkey is ⌘⇧C on mac / Ctrl+Shift+C elsewhere. Uses
// `e.code` (physical key) so it's keyboard-layout independent. Returns null for
// anything else. Pure/testable.
export function clipboardKeyAction(
  e: { type: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  mac: boolean
): "paste" | "flush" | null {
  if (e.type !== "keydown") return null
  if (mac) {
    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.code === "KeyV") return "paste"
    if (e.metaKey && e.shiftKey && e.code === "KeyC") return "flush"
    return null
  }
  if (e.ctrlKey && e.shiftKey && e.code === "KeyV") return "paste"
  if (e.ctrlKey && e.shiftKey && e.code === "KeyC") return "flush"
  return null
}

// clipboardBufferFor computes the pending buffer for a "clipboard" event, scoped
// to the currently-viewed session. Returns null for non-clipboard events or a
// clipboard event for a different session (so it's ignored on the wrong tab).
// Setting the returned value replaces any prior buffer (latest-only).
export function clipboardBufferFor(update: SessionUpdate, currentId: string): ClipboardBuffer | null {
  if (update.event !== "clipboard" || update.session_id !== currentId) return null
  const text = update.clipboard ?? ""
  return { text, bytes: new TextEncoder().encode(text).length, status: "ready" }
}
