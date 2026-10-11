import { describe, it, expect, beforeEach } from "vitest"
import { THEMES, THEME_LIST, applyTheme, isThemeId, DEFAULT_THEME_ID } from "@/lib/themes"

// --- color helpers (WCAG 2.x relative luminance / contrast ratio) -------------

function hslToRgb(triplet: string): [number, number, number] {
  const [h, s, l] = triplet.split(/\s+/).map((p) => parseFloat(p))
  const sat = s / 100
  const light = l / 100
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = light - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// --- tests --------------------------------------------------------------------

const REQUIRED_VARS = [
  "--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
  "--primary", "--primary-foreground", "--secondary", "--secondary-foreground", "--muted",
  "--muted-foreground", "--accent", "--accent-foreground", "--destructive", "--destructive-foreground",
  "--border", "--input", "--ring",
]

describe("theme definitions", () => {
  it("registers every theme under its own id", () => {
    for (const t of THEME_LIST) expect(THEMES[t.id]).toBe(t)
    expect(isThemeId("scifi-rts")).toBe(true)
    expect(isThemeId("nope")).toBe(false)
  })

  it.each(THEME_LIST.map((t) => [t.id, t] as const))("%s defines every shadcn variable", (_id, t) => {
    for (const v of REQUIRED_VARS) expect(t.cssVars[v], v).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/)
  })
})

describe("scifi-rts palette accessibility", () => {
  const t = THEMES["scifi-rts"]
  const c = (name: string) => hslToRgb(t.cssVars[name])

  // Text pairs need 4.5:1 (WCAG AA body text).
  it.each([
    ["--foreground", "--background"],
    ["--card-foreground", "--card"],
    ["--popover-foreground", "--popover"],
    ["--muted-foreground", "--background"],
    ["--muted-foreground", "--card"],
    ["--muted-foreground", "--muted"],
    ["--primary-foreground", "--primary"],
    ["--secondary-foreground", "--secondary"],
    ["--accent-foreground", "--accent"],
    ["--destructive-foreground", "--destructive"],
    ["--cta-foreground", "--cta-top"],
    ["--cta-foreground", "--cta-bottom"],
    ["--foreground", "--button-top"],
    ["--foreground", "--button-bottom"],
    ["--success", "--success-surface"],
    ["--warning", "--warning-surface"],
  ])("%s on %s has at least 4.5:1 contrast", (fg, bg) => {
    expect(contrast(c(fg), c(bg))).toBeGreaterThanOrEqual(4.5)
  })

  // Non-text UI (input borders, focus ring, accent edges) needs 3:1 (WCAG 1.4.11).
  it.each([
    ["--input", "--background"],
    ["--input", "--card"],
    ["--input", "--button-bottom"],
    ["--ring", "--background"],
    ["--ring", "--card"],
    ["--primary", "--background"],
    ["--cta", "--card"],
    ["--success-edge", "--success-surface"],
    ["--warning-edge", "--warning-surface"],
  ])("%s against %s has at least 3:1 contrast", (fg, bg) => {
    expect(contrast(c(fg), c(bg))).toBeGreaterThanOrEqual(3)
  })

  it("keeps terminal text colors readable on the terminal background", () => {
    const term = t.terminal
    const bg = hexToRgb(term.background!)
    // ANSI black is meant to blend into the background, so it is excluded.
    const names = [
      "foreground", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
      "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta",
      "brightCyan", "brightWhite", "cursor",
    ] as const
    for (const n of names) {
      expect(contrast(hexToRgb(term[n]!), bg), n).toBeGreaterThanOrEqual(4.5)
    }
    // Selected text must stay readable on the selection color.
    expect(contrast(hexToRgb(term.foreground!), hexToRgb(term.selectionBackground!))).toBeGreaterThanOrEqual(4.5)
  })
})

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style")
    document.documentElement.removeAttribute("data-theme")
  })

  it("marks the active theme on <html> for skin selectors", () => {
    applyTheme("scifi-rts")
    expect(document.documentElement.dataset.theme).toBe("scifi-rts")
    applyTheme("one-dark")
    expect(document.documentElement.dataset.theme).toBe("one-dark")
  })

  it("sets the theme's skin variables", () => {
    applyTheme("scifi-rts")
    const style = document.documentElement.style
    expect(style.getPropertyValue("--glow")).not.toBe("")
    expect(style.getPropertyValue("--cta")).not.toBe("")
    expect(style.getPropertyValue("--radius")).toBe("0.25rem")
  })

  it("removes another theme's extra variables when switching away", () => {
    applyTheme("scifi-rts")
    applyTheme(DEFAULT_THEME_ID)
    const style = document.documentElement.style
    for (const extra of Object.keys(THEMES["scifi-rts"].cssVars).filter((k) => !(k in THEMES[DEFAULT_THEME_ID].cssVars))) {
      expect(style.getPropertyValue(extra), extra).toBe("")
    }
    // The default theme's own variables are intact.
    expect(style.getPropertyValue("--background").trim()).toBe("222.2 84% 4.9%")
  })

  it("leaves the existing themes exactly as they were", () => {
    applyTheme("one-dark")
    const style = document.documentElement.style
    expect(style.getPropertyValue("--background").trim()).toBe("220 13% 18%")
    expect(style.getPropertyValue("--radius")).toBe("")
    expect(style.getPropertyValue("--glow")).toBe("")
  })
})
