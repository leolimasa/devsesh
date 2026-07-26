import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// True when the viewport is at least Tailwind's `md` breakpoint (768px), i.e.
// "desktop". Used to gate pointer-vs-touch behaviour at runtime. Returns false
// when matchMedia is unavailable (SSR / test env).
export function isDesktopViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false
  }
  return window.matchMedia("(min-width: 768px)").matches
}

// True when the app is running as an installed PWA (standalone window) rather
// than in a browser tab. Used to gate keyboard shortcuts (e.g. Ctrl+Number)
// that the browser reserves in a normal tab but the app owns in standalone.
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  const mm = typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches
  // iOS Safari exposes navigator.standalone instead of the display-mode query.
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return mm || iosStandalone
}