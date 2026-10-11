import { describe, it, expect, beforeEach } from "vitest"
import {
  allTags,
  checkNewTag,
  effectiveFilter,
  filterByTags,
  loadTagFilter,
  mergeReorder,
  saveTagFilter,
  MAX_TAGS,
} from "@/lib/tags"
import type { Session } from "@/types/api"

const s = (id: string, tags?: string[]): Session => ({
  id,
  user_id: 1,
  host_id: 1,
  name: id,
  started_at: "2026-01-01T00:00:00Z",
  last_ping_at: null,
  last_activity_at: null,
  ended_at: null,
  metadata: null,
  tags,
})

describe("allTags", () => {
  it("lists each tag once ignoring case, sorted, and copes with missing tags", () => {
    const sessions = [s("a", ["work", "Home"]), s("b", ["WORK", "🔥"]), s("c")]
    expect(allTags(sessions)).toEqual(["🔥", "Home", "work"].sort((x, y) => x.localeCompare(y)))
    expect(allTags(sessions)).toContain("work")
    expect(allTags(sessions)).not.toContain("WORK")
  })
})

describe("filterByTags", () => {
  const sessions = [s("a", ["work"]), s("b", ["home", "work"]), s("c", ["home"]), s("d")]

  it("returns everything when nothing is selected", () => {
    expect(filterByTags(sessions, []).map((x) => x.id)).toEqual(["a", "b", "c", "d"])
  })
  it("matches sessions with ANY selected tag", () => {
    expect(filterByTags(sessions, ["work"]).map((x) => x.id)).toEqual(["a", "b"])
    expect(filterByTags(sessions, ["work", "home"]).map((x) => x.id)).toEqual(["a", "b", "c"])
  })
  it("ignores case and keeps the original order", () => {
    expect(filterByTags(sessions, ["HOME"]).map((x) => x.id)).toEqual(["b", "c"])
  })
})

describe("effectiveFilter", () => {
  it("drops selected tags that no longer exist", () => {
    expect(effectiveFilter(["work", "gone"], ["home", "work"])).toEqual(["work"])
    expect(effectiveFilter(["gone"], ["home"])).toEqual([])
  })
})

describe("checkNewTag", () => {
  it("accepts text and emoji, trimmed", () => {
    expect(checkNewTag("  deploy ", [])).toEqual({ ok: true, tag: "deploy" })
    expect(checkNewTag("🔥", [])).toEqual({ ok: true, tag: "🔥" })
  })
  it("counts an emoji as one character", () => {
    expect(checkNewTag("🔥".repeat(32), []).ok).toBe(true)
    expect(checkNewTag("🔥".repeat(33), []).ok).toBe(false)
  })
  it.each([
    ["", "empty"],
    ["   ", "blank"],
    ["a,b", "comma"],
    ["x".repeat(33), "too long"],
  ])("rejects %j (%s)", (raw) => {
    expect(checkNewTag(raw, []).ok).toBe(false)
  })
  it("rejects duplicates ignoring case and too many tags", () => {
    expect(checkNewTag("WORK", ["work"]).ok).toBe(false)
    const many = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`)
    expect(checkNewTag("one-more", many).ok).toBe(false)
  })
})

describe("mergeReorder", () => {
  it("is the identity when nothing is filtered", () => {
    expect(mergeReorder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"])
  })
  it("keeps hidden sessions in their slots and shuffles the visible ones among theirs", () => {
    // Full order a b c d e; b, d, e are visible. Moving e first among them.
    expect(mergeReorder(["a", "b", "c", "d", "e"], ["e", "b", "d"])).toEqual(["a", "e", "c", "b", "d"])
  })
  it("leaves the order unchanged when the visible order is unchanged", () => {
    expect(mergeReorder(["a", "b", "c", "d"], ["b", "d"])).toEqual(["a", "b", "c", "d"])
  })
})

describe("saved filter", () => {
  beforeEach(() => localStorage.clear())

  it("round-trips and clears", () => {
    expect(loadTagFilter()).toEqual([])
    saveTagFilter(["work", "🔥"])
    expect(loadTagFilter()).toEqual(["work", "🔥"])
    saveTagFilter([])
    expect(loadTagFilter()).toEqual([])
    expect(localStorage.getItem("tagFilter")).toBeNull()
  })
  it("ignores corrupt data", () => {
    localStorage.setItem("tagFilter", "{not json")
    expect(loadTagFilter()).toEqual([])
    localStorage.setItem("tagFilter", JSON.stringify({ a: 1 }))
    expect(loadTagFilter()).toEqual([])
  })
})
