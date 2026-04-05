import { describe, it, expect } from "vitest"
import { cn } from "@/lib/utils"

describe("cn", () => {
  it("merges class names correctly", () => {
    expect(cn("foo", "bar")).toBe("foo bar")
  })

  it("handles conditional classes", () => {
    expect(cn("base", true && "active", false && "disabled")).toBe("base active")
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
