import { describe, it, expect } from "vitest"
import { encodeStep, encodeSpec, previewSpec, PRESET_QUICK_KEYS } from "./quick-keys"
import type { QuickKeyStep } from "@/types/api"

describe("encodeStep", () => {
  it("encodes ctrl+c as 0x03", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: true, alt: false, shift: false, key: "c" }
    const result = encodeStep(step)
    expect(result).toEqual(new Uint8Array([0x03]))
  })

  it("encodes ctrl+d as 0x04", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: true, alt: false, shift: false, key: "d" }
    const result = encodeStep(step)
    expect(result).toEqual(new Uint8Array([0x04]))
  })

  it("encodes ctrl+z as 0x1a", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: true, alt: false, shift: false, key: "z" }
    const result = encodeStep(step)
    expect(result).toEqual(new Uint8Array([0x1a]))
  })

  it("encodes ctrl+l as 0x0c", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: true, alt: false, shift: false, key: "l" }
    const result = encodeStep(step)
    expect(result).toEqual(new Uint8Array([0x0c]))
  })

  it("encodes ctrl+a as 0x01", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: true, alt: false, shift: false, key: "a" }
    const result = encodeStep(step)
    expect(result).toEqual(new Uint8Array([0x01]))
  })

  it("encodes ctrl+e as 0x05", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: true, alt: false, shift: false, key: "e" }
    const result = encodeStep(step)
    expect(result).toEqual(new Uint8Array([0x05]))
  })

  it("encodes esc as 0x1b", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: false, alt: false, shift: false, key: "escape" }
    const result = encodeStep(step)
    expect(result).toEqual(new Uint8Array([0x1b]))
  })

  it("encodes tab as 0x09", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: false, alt: false, shift: false, key: "tab" }
    const result = encodeStep(step)
    expect(result).toEqual(new Uint8Array([0x09]))
  })

  it("encodes arrow keys", () => {
    const up = encodeStep({ type: "combo", ctrl: false, alt: false, shift: false, key: "up" })
    expect(up).toEqual(new Uint8Array([0x1b, 0x5b, 0x41]))

    const down = encodeStep({ type: "combo", ctrl: false, alt: false, shift: false, key: "down" })
    expect(down).toEqual(new Uint8Array([0x1b, 0x5b, 0x42]))

    const right = encodeStep({ type: "combo", ctrl: false, alt: false, shift: false, key: "right" })
    expect(right).toEqual(new Uint8Array([0x1b, 0x5b, 0x43]))

    const left = encodeStep({ type: "combo", ctrl: false, alt: false, shift: false, key: "left" })
    expect(left).toEqual(new Uint8Array([0x1b, 0x5b, 0x44]))
  })

  it("encodes F-keys with escape sequences", () => {
    const f1 = encodeStep({ type: "combo", ctrl: false, alt: false, shift: false, key: "f1" })
    expect(f1).toEqual(new Uint8Array([0x1b, 0x4f, 0x50]))

    const f12 = encodeStep({ type: "combo", ctrl: false, alt: false, shift: false, key: "f12" })
    expect(f12).toEqual(new Uint8Array([0x1b, 0x5b, 0x32, 0x34, 0x7e]))
  })

  it("encodes navigation keys", () => {
    const home = encodeStep({ type: "combo", ctrl: false, alt: false, shift: false, key: "home" })
    expect(home).toEqual(new Uint8Array([0x1b, 0x5b, 0x48]))

    const end = encodeStep({ type: "combo", ctrl: false, alt: false, shift: false, key: "end" })
    expect(end).toEqual(new Uint8Array([0x1b, 0x5b, 0x46]))

    const pgup = encodeStep({ type: "combo", ctrl: false, alt: false, shift: false, key: "page up" })
    expect(pgup).toEqual(new Uint8Array([0x1b, 0x5b, 0x35, 0x7e]))

    const pgdn = encodeStep({ type: "combo", ctrl: false, alt: false, shift: false, key: "page down" })
    expect(pgdn).toEqual(new Uint8Array([0x1b, 0x5b, 0x36, 0x7e]))
  })

  it("prefixes ESC for Alt+letter", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: false, alt: true, shift: false, key: "b" }
    expect(encodeStep(step)).toEqual(new Uint8Array([0x1b, 0x62]))
  })

  it("prefixes ESC for Alt+Ctrl+letter", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: true, alt: true, shift: false, key: "c" }
    expect(encodeStep(step)).toEqual(new Uint8Array([0x1b, 0x03]))
  })

  it("uppercases bare letter for Shift", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: false, alt: false, shift: true, key: "a" }
    expect(Array.from(encodeStep(step))).toEqual(["A".charCodeAt(0)])
  })

  it("encodes Shift+Tab as back-tab (ESC [ Z)", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: false, alt: false, shift: true, key: "tab" }
    expect(encodeStep(step)).toEqual(new Uint8Array([0x1b, 0x5b, 0x5a]))
  })

  it("encodes Shift+Up as a modified CSI (ESC [ 1 ; 2 A)", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: false, alt: false, shift: true, key: "up" }
    // mod = 1 + shift(1) = 2
    expect(encodeStep(step)).toEqual(new Uint8Array([0x1b, 0x5b, 0x31, 0x3b, 0x32, 0x41]))
  })

  it("encodes Ctrl+Right as a modified CSI (ESC [ 1 ; 5 C)", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: true, alt: false, shift: false, key: "right" }
    // mod = 1 + ctrl(4) = 5
    expect(encodeStep(step)).toEqual(new Uint8Array([0x1b, 0x5b, 0x31, 0x3b, 0x35, 0x43]))
  })

  it("encodes Shift+F5 with a modifier param (ESC [ 15 ; 2 ~)", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: false, alt: false, shift: true, key: "f5" }
    expect(encodeStep(step)).toEqual(new Uint8Array([0x1b, 0x5b, 0x31, 0x35, 0x3b, 0x32, 0x7e]))
  })

  it("encodes Shift+F1 by switching SS3 to CSI (ESC [ 1 ; 2 P)", () => {
    const step: QuickKeyStep = { type: "combo", ctrl: false, alt: false, shift: true, key: "f1" }
    expect(encodeStep(step)).toEqual(new Uint8Array([0x1b, 0x5b, 0x31, 0x3b, 0x32, 0x50]))
  })

  it("encodes literal text", () => {
    const step: QuickKeyStep = { type: "literal", text: "ls -la", enter: false }
    const result = encodeStep(step)
    expect(new TextDecoder().decode(result)).toBe("ls -la")
  })

  it("encodes literal text with Enter", () => {
    const step: QuickKeyStep = { type: "literal", text: "ls", enter: true }
    const result = encodeStep(step)
    expect(result.length).toBe(3)
    expect(result[0]).toBe("l".charCodeAt(0))
    expect(result[1]).toBe("s".charCodeAt(0))
    expect(result[2]).toBe(0x0d)
  })
})

