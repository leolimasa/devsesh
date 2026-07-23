// Pure functions for Quick Keys encoding — no React dependencies.
// Translates Quick Key specs into PTY byte sequences and provides
// human-readable previews for the builder.
import type { QuickKeyStep } from "@/types/api"

const encoder = new TextEncoder()

// xterm-style escape sequences for special/navigation keys.
// These are the sequences that an xterm-compatible terminal understands.
const ESC = 0x1b
const CSI = 0x5b // '['
const SS3 = 0x4f // 'O'

// CSI-style keys. Unmodified they emit `ESC [ <num?> <final>`; when a modifier
// is held they emit `ESC [ <num|1> ; <mod> <final>` (xterm convention), where
// `mod = 1 + shift + 2*alt + 4*ctrl`. `num === null` means no leading number
// (implicit 1), e.g. arrows / home / end.
const CSI_KEYS: Record<string, { num: number | null; final: number }> = {
  up: { num: null, final: 0x41 }, // A
  down: { num: null, final: 0x42 }, // B
  right: { num: null, final: 0x43 }, // C
  left: { num: null, final: 0x44 }, // D
  home: { num: null, final: 0x48 }, // H
  end: { num: null, final: 0x46 }, // F
  "page up": { num: 5, final: 0x7e }, // ~
  "page down": { num: 6, final: 0x7e },
  f5: { num: 15, final: 0x7e },
  f6: { num: 17, final: 0x7e },
  f7: { num: 18, final: 0x7e },
  f8: { num: 19, final: 0x7e },
  f9: { num: 20, final: 0x7e },
  f10: { num: 21, final: 0x7e },
  f11: { num: 23, final: 0x7e },
  f12: { num: 24, final: 0x7e },
}

// SS3-style keys (F1–F4). Unmodified they emit `ESC O <final>`; when modified
// they switch to the CSI form `ESC [ 1 ; <mod> <final>`.
const SS3_KEYS: Record<string, number> = {
  f1: 0x50, // P
  f2: 0x51, // Q
  f3: 0x52, // R
  f4: 0x53, // S
}

// modifierCode returns the xterm modifier parameter, or 1 when no modifier is
// held (the "unmodified" marker).
function modifierCode(step: { ctrl: boolean; alt: boolean; shift: boolean }): number {
  return 1 + (step.shift ? 1 : 0) + (step.alt ? 2 : 0) + (step.ctrl ? 4 : 0)
}

// asciiDigits renders a non-negative integer as its ASCII byte codes.
function asciiDigits(n: number): number[] {
  return Array.from(String(n), (c) => c.charCodeAt(0))
}

// prefixEsc prepends an ESC byte (the meta/alt convention: Alt+X sends ESC X).
function prefixEsc(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + 1)
  out[0] = ESC
  out.set(bytes, 1)
  return out
}

export interface PresetQuickKey {
  name: string
  display_token: string
  spec: QuickKeyStep[]
}

// Built-in preset library. Presets are client-side and never persisted.
export const PRESET_QUICK_KEYS: PresetQuickKey[] = [
  { name: "Ctrl+C", display_token: "^C", spec: [{ type: "combo", ctrl: true, alt: false, shift: false, key: "c" }] },
  { name: "Ctrl+D", display_token: "^D", spec: [{ type: "combo", ctrl: true, alt: false, shift: false, key: "d" }] },
  { name: "Ctrl+Z", display_token: "^Z", spec: [{ type: "combo", ctrl: true, alt: false, shift: false, key: "z" }] },
  { name: "Ctrl+L", display_token: "^L", spec: [{ type: "combo", ctrl: true, alt: false, shift: false, key: "l" }] },
  { name: "Ctrl+A", display_token: "^A", spec: [{ type: "combo", ctrl: true, alt: false, shift: false, key: "a" }] },
  { name: "Ctrl+E", display_token: "^E", spec: [{ type: "combo", ctrl: true, alt: false, shift: false, key: "e" }] },
  { name: "Esc", display_token: "Esc", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "escape" }] },
  { name: "Tab", display_token: "Tab", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "tab" }] },
  { name: "Up", display_token: "↑", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "up" }] },
  { name: "Down", display_token: "↓", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "down" }] },
  { name: "Left", display_token: "←", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "left" }] },
  { name: "Right", display_token: "→", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "right" }] },
  { name: "F1", display_token: "F1", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "f1" }] },
  { name: "F2", display_token: "F2", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "f2" }] },
  { name: "F3", display_token: "F3", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "f3" }] },
  { name: "F4", display_token: "F4", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "f4" }] },
  { name: "F5", display_token: "F5", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "f5" }] },
  { name: "F6", display_token: "F6", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "f6" }] },
  { name: "F7", display_token: "F7", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "f7" }] },
  { name: "F8", display_token: "F8", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "f8" }] },
  { name: "F9", display_token: "F9", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "f9" }] },
  { name: "F10", display_token: "F10", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "f10" }] },
  { name: "F11", display_token: "F11", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "f11" }] },
  { name: "F12", display_token: "F12", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "f12" }] },
  { name: "Home", display_token: "Home", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "home" }] },
  { name: "End", display_token: "End", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "end" }] },
  { name: "PgUp", display_token: "PgUp", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "page up" }] },
  { name: "PgDn", display_token: "PgDn", spec: [{ type: "combo", ctrl: false, alt: false, shift: false, key: "page down" }] },
]

