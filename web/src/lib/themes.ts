// Theme definitions. A theme drives both the app chrome (shadcn CSS variables)
// and the xterm.js terminal palette. Keep the ids in sync with the backend's
// validThemes (internal/settings/handler.go).
import type { ITheme } from "@xterm/xterm"

export type ThemeId = "dark-blue" | "one-dark"

export interface ThemeDef {
  id: ThemeId
  label: string
  // A small swatch used in the settings picker: [background, accent, foreground].
  swatch: [string, string, string]
  // The PWA `theme-color` (hex). On macOS the installed PWA's window title bar
  // follows this, so it must track the theme's background.
  themeColor: string
  // shadcn CSS variables as "H S% L%" triplets (consumed via hsl(var(--x))).
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
  for (const [k, v] of Object.entries(t.cssVars)) {
    root.style.setProperty(k, v)
  }
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
