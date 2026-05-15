/**
 * Tests for FROST Ed25519 cryptographic operations.
 *
 * These tests verify:
 * - Nonce generation produces unique values
 * - Commitment computation
 * - Partial signature computation
 * - Serialization/deserialization compatibility with bytemare/frost format
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  decodeCommitment,
  encodeCommitment,
  decodeSignatureShare,
  zeroMemory,
  buildCommitmentList,
} from './frost'
import { ed25519_FROST } from '@noble/curves/ed25519.js'

// Helper to get value from TRet type (values can be either direct or functions)
function getValue<T>(val: T | (() => T)): T {
  if (typeof val === 'function') {
    return (val as () => T)()
  }
  return val
}

describe('FROST Crypto', () => {
  describe('Identifier', () => {
    it('creates identifiers from numbers', () => {
      const id1 = ed25519_FROST.Identifier.fromNumber(1)
      const id2 = ed25519_FROST.Identifier.fromNumber(2)

      expect(id1).toBeDefined()
      expect(id2).toBeDefined()
      expect(id1).not.toBe(id2)
    })

    it('derives identifiers from strings', () => {
      const alice = ed25519_FROST.Identifier.derive('alice@example.com')
      const bob = ed25519_FROST.Identifier.derive('bob@example.com')

      expect(alice).toBeDefined()
      expect(bob).toBeDefined()
      expect(alice).not.toBe(bob)
    })
  })

  describe('trustedDealer', () => {
    it('generates key shares for 2-of-2 threshold', () => {
      const signers = { min: 2, max: 2 }
      const id1 = ed25519_FROST.Identifier.fromNumber(1)
      const id2 = ed25519_FROST.Identifier.fromNumber(2)

      const deal = ed25519_FROST.trustedDealer(signers, [id1, id2])

      expect(deal.public).toBeDefined()
      expect(deal.public.signers.min).toBe(2)
      expect(deal.public.signers.max).toBe(2)
      expect(deal.secretShares[id1]).toBeDefined()
      expect(deal.secretShares[id2]).toBeDefined()
    })
  })

  describe('commit', () => {
    let deal: ReturnType<typeof ed25519_FROST.trustedDealer>
    let id1: string
    let id2: string

    beforeEach(() => {
      const signers = { min: 2, max: 2 }
      id1 = ed25519_FROST.Identifier.fromNumber(1)
      id2 = ed25519_FROST.Identifier.fromNumber(2)
      deal = ed25519_FROST.trustedDealer(signers, [id1, id2])
    })

    it('generates nonces and commitments', () => {
      const commit1 = ed25519_FROST.commit(deal.secretShares[id1])
      const commit2 = ed25519_FROST.commit(deal.secretShares[id2])

      expect(getValue(commit1.nonces.hiding)).toBeInstanceOf(Uint8Array)
      expect(getValue(commit1.nonces.binding)).toBeInstanceOf(Uint8Array)
      expect(getValue(commit1.commitments.hiding)).toBeInstanceOf(Uint8Array)
      expect(getValue(commit1.commitments.binding)).toBeInstanceOf(Uint8Array)

      expect(getValue(commit2.nonces.hiding)).toBeInstanceOf(Uint8Array)
      expect(getValue(commit2.nonces.binding)).toBeInstanceOf(Uint8Array)
    })

    it('generates unique nonces each time', () => {
      const commits = Array.from({ length: 10 }, () =>
        ed25519_FROST.commit(deal.secretShares[id1])
      )

      // Check all hiding nonces are unique
      const hidingSet = new Set(commits.map((c) => Buffer.from(getValue(c.nonces.hiding)).toString('hex')))
      expect(hidingSet.size).toBe(10)

      // Check all binding nonces are unique
      const bindingSet = new Set(commits.map((c) => Buffer.from(getValue(c.nonces.binding)).toString('hex')))
      expect(bindingSet.size).toBe(10)
    })
  })

  describe('signing flow', () => {
    let deal: ReturnType<typeof ed25519_FROST.trustedDealer>
    let id1: string
    let id2: string
    const message = new TextEncoder().encode('test message')

    beforeEach(() => {
      const signers = { min: 2, max: 2 }
      id1 = ed25519_FROST.Identifier.fromNumber(1)
      id2 = ed25519_FROST.Identifier.fromNumber(2)
      deal = ed25519_FROST.trustedDealer(signers, [id1, id2])
    })

    it('completes full signing flow and produces valid signature', () => {
      // Round 1: Both parties commit
      const commit1 = ed25519_FROST.commit(deal.secretShares[id1])
      const commit2 = ed25519_FROST.commit(deal.secretShares[id2])

      const commitmentList = [commit1.commitments, commit2.commitments]

      // Round 2: Both parties sign
      const sig1 = ed25519_FROST.signShare(
        deal.secretShares[id1],
        deal.public,
        commit1.nonces,
        commitmentList,
        message
      )
      const sig2 = ed25519_FROST.signShare(
        deal.secretShares[id2],
        deal.public,
        commit2.nonces,
        commitmentList,
        message
      )

      // Aggregate signatures
      const signature = ed25519_FROST.aggregate(
        deal.public,
        commitmentList,
        message,
        { [id1]: getValue(sig1), [id2]: getValue(sig2) }
      )

      expect(getValue(signature)).toBeInstanceOf(Uint8Array)
      expect(getValue(signature).length).toBe(64) // Ed25519 signature size

      // Verify signature
      // Extract group public key from commitments
      const commitments = getValue(deal.public.commitments)
      const groupKey = commitments[0]
      const valid = ed25519_FROST.verify(getValue(signature), message, groupKey)
      expect(valid).toBe(true)
    })

    it('produces different signatures for different messages', () => {
      const msg1 = new TextEncoder().encode('message 1')
      const msg2 = new TextEncoder().encode('message 2')

      // Sign message 1
      const commit1a = ed25519_FROST.commit(deal.secretShares[id1])
      const commit2a = ed25519_FROST.commit(deal.secretShares[id2])
      const commitListA = [commit1a.commitments, commit2a.commitments]

      const sig1a = ed25519_FROST.signShare(deal.secretShares[id1], deal.public, commit1a.nonces, commitListA, msg1)
      const sig2a = ed25519_FROST.signShare(deal.secretShares[id2], deal.public, commit2a.nonces, commitListA, msg1)
      const sigA = ed25519_FROST.aggregate(deal.public, commitListA, msg1, { [id1]: getValue(sig1a), [id2]: getValue(sig2a) })

      // Sign message 2
      const commit1b = ed25519_FROST.commit(deal.secretShares[id1])
      const commit2b = ed25519_FROST.commit(deal.secretShares[id2])
      const commitListB = [commit1b.commitments, commit2b.commitments]

      const sig1b = ed25519_FROST.signShare(deal.secretShares[id1], deal.public, commit1b.nonces, commitListB, msg2)
      const sig2b = ed25519_FROST.signShare(deal.secretShares[id2], deal.public, commit2b.nonces, commitListB, msg2)
      const sigB = ed25519_FROST.aggregate(deal.public, commitListB, msg2, { [id1]: getValue(sig1b), [id2]: getValue(sig2b) })

      // Signatures should be different
      expect(Buffer.from(getValue(sigA)).toString('hex')).not.toBe(Buffer.from(getValue(sigB)).toString('hex'))

      // Both should be valid
      const commitments = getValue(deal.public.commitments)
      const groupKey = commitments[0]
      expect(ed25519_FROST.verify(getValue(sigA), msg1, groupKey)).toBe(true)
      expect(ed25519_FROST.verify(getValue(sigB), msg2, groupKey)).toBe(true)
    })
  })

  describe('commitment encoding', () => {
    it('encodes and decodes commitments correctly', () => {
      const signerId = 2
      const hiding = new Uint8Array(32).fill(0x42)
      const binding = new Uint8Array(32).fill(0x43)

      const encoded = encodeCommitment(signerId, hiding, binding)

      expect(encoded.length).toBe(1 + 8 + 2 + 32 + 32) // 75 bytes

      const decoded = decodeCommitment(encoded)

      expect(decoded.signerId).toBe(signerId)
      expect(Buffer.from(decoded.hiding).toString('hex')).toBe(Buffer.from(hiding).toString('hex'))
      expect(Buffer.from(decoded.binding).toString('hex')).toBe(Buffer.from(binding).toString('hex'))
    })

    it('throws on invalid commitment length', () => {
      const shortData = new Uint8Array(10)
      expect(() => decodeCommitment(shortData)).toThrow('Invalid commitment length')
    })

    it('throws on wrong group ID', () => {
      const data = new Uint8Array(75)
      data[0] = 0x01 // Wrong group ID
      expect(() => decodeCommitment(data)).toThrow('Unexpected group ID')
    })
  })

  describe('signature share encoding', () => {
    it('decodes signature share correctly', () => {
      // Create a mock signature share in bytemare/frost format
      const groupId = 0x06
      const signerId = 2
      const share = new Uint8Array(32).fill(0x55)

      const encoded = new Uint8Array(1 + 2 + 32)
      encoded[0] = groupId
      encoded[1] = signerId & 0xff
      encoded[2] = (signerId >> 8) & 0xff
      encoded.set(share, 3)

      const decoded = decodeSignatureShare(encoded)

      expect(decoded.signerId).toBe(signerId)
      expect(Buffer.from(decoded.share).toString('hex')).toBe(Buffer.from(share).toString('hex'))
    })

    it('throws on invalid signature share length', () => {
      const shortData = new Uint8Array(10)
      expect(() => decodeSignatureShare(shortData)).toThrow('Invalid signature share length')
    })

    it('throws on wrong group ID', () => {
      const data = new Uint8Array(35)
      data[0] = 0x01 // Wrong group ID
      expect(() => decodeSignatureShare(data)).toThrow('Unexpected group ID')
    })
  })

  describe('buildCommitmentList', () => {
    it('builds sorted commitment list from encoded commitments', () => {
      const serverCommitment = encodeCommitment(1, new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x12))
      const clientCommitment = encodeCommitment(2, new Uint8Array(32).fill(0x21), new Uint8Array(32).fill(0x22))

      const list = buildCommitmentList(serverCommitment, clientCommitment)

      expect(list.length).toBe(2)
      // Should be sorted by signer ID
      expect(list[0].identifier).toBe(ed25519_FROST.Identifier.fromNumber(1))
      expect(list[1].identifier).toBe(ed25519_FROST.Identifier.fromNumber(2))
    })

    it('handles reversed order input', () => {
      const serverCommitment = encodeCommitment(1, new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x12))
      const clientCommitment = encodeCommitment(2, new Uint8Array(32).fill(0x21), new Uint8Array(32).fill(0x22))

      // Pass in reversed order
      const list = buildCommitmentList(clientCommitment, serverCommitment)

      expect(list.length).toBe(2)
      // Should still be sorted by signer ID
      expect(list[0].identifier).toBe(ed25519_FROST.Identifier.fromNumber(1))
      expect(list[1].identifier).toBe(ed25519_FROST.Identifier.fromNumber(2))
    })
  })

  describe('zeroMemory', () => {
    it('zeroes all bytes in array', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

      zeroMemory(data)

      expect(data.every((b) => b === 0)).toBe(true)
    })

    it('handles empty array', () => {
      const data = new Uint8Array(0)
      expect(() => zeroMemory(data)).not.toThrow()
    })
  })
})