// encodeStep translates a single QuickKeyStep into PTY bytes.
// Only representable combos are handled; OS-level chords like ctrl+alt+del
// are not representable over a PTY and are not offered.
export function encodeStep(step: QuickKeyStep): Uint8Array {
  if (step.type === "literal") {
    const bytes = encoder.encode(step.text)
    if (step.enter) {
      const result = new Uint8Array(bytes.length + 1)
      result.set(bytes)
      result[bytes.length] = 0x0d // carriage return
      return result
    }
    return bytes
  }

  // combo step
  const key = step.key.toLowerCase()
  const mod = modifierCode(step)

  // escape: bare ESC, or ESC ESC when Alt is held.
  if (key === "escape") return step.alt ? new Uint8Array([ESC, ESC]) : new Uint8Array([ESC])

  // tab: Shift+Tab is back-tab (CSI Z); otherwise HT, with Alt as an ESC prefix.
  if (key === "tab") {
    if (step.shift) return new Uint8Array([ESC, CSI, 0x5a]) // ESC [ Z
    return step.alt ? new Uint8Array([ESC, 0x09]) : new Uint8Array([0x09])
  }

  // CSI-style keys (arrows, home/end, page up/down, F5–F12), modifier-aware.
  const csi = CSI_KEYS[key]
  if (csi) {
    if (mod === 1) {
      return csi.num === null
        ? new Uint8Array([ESC, CSI, csi.final])
        : new Uint8Array([ESC, CSI, ...asciiDigits(csi.num), csi.final])
    }
    const num = csi.num ?? 1
    return new Uint8Array([ESC, CSI, ...asciiDigits(num), 0x3b, ...asciiDigits(mod), csi.final])
  }

  // SS3-style keys (F1–F4), modifier-aware.
  const ss3 = SS3_KEYS[key]
  if (ss3 !== undefined) {
    if (mod === 1) return new Uint8Array([ESC, SS3, ss3])
    return new Uint8Array([ESC, CSI, 0x31, 0x3b, ...asciiDigits(mod), ss3]) // ESC [ 1 ; mod <final>
  }

  // ctrl+letter combos: ctrl+c → 0x03, ctrl+d → 0x04, etc.
  // ctrl+[a-z] maps to ASCII code - 96; Alt adds an ESC prefix.
  if (step.ctrl && /^[a-z]$/.test(key)) {
    const code = key.toUpperCase().charCodeAt(0) - 64
    const bytes = new Uint8Array([code])
    return step.alt ? prefixEsc(bytes) : bytes
  }

  // bare letter/number (shift uppercases; Alt adds an ESC prefix).
  if (/^[a-z0-9]$/.test(key)) {
    const c = step.shift ? key.toUpperCase() : key
    const bytes = encoder.encode(c)
    return step.alt ? prefixEsc(bytes) : bytes
  }

  // fallback: literal character
  return step.alt ? prefixEsc(encoder.encode(key)) : encoder.encode(key)
}

// parseSpec parses a QuickKey's stored spec JSON string into steps, returning
// an empty array on malformed input rather than throwing.
export function parseSpec(specStr: string): QuickKeyStep[] {
  try {
    return JSON.parse(specStr)
  } catch {
    return []
  }
}

// encodeSpec concatenates all steps into a single byte sequence (macros).
export function encodeSpec(spec: QuickKeyStep[]): Uint8Array {
  const parts = spec.map(encodeStep)
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

// previewSpec produces a human-readable hex/escape rendering for the builder's live preview.
export function previewSpec(spec: QuickKeyStep[]): string {
  const bytes = encodeSpec(spec)
  const parts: string[] = []
  for (const b of bytes) {
    if (b >= 0x20 && b <= 0x7e) {
      parts.push(String.fromCodePoint(b))
    } else {
      parts.push(`\\x${b.toString(16).padStart(2, "0")}`)
    }
  }
  return parts.join("")
}
