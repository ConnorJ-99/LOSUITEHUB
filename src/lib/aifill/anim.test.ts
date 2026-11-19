import { describe, expect, it } from 'vitest'
import { tickCount } from './animStore'
import { findQuote, highlightPieces } from './sections'

describe('AI Fill animation helpers', () => {
  it('ticks a group count from before to after, one landing at a time', () => {
    // 12 missing → 4 missing across 4 cards.
    expect([1, 2, 3, 4].map((k) => tickCount(12, 4, k, 4))).toEqual([10, 8, 6, 4])
    // A new job can add required fields: the count can go up.
    expect(tickCount(2, 5, 1, 1)).toBe(5)
    expect(tickCount(3, 0, 0, 2)).toBe(3)
  })

  it('finds a quote in the notes ignoring case and spacing', () => {
    const notes = 'Has about $6,500 in checking at Chase.\nCar payment  $480, balance $12,000.'
    expect(findQuote(notes, 'car payment $480')).toEqual([39, 56])
    expect(notes.slice(39, 56)).toBe('Car payment  $480')
    expect(findQuote(notes, 'boat loan')).toBeNull()
    expect(findQuote("Maya's job", 'maya’s job')).toEqual([0, 10])
  })

  it('cuts the notes into plain and highlighted pieces, first quote wins on overlap', () => {
    const pieces = highlightPieces('abcdefghij', [
      { range: [6, 9], section: 'liabilities' },
      { range: [1, 3], section: 'borrower' },
      { range: [2, 5], section: 'income' },
    ])
    expect(pieces).toEqual([
      { text: 'a', section: null },
      { text: 'bc', section: 'borrower' },
      { text: 'def', section: null },
      { text: 'ghi', section: 'liabilities' },
      { text: 'j', section: null },
    ])
  })
})
