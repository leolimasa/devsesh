// ThemeContext owns the active UI/terminal theme. It applies the theme's CSS
// variables immediately (flash-free via a localStorage cache), reconciles with
// the per-user server setting on mount, and persists changes back to the server.
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"
import {
  THEMES,
  DEFAULT_THEME_ID,
  applyTheme,
  isThemeId,
  type ThemeDef,
  type ThemeId,
} from "@/lib/themes"
import { getSettings, updateSettings } from "@/lib/api"

const STORAGE_KEY = "theme"

interface ThemeContextValue {
  themeId: ThemeId
  theme: ThemeDef
  setTheme: (id: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function initialThemeId(): ThemeId {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isThemeId(saved)) return saved
  }
  return DEFAULT_THEME_ID
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(initialThemeId)

  // Apply CSS variables whenever the theme changes.
  useEffect(() => {
    applyTheme(themeId)
  }, [themeId])

  // Reconcile with the server-side per-user setting once authenticated.
  useEffect(() => {
    if (typeof localStorage === "undefined" || !localStorage.getItem("token")) return
    let cancelled = false
    getSettings()
      .then((s) => {
        if (cancelled || !isThemeId(s.theme)) return
        setThemeId(s.theme)
        localStorage.setItem(STORAGE_KEY, s.theme)
      })
      .catch(() => {
        /* not fatal — keep the cached/default theme */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id)
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, id)
    updateSettings({ theme: id }).catch(() => {
      /* best-effort persist; the local change already applied */
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ themeId, theme: THEMES[themeId], setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

// useTheme returns the active theme. Outside a provider (e.g. an isolated
// component test) it falls back to the default theme with a no-op setter, so
// consumers like SSHTerminal never need a provider just to render.
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (ctx) return ctx
  return { themeId: DEFAULT_THEME_ID, theme: THEMES[DEFAULT_THEME_ID], setTheme: () => {} }
}
