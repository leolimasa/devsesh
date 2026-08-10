import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { useTheme } from "@/contexts/ThemeContext"
import { THEME_LIST } from "@/lib/themes"

export default function SettingsPage() {
  const navigate = useNavigate()
  const { themeId, setTheme } = useTheme()

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            Back
          </Button>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Theme</CardTitle>
            <CardDescription>Choose the colors for the app and terminal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {THEME_LIST.map((t) => {
              const selected = t.id === themeId
              return (
                <button
                  key={t.id}
                  type="button"
                  data-testid={`theme-option-${t.id}`}
                  aria-pressed={selected}
                  onClick={() => setTheme(t.id)}
                  className={`w-full flex items-center gap-3 rounded-md border p-3 text-left transition-colors hover:bg-accent ${
                    selected ? "border-primary ring-1 ring-primary" : "border-border"
                  }`}
                >
                  <span className="flex shrink-0 overflow-hidden rounded border" aria-hidden>
                    {t.swatch.map((c, i) => (
                      <span key={i} className="h-6 w-6" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                  <span className="flex-1 font-medium">{t.label}</span>
                  {selected && <span className="text-primary text-sm font-medium">Selected</span>}
                </button>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
