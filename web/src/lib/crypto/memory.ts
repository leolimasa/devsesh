/**
 * Memory Security Utilities
 *
 * Functions for securely handling sensitive data in memory.
 * [req.obmwbr] - Memory zeroing on terminate
 */

/**
 * Securely zeroes a byte array to clear sensitive data from memory.
 * Should be called when sensitive data (like cryptographic keys or nonces)
 * is no longer needed to minimize the window of exposure.
 *
 * Note: JavaScript does not guarantee immediate garbage collection,
 * but zeroing the data removes it from the buffer's contents immediately.
 *
 * @param data - The byte array to zero
 */
export function zeroMemory(data: Uint8Array): void {
  data.fill(0)
}

/**
 * Zeros multiple byte arrays at once.
 *
 * @param arrays - The byte arrays to zero
 */
export function zeroAll(...arrays: (Uint8Array | null | undefined)[]): void {
  for (const arr of arrays) {
    if (arr) {
      zeroMemory(arr)
    }
  }
}
