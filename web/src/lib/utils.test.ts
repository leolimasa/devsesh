import { describe, it, expect, vi, afterEach } from "vitest"
import { cn, isDesktopViewport } from "@/lib/utils"

describe("cn", () => {
  it("merges class names correctly", () => {
    expect(cn("foo", "bar")).toBe("foo bar")
  })

  it("handles conditional classes", () => {
    const active = true
    const disabled = false
    expect(cn("base", active && "active", disabled && "disabled")).toBe("base active")
  })

  it("handles array of classes", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar")
  })

  it("handles object-based classes", () => {
    expect(cn({ foo: true, bar: false })).toBe("foo")
  })

  it("merges tailwind classes with twMerge", () => {
    expect(cn("px-2", "px-4")).toBe("px-4")
  })
})

describe("isDesktopViewport", () => {
  const original = window.matchMedia
  afterEach(() => {
    window.matchMedia = original
  })

  it("returns true when the md breakpoint matches", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    expect(isDesktopViewport()).toBe(true)
    expect(window.matchMedia).toHaveBeenCalledWith("(min-width: 768px)")
  })

  it("returns false when the md breakpoint does not match", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
    expect(isDesktopViewport()).toBe(false)
  })

  it("returns false when matchMedia is unavailable", () => {
    // @ts-expect-error simulate an environment without matchMedia
    window.matchMedia = undefined
    expect(isDesktopViewport()).toBe(false)
  })
})
