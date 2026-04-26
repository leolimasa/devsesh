export function encodeBase64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
}

export function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded)
  return new Uint8Array(binary.length).map((_, i) => binary.charCodeAt(i))
}

export function encodeBase64URL(data: Uint8Array): string {
  let base64 = btoa(String.fromCharCode(...data))
  base64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return base64
}

export function decodeBase64URL(encoded: string): Uint8Array {
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  const binary = atob(base64)
  return new Uint8Array(binary.length).map((_, i) => binary.charCodeAt(i))
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}
