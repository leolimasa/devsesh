// Quick Keys overlay with send/library, builder, and manage sections.
// Calls onSend(spec) to inject bytes into the terminal and returns focus.
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { X, Pin, PinOff, Trash2, ChevronUp, ChevronDown } from "lucide-react"
import type { QuickKeyStep, QuickKey } from "@/types/api"
import { PRESET_QUICK_KEYS, previewSpec, parseSpec } from "@/lib/quick-keys"

interface QuickKeysOverlayProps {
  isOpen: boolean
  onClose: () => void
  onSend: (spec: QuickKeyStep[]) => void
  quickKeys: QuickKey[]
  onCreate: (name: string, displayToken: string, spec: QuickKeyStep[], pinned: boolean) => Promise<QuickKey>
  onUpdate: (id: number, fields: Partial<Pick<QuickKey, "name" | "display_token" | "spec" | "pinned" | "sort_order">>) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onReorder: (ids: number[]) => Promise<void>
  onTogglePin: (id: number) => Promise<void>
}

const BASE_KEYS = [
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "escape", "tab",
  "up", "down", "left", "right",
  "home", "end", "page up", "page down",
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]

type Tab = "send" | "builder" | "manage"

export function QuickKeysOverlay({
  isOpen,
  onClose,
  onSend,
  quickKeys,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
  onTogglePin,
}: QuickKeysOverlayProps) {
  const [tab, setTab] = useState<Tab>("send")

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-2xl max-h-[80vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex gap-2">
            {(["send", "builder", "manage"] as Tab[]).map((t) => (
              <Button
                key={t}
                variant={tab === t ? "default" : "ghost"}
                size="sm"
                onClick={() => setTab(t)}
              >
                {t === "send" ? "Send" : t === "builder" ? "Builder" : "Manage"}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "send" && (
            <SendTab
              quickKeys={quickKeys}
              onSend={(spec) => { onSend(spec); onClose() }}
            />
          )}
          {tab === "builder" && (
            <BuilderTab onCreate={onCreate} onClose={() => setTab("manage")} />
          )}
          {tab === "manage" && (
            <ManageTab
              quickKeys={quickKeys}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onReorder={onReorder}
              onTogglePin={onTogglePin}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// --- Send / Library Tab ---

function SendTab({
  quickKeys,
  onSend,
}: {
  quickKeys: QuickKey[]
  onSend: (spec: QuickKeyStep[]) => void
}) {
  return (
    <div className="space-y-6">
      {/* Saved quick keys */}
      {quickKeys.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Your Quick Keys</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {quickKeys.map((k) => (
              <Button
                key={k.id}
                variant="outline"
                size="sm"
                className="truncate"
                onClick={() => onSend(parseSpec(k.spec))}
              >
                {k.display_token}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Presets */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Presets</h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {PRESET_QUICK_KEYS.map((preset, i) => (
            <Button
              key={i}
              variant="outline"
              size="sm"
              className="truncate"
              onClick={() => onSend(preset.spec)}
            >
              {preset.display_token}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

// --- Builder Tab ---

function BuilderTab({
  onCreate,
  onClose,
}: {
  onCreate: (name: string, displayToken: string, spec: QuickKeyStep[], pinned: boolean) => Promise<QuickKey>
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const [displayToken, setDisplayToken] = useState("")
  const [steps, setSteps] = useState<QuickKeyStep[]>([])
  const [pin, setPin] = useState(false)
  const [saving, setSaving] = useState(false)

  // Single-step builder state
  const [editMode, setEditMode] = useState<"combo" | "literal">("combo")
  const [ctrl, setCtrl] = useState(false)
  const [alt, setAlt] = useState(false)
  const [shift, setShift] = useState(false)
  const [baseKey, setBaseKey] = useState("c")
  const [literalText, setLiteralText] = useState("")
  const [literalEnter, setLiteralEnter] = useState(false)

  const addStep = () => {
    if (editMode === "combo") {
      setSteps((prev) => [...prev, { type: "combo", ctrl, alt, shift, key: baseKey }])
    } else {
      setSteps((prev) => [...prev, { type: "literal", text: literalText, enter: literalEnter }])
    }
  }

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    if (!name.trim() || !displayToken.trim() || steps.length === 0) return
    setSaving(true)
    try {
      await onCreate(name.trim(), displayToken.trim(), steps, pin)
      setName("")
      setDisplayToken("")
      setSteps([])
      onClose()
    } catch (err) {
      console.error("Failed to save quick key", err)
    } finally {
      setSaving(false)
    }
  }

  const preview = steps.length > 0 ? previewSpec(steps) : ""

  return (
    <div className="space-y-4">
      {/* Name & display token */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-input bg-background text-foreground placeholder:text-muted-foreground rounded px-2 py-1 text-sm"
            placeholder="e.g. Tmux Detach"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Display Token</label>
          <input
            type="text"
            value={displayToken}
            onChange={(e) => setDisplayToken(e.target.value.slice(0, 20))}
            className="w-full border border-input bg-background text-foreground placeholder:text-muted-foreground rounded px-2 py-1 text-sm"
            placeholder="e.g. ^A d"
          />
        </div>
      </div>

      {/* Step builder */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Add Step</label>
        <div className="flex gap-2 mb-2">
          <Button
            variant={editMode === "combo" ? "default" : "outline"}
            size="sm"
            onClick={() => setEditMode("combo")}
          >
            Combo
          </Button>
          <Button
            variant={editMode === "literal" ? "default" : "outline"}
            size="sm"
            onClick={() => setEditMode("literal")}
          >
            Literal
          </Button>
        </div>

        {editMode === "combo" ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={ctrl} onChange={(e) => setCtrl(e.target.checked)} />
              Ctrl
            </label>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={alt} onChange={(e) => setAlt(e.target.checked)} />
              Alt
            </label>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} />
              Shift
            </label>
            <select
              value={baseKey}
              onChange={(e) => setBaseKey(e.target.value)}
              className="border border-input bg-background text-foreground placeholder:text-muted-foreground rounded px-2 py-1 text-sm"
            >
              {BASE_KEYS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <Button size="sm" onClick={addStep}>Add</Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={literalText}
              onChange={(e) => setLiteralText(e.target.value)}
              className="border border-input bg-background text-foreground placeholder:text-muted-foreground rounded px-2 py-1 text-sm flex-1"
              placeholder="Literal text..."
            />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={literalEnter} onChange={(e) => setLiteralEnter(e.target.checked)} />
              +Enter
            </label>
            <Button size="sm" onClick={addStep}>Add</Button>
          </div>
        )}
      </div>

      {/* Macro steps list */}
      {steps.length > 0 && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Steps ({steps.length})</label>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-muted rounded px-2 py-1">
                <span className="flex-1 font-mono">{describeStep(step)}</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeStep(i)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live preview */}
      <div>
        <label className="text-xs text-muted-foreground">Byte Preview</label>
        <div className="font-mono text-sm bg-muted rounded px-2 py-1 break-all">
          {preview || "(empty)"}
        </div>
      </div>

      {/* Pin & Save */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
          Pin to top bar
        </label>
        <Button size="sm" onClick={handleSave} disabled={saving || !name.trim() || !displayToken.trim() || steps.length === 0}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  )
}

function describeStep(step: QuickKeyStep): string {
  if (step.type === "literal") {
    return `"${step.text}"${step.enter ? " + Enter" : ""}`
  }
  const mods: string[] = []
  if (step.ctrl) mods.push("Ctrl")
  if (step.alt) mods.push("Alt")
  if (step.shift) mods.push("Shift")
  const modStr = mods.length > 0 ? mods.join("+") + "+" : ""
  return `${modStr}${step.key}`
}

// --- Manage Tab ---

function ManageTab({
  quickKeys,
  onUpdate,
  onDelete,
  onReorder,
  onTogglePin,
}: {
  quickKeys: QuickKey[]
  onUpdate: (id: number, fields: Partial<Pick<QuickKey, "name" | "display_token" | "spec" | "pinned" | "sort_order">>) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onReorder: (ids: number[]) => Promise<void>
  onTogglePin: (id: number) => Promise<void>
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editToken, setEditToken] = useState("")

  const moveItem = (fromIndex: number, direction: 1 | -1) => {
    const toIndex = fromIndex + direction
    if (toIndex < 0 || toIndex >= quickKeys.length) return
    const ids = quickKeys.map((k) => k.id)
    const tmp = ids[fromIndex]
    ids[fromIndex] = ids[toIndex]
    ids[toIndex] = tmp
    onReorder(ids)
  }

  const startEdit = (k: QuickKey) => {
    setEditingId(k.id)
    setEditName(k.name)
    setEditToken(k.display_token)
  }

  const saveEdit = async (k: QuickKey) => {
    await onUpdate(k.id, { name: editName, display_token: editToken })
    setEditingId(null)
  }

  if (quickKeys.length === 0) {
    return <p className="text-sm text-muted-foreground">No saved quick keys yet. Create one in the Builder tab.</p>
  }

  return (
    <div className="space-y-2">
      {quickKeys.map((k, i) => (
        <div key={k.id} className="flex items-center gap-2 bg-muted rounded p-2">
          {editingId === k.id ? (
            <>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="border border-input bg-background text-foreground placeholder:text-muted-foreground rounded px-2 py-1 text-sm flex-1"
                placeholder="Name"
              />
              <input
                value={editToken}
                onChange={(e) => setEditToken(e.target.value.slice(0, 20))}
                className="border border-input bg-background text-foreground placeholder:text-muted-foreground rounded px-2 py-1 text-sm w-20"
                placeholder="Token"
              />
              <Button size="sm" onClick={() => saveEdit(k)}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
            </>
          ) : (
            <>
              <span className="text-sm flex-1 truncate">{k.name}</span>
              <span className="text-xs text-muted-foreground">{k.display_token}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onTogglePin(k.id)}
                title={k.pinned ? "Unpin" : "Pin"}
              >
                {k.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => startEdit(k)}
                title="Edit"
              >
                <span className="text-xs">Edit</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => moveItem(i, -1)}
                disabled={i === 0}
                title="Move up"
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => moveItem(i, 1)}
                disabled={i === quickKeys.length - 1}
                title="Move down"
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive"
                onClick={() => onDelete(k.id)}
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
