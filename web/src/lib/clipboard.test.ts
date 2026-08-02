import { describe, it, expect } from "vitest"
import { clipboardBufferFor, clipboardKeyAction } from "./clipboard"
import type { Session, SessionUpdate } from "@/types/api"

function key(over: Partial<Parameters<typeof clipboardKeyAction>[0]>) {
  return { type: "keydown", code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over }
}

describe("clipboardKeyAction", () => {
  it("mac: ⌘V is paste, ⌘⇧C is flush", () => {
    expect(clipboardKeyAction(key({ metaKey: true, code: "KeyV" }), true)).toBe("paste")
    expect(clipboardKeyAction(key({ metaKey: true, shiftKey: true, code: "KeyC" }), true)).toBe("flush")
  })
  it("mac: plain ⌘C is NOT flush (must not clobber copy-selection)", () => {
    expect(clipboardKeyAction(key({ metaKey: true, code: "KeyC" }), true)).toBeNull()
  })
  it("non-mac: Ctrl+Shift+V is paste, Ctrl+Shift+C is flush", () => {
    expect(clipboardKeyAction(key({ ctrlKey: true, shiftKey: true, code: "KeyV" }), false)).toBe("paste")
    expect(clipboardKeyAction(key({ ctrlKey: true, shiftKey: true, code: "KeyC" }), false)).toBe("flush")
  })
  it("non-mac: ⌘V does not paste", () => {
    expect(clipboardKeyAction(key({ metaKey: true, code: "KeyV" }), false)).toBeNull()
  })
  it("only keydown counts", () => {
    expect(clipboardKeyAction(key({ type: "keyup", metaKey: true, code: "KeyV" }), true)).toBeNull()
  })
})

function ev(partial: Partial<SessionUpdate>): SessionUpdate {
  return {
    event: "clipboard",
    session_id: "s1",
    session: {} as Session,
    clipboard: "hi",
    ...partial,
  }
}

describe("clipboardBufferFor", () => {
  it("buffers a clipboard event for the current session", () => {
    expect(clipboardBufferFor(ev({ clipboard: "hello" }), "s1")).toEqual({
      text: "hello",
      bytes: 5,
      status: "ready",
    })
  })

  it("ignores a clipboard event for a different session (scoping)", () => {
    expect(clipboardBufferFor(ev({ session_id: "other" }), "s1")).toBeNull()
  })

  it("ignores non-clipboard events", () => {
    expect(clipboardBufferFor(ev({ event: "ping" }), "s1")).toBeNull()
  })

  it("counts UTF-8 bytes, not characters", () => {
    // "é" is 2 bytes in UTF-8.
    expect(clipboardBufferFor(ev({ clipboard: "é" }), "s1")?.bytes).toBe(2)
  })

  it("handles a missing clipboard field as empty text", () => {
    expect(clipboardBufferFor(ev({ clipboard: undefined }), "s1")).toEqual({
      text: "",
      bytes: 0,
      status: "ready",
    })
  })
})