describe("encodeSpec", () => {
  it("concatenates multiple steps (macro)", () => {
    const spec: QuickKeyStep[] = [
      { type: "combo", ctrl: true, alt: false, shift: false, key: "a" },
      { type: "literal", text: "d", enter: false },
    ]
    const result = encodeSpec(spec)
    // ctrl+a (0x01) + "d" (0x64)
    expect(result).toEqual(new Uint8Array([0x01, 0x64]))
  })

  it("concatenates literal + enter macro", () => {
    const spec: QuickKeyStep[] = [
      { type: "literal", text: "ls", enter: true },
      { type: "literal", text: "pwd", enter: true },
    ]
    const result = encodeSpec(spec)
    expect(new TextDecoder().decode(result)).toBe("ls\rpwd\r")
  })
})

describe("previewSpec", () => {
  it("shows hex for control characters", () => {
    const spec: QuickKeyStep[] = [{ type: "combo", ctrl: true, alt: false, shift: false, key: "c" }]
    expect(previewSpec(spec)).toBe("\\x03")
  })

  it("shows printable characters directly", () => {
    const spec: QuickKeyStep[] = [{ type: "literal", text: "hello", enter: false }]
    expect(previewSpec(spec)).toBe("hello")
  })

  it("shows CR for enter", () => {
    const spec: QuickKeyStep[] = [{ type: "literal", text: "", enter: true }]
    expect(previewSpec(spec)).toBe("\\x0d")
  })
})

describe("PRESET_QUICK_KEYS", () => {
  it("includes ctrl+c/d/z/l/a/e", () => {
    const names = PRESET_QUICK_KEYS.map((k) => k.name)
    expect(names).toContain("Ctrl+C")
    expect(names).toContain("Ctrl+D")
    expect(names).toContain("Ctrl+Z")
    expect(names).toContain("Ctrl+L")
    expect(names).toContain("Ctrl+A")
    expect(names).toContain("Ctrl+E")
  })

  it("includes esc, tab, arrows", () => {
    const names = PRESET_QUICK_KEYS.map((k) => k.name)
    expect(names).toContain("Esc")
    expect(names).toContain("Tab")
    expect(names).toContain("Up")
    expect(names).toContain("Down")
    expect(names).toContain("Left")
    expect(names).toContain("Right")
  })

  it("includes F1-F12, home, end, pgup, pgdn", () => {
    const names = PRESET_QUICK_KEYS.map((k) => k.name)
    for (let i = 1; i <= 12; i++) {
      expect(names).toContain(`F${i}`)
    }
    expect(names).toContain("Home")
    expect(names).toContain("End")
    expect(names).toContain("PgUp")
    expect(names).toContain("PgDn")
  })
})
