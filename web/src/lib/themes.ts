// Theme definitions. A theme drives both the app chrome (shadcn CSS variables)
// and the xterm.js terminal palette. Keep the ids in sync with the backend's
// validThemes (internal/settings/handler.go).
import type { ITheme } from "@xterm/xterm"

export type ThemeId = "dark-blue" | "one-dark" | "scifi-rts"

export interface ThemeDef {
  id: ThemeId
  label: string
  // A small swatch used in the settings picker: [background, accent, foreground].
  swatch: [string, string, string]
  // The PWA `theme-color` (hex). On macOS the installed PWA's window title bar
  // follows this, so it must track the theme's background.
  themeColor: string
  // CSS `color-scheme` for the theme. Drives how the browser paints native
  // controls (the <select> popup, scrollbars, form widgets): without this a dark
  // theme still gets a light OS "aqua" select popup. Set to the theme's base.
  colorScheme: "light" | "dark"
  // shadcn CSS variables as "H S% L%" triplets (consumed via hsl(var(--x))). A theme
  // may also set extra variables (e.g. --radius, --glow, --cta) that only its own
  // skin in index.css reads; applyTheme removes them again on switching away.
  cssVars: Record<string, string>
  // xterm.js terminal theme.
  terminal: ITheme
}

export const DEFAULT_THEME_ID: ThemeId = "dark-blue"

