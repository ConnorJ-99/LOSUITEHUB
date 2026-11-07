import { describe, expect, it } from 'vitest'
import { qrMatrix } from './qr'

describe('booking QR code', () => {
  it('is a square grid with the three corner finder patterns', () => {
    const m = qrMatrix('https://book.example.test/connor')
    expect(m.length).toBeGreaterThanOrEqual(21)
    expect(m.every((row) => row.length === m.length)).toBe(true)
    // Each finder pattern has a solid 7-module top edge.
    const n = m.length
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) expect(m[r].slice(c, c + 7).every(Boolean)).toBe(true)
  })

  it('grows for a longer link', () => {
    expect(qrMatrix(`https://book.example.test/${'x'.repeat(120)}`).length).toBeGreaterThan(qrMatrix('https://b.test').length)
  })
})
