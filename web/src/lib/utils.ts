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