export const THEMES: Record<ThemeId, ThemeDef> = {
  // The original devsesh look, preserved exactly.
  "dark-blue": {
    id: "dark-blue",
    label: "Dark Blue",
    swatch: ["#0b1120", "#3b82f6", "#f8fafc"],
    themeColor: "#0f172a",
    colorScheme: "dark",
    cssVars: {
      "--background": "222.2 84% 4.9%",
      "--foreground": "210 40% 98%",
      "--card": "222.2 84% 4.9%",
      "--card-foreground": "210 40% 98%",
      "--popover": "222.2 84% 4.9%",
      "--popover-foreground": "210 40% 98%",
      "--primary": "217.2 91.2% 59.8%",
      "--primary-foreground": "222.2 47.4% 11.2%",
      "--secondary": "217.2 32.6% 17.5%",
      "--secondary-foreground": "210 40% 98%",
      "--muted": "217.2 32.6% 17.5%",
      "--muted-foreground": "215 20.2% 65.1%",
      "--accent": "217.2 32.6% 17.5%",
      "--accent-foreground": "210 40% 98%",
      "--destructive": "0 62.8% 30.6%",
      "--destructive-foreground": "210 40% 98%",
      "--border": "217.2 32.6% 17.5%",
      "--input": "217.2 32.6% 17.5%",
      "--ring": "224.3 76.3% 48%",
    },
    terminal: {
      background: "#1a1a1a",
      foreground: "#ffffff",
      cursor: "#ffffff",
    },
  },

  // JetBrains / Atom "One Dark".
  "one-dark": {
    id: "one-dark",
    label: "One Dark",
    swatch: ["#282c34", "#61afef", "#abb2bf"],
    themeColor: "#282c34",
    colorScheme: "dark",
    cssVars: {
      "--background": "220 13% 18%",
      "--foreground": "219 14% 71%",
      "--card": "220 13% 18%",
      "--card-foreground": "219 14% 71%",
      "--popover": "220 13% 18%",
      "--popover-foreground": "219 14% 71%",
      "--primary": "207 82% 66%",
      "--primary-foreground": "220 13% 18%",
      "--secondary": "220 13% 26%",
      "--secondary-foreground": "219 14% 71%",
      "--muted": "220 13% 26%",
      "--muted-foreground": "220 9% 60%",
      "--accent": "220 13% 26%",
      "--accent-foreground": "219 14% 71%",
      "--destructive": "355 65% 55%",
      "--destructive-foreground": "0 0% 98%",
      "--border": "220 13% 26%",
      "--input": "220 13% 26%",
      "--ring": "207 82% 66%",
    },
    terminal: {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#528bff",
      cursorAccent: "#282c34",
      selectionBackground: "#3e4451",
      black: "#282c34",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#d19a66",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
  },

  // "SciFi RTS": modelled on the StarCraft II front-end. A near-black navy base
  // lit by electric-blue glow, glowing blue panel edges, and amber reserved for the
  // one primary action (like the "Ready" button). The look beyond colors (display
  // font, bevels, glow) lives in the [data-theme="scifi-rts"] block in index.css.
  // Every foreground/background pair below is checked in themes.test.ts.
  "scifi-rts": {
    id: "scifi-rts",
    label: "SciFi RTS",
    swatch: ["#050a14", "#3cb4ff", "#eaf4ff"],
    themeColor: "#050a14",
    colorScheme: "dark",
    cssVars: {
      "--background": "220 60% 4.9%",
      "--foreground": "211.4 100% 95.9%",
      "--card": "219.5 65.5% 11.4%",
      "--card-foreground": "211.4 100% 95.9%",
      "--popover": "219.5 65.5% 11.4%",
      "--popover-foreground": "211.4 100% 95.9%",
      "--primary": "203.1 100% 61.8%",
      "--primary-foreground": "213.3 77.1% 6.9%",
      "--secondary": "217.4 62.9% 19%",
      "--secondary-foreground": "214.3 94.6% 92.7%",
      "--muted": "217.4 62.9% 19%",
      "--muted-foreground": "213 36.1% 67.5%",
      "--accent": "218.6 64.6% 25.5%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "356.6 65% 42.5%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "215.3 67.3% 31.2%",
      "--input": "210.9 72.7% 55.5%",
      "--ring": "200.2 100% 68%",
      // Slightly squarer corners than the 0.5rem default.
      "--radius": "0.25rem",
      // Skin-only variables, read by index.css.
      "--glow": "203.1 100% 61.8%",
      "--cta": "32.6 100% 61.4%",
      "--cta-foreground": "39.5 100% 92%",
      "--cta-top": "28.7 82.5% 26.9%",
      "--cta-bottom": "26.9 82.7% 15.9%",
      "--button-top": "215.3 72.9% 26.1%",
      "--button-bottom": "218.9 73% 14.5%",
      "--success": "139.8 76.9% 74.5%",
      "--success-surface": "151.3 63.9% 14.1%",
      "--success-edge": "144.8 50.4% 49.8%",
      "--warning": "42.1 100% 77.1%",
      "--warning-surface": "40.9 80.5% 16.1%",
      "--warning-edge": "42.6 77.9% 47.8%",
    },
    terminal: {
      background: "#111d2f",
      foreground: "#9db0c8",
      cursor: "#e3b468",
      cursorAccent: "#111d2f",
      selectionBackground: "#213a5e",
      black: "#172740",
      red: "#e0808b",
      green: "#8fcf9f",
      yellow: "#e3c581",
      blue: "#7aaae0",
      magenta: "#b99ee0",
      cyan: "#86cfe0",
      white: "#9db0c8",
      brightBlack: "#8699b3",
      brightRed: "#ea9ea7",
      brightGreen: "#acdfb8",
      brightYellow: "#ecd8a2",
      brightBlue: "#9dc3ea",
      brightMagenta: "#cdb8ea",
      brightCyan: "#a6dcea",
      brightWhite: "#b9c8dc",
    },
  },
}

export const THEME_LIST: ThemeDef[] = Object.values(THEMES)

export function isThemeId(v: string | null | undefined): v is ThemeId {
  return !!v && v in THEMES
}

// applyTheme writes a theme's CSS variables onto :root, overriding the static
// defaults in index.css.
export function applyTheme(id: ThemeId): void {
  if (typeof document === "undefined") return
  const t = THEMES[id] ?? THEMES[DEFAULT_THEME_ID]
  const root = document.documentElement
  // Drop variables another theme set but this one doesn't (e.g. --radius, --glow),
  // so they fall back to the index.css defaults instead of leaking across switches.
  for (const theme of THEME_LIST) {
    for (const k of Object.keys(theme.cssVars)) {
      if (!(k in t.cssVars)) root.style.removeProperty(k)
    }
  }
  for (const [k, v] of Object.entries(t.cssVars)) {
    root.style.setProperty(k, v)
  }
  // Hook for theme-specific skins in index.css ([data-theme="..."] selectors).
  root.dataset.theme = t.id
  // Paint native controls (select popup, scrollbars, form widgets) in the
  // theme's base scheme so they don't fall back to the light OS look.
  root.style.colorScheme = t.colorScheme
  // Track the PWA title-bar / browser UI color to the theme (macOS PWA window
  // title bar follows <meta name="theme-color">).
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement("meta")
    meta.setAttribute("name", "theme-color")
    document.head.appendChild(meta)
  }
  meta.setAttribute("content", t.themeColor)
}
