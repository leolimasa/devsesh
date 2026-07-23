// Loads the user's quick keys once and exposes merged presets + persisted
// quick keys, pinned subset, and CRUD/pin/reorder helpers.
// State updates optimistically then reconciles with the API.
import { useState, useEffect, useCallback } from "react"
import type { QuickKey, QuickKeyStep } from "@/types/api"
import type { PresetQuickKey } from "@/lib/quick-keys"
import { PRESET_QUICK_KEYS, parseSpec } from "@/lib/quick-keys"
import { listQuickKeys, createQuickKey, updateQuickKey, deleteQuickKey } from "@/lib/api"

interface UseQuickKeysResult {
  quickKeys: QuickKey[]
  presets: PresetQuickKey[]
  pinned: Array<{ display_token: string; spec: QuickKeyStep[] }>
  loading: boolean
  create: (name: string, displayToken: string, spec: QuickKeyStep[], pinned: boolean) => Promise<QuickKey>
  update: (id: number, fields: Partial<Pick<QuickKey, "name" | "display_token" | "spec" | "pinned" | "sort_order">>) => Promise<void>
  remove: (id: number) => Promise<void>
  reorder: (ids: number[]) => Promise<void>
  togglePin: (id: number) => Promise<void>
}

export function useQuickKeys(): UseQuickKeysResult {
  const [quickKeys, setQuickKeys] = useState<QuickKey[]>([])
  const [loading, setLoading] = useState(true)

  // Load persisted quick keys on mount
  useEffect(() => {
    let cancelled = false
    listQuickKeys()
      .then((keys) => {
        if (!cancelled) setQuickKeys(keys)
      })
      .catch((err) => {
        console.error("Failed to load quick keys", err)
        if (!cancelled) setQuickKeys([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const create = useCallback(async (name: string, displayToken: string, spec: QuickKeyStep[], pinned: boolean): Promise<QuickKey> => {
    const specStr = JSON.stringify(spec)
    // Optimistic: add temp entry
    const tempId = -Date.now()
    const optimistic: QuickKey = {
      id: tempId,
      user_id: 0,
      name,
      display_token: displayToken,
      spec: specStr,
      pinned,
      sort_order: quickKeys.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setQuickKeys((prev) => [...prev, optimistic])

    try {
      const created = await createQuickKey({
        name,
        display_token: displayToken,
        spec: specStr,
        pinned,
        sort_order: quickKeys.length,
      })
      setQuickKeys((prev) => prev.map((k) => (k.id === tempId ? created : k)))
      return created
    } catch (err) {
      setQuickKeys((prev) => prev.filter((k) => k.id !== tempId))
      throw err
    }
  }, [quickKeys.length])

  const update = useCallback(async (id: number, fields: Partial<Pick<QuickKey, "name" | "display_token" | "spec" | "pinned" | "sort_order">>) => {
    // Optimistic
    const prev = [...quickKeys]
    setQuickKeys((current) =>
      current.map((k) => (k.id === id ? { ...k, ...fields, spec: fields.spec ?? k.spec } : k))
    )

    try {
      const updated = await updateQuickKey(id, {
        ...(fields.name !== undefined ? { name: fields.name } : {}),
        ...(fields.display_token !== undefined ? { display_token: fields.display_token } : {}),
        ...(fields.spec !== undefined ? { spec: typeof fields.spec === "string" ? fields.spec : JSON.stringify(fields.spec) } : {}),
        ...(fields.pinned !== undefined ? { pinned: fields.pinned } : {}),
        ...(fields.sort_order !== undefined ? { sort_order: fields.sort_order } : {}),
      })
      setQuickKeys((current) => current.map((k) => (k.id === id ? updated : k)))
    } catch (err) {
      setQuickKeys(prev)
      throw err
    }
  }, [quickKeys])

  const remove = useCallback(async (id: number) => {
    const prev = [...quickKeys]
    setQuickKeys((current) => current.filter((k) => k.id !== id))

    try {
      await deleteQuickKey(id)
    } catch (err) {
      setQuickKeys(prev)
      throw err
    }
  }, [quickKeys])

  const reorder = useCallback(async (ids: number[]) => {
    const prev = [...quickKeys]
    const keyMap = new Map(quickKeys.map((k) => [k.id, k]))
    // Reorder the keys named in `ids`; keep any keys not referenced (appended
    // in their existing order) so a partial list never drops rows from state.
    const reordered = ids
      .map((id, i) => {
        const key = keyMap.get(id)
        return key ? { ...key, sort_order: i } : null
      })
      .filter((k): k is QuickKey => k !== null)
    const referenced = new Set(ids)
    const remaining = quickKeys.filter((k) => !referenced.has(k.id))
    setQuickKeys([...reordered, ...remaining])

    try {
      await Promise.all(
        ids
          .filter((id) => keyMap.has(id))
          .map((id, i) => updateQuickKey(id, { sort_order: i }))
      )
    } catch (err) {
      setQuickKeys(prev)
      throw err
    }
  }, [quickKeys])

  const togglePin = useCallback(async (id: number) => {
    const key = quickKeys.find((k) => k.id === id)
    if (!key) return
    await update(id, { pinned: !key.pinned })
  }, [quickKeys, update])

  // Derived: pinned keys in sort_order for top bar
  const pinned = quickKeys
    .filter((k) => k.pinned)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((k) => ({
      display_token: k.display_token,
      spec: parseSpec(k.spec),
    }))

  return { quickKeys, presets: PRESET_QUICK_KEYS, pinned, loading, create, update, remove, reorder, togglePin }
}
