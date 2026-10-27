import { describe, expect, it } from 'vitest'
import { headingOf, MAX_PASSAGE, splitIntoPassages } from './passages'

describe('headings', () => {
  it('numbered sections', () => {
    expect(headingOf('5.2 Vesting')).toEqual({ sectionNumber: '5.2', heading: 'Vesting' })
    expect(headingOf('Section 3.6 – High-LTV Purchases')).toEqual({ sectionNumber: '3.6', heading: 'High-LTV Purchases' })
    expect(headingOf('§7.1 Prepayment Penalty')).toEqual({ sectionNumber: '7.1', heading: 'Prepayment Penalty' })
    expect(headingOf('4 Eligibility')).toEqual({ sectionNumber: '4', heading: 'Eligibility' })
  })
  it('ALL-CAPS titles', () => {
    expect(headingOf('PROGRAM OVERVIEW')).toEqual({ sectionNumber: null, heading: 'PROGRAM OVERVIEW' })
  })
  it('not sentences, list items or long lines', () => {
    expect(headingOf('1. The borrower must provide two years of returns.')).toBeNull()
    expect(headingOf('2 years of tax returns are required')).toBeNull()
    expect(headingOf('5.2 Title may be vested in a limited liability company provided all members holding a 25% interest sign a guaranty')).toBeNull()
    expect(headingOf('LTV')).toBeNull()
  })
})

describe('splitting a guideline into passages', () => {
  const header = 'Sample Lending DSCR Guidelines – rev. 10/2026'
  const pages = [
    [header, 'PROGRAM OVERVIEW', 'DSCR loans for investment properties held by indi-', 'viduals or LLCs.', 'Page 1 of 3'],
    [header, '5.2 Vesting', 'Title may be vested in a limited liability company provided all members', 'holding 25% or more sign a personal guaranty.', 'Page 2 of 3'],
    [header, 'held in trust is not eligible.', '7.1 Prepayment Penalty', 'Terms of 1, 2, 3 or 5 years are available.', 'Page 3 of 3'],
  ]
  const ps = splitIntoPassages(pages)

  it('a passage per section, with its page; running headers and page numbers dropped; hyphenated words mended', () => {
    expect(ps).toEqual([
      { position: 0, page: 1, sectionNumber: null, heading: 'PROGRAM OVERVIEW', body: 'DSCR loans for investment properties held by individuals or LLCs.' },
      { position: 1, page: 2, sectionNumber: '5.2', heading: 'Vesting', body: 'Title may be vested in a limited liability company provided all members holding 25% or more sign a personal guaranty.' },
      { position: 2, page: 3, sectionNumber: '5.2', heading: 'Vesting', body: 'held in trust is not eligible.' },
      { position: 3, page: 3, sectionNumber: '7.1', heading: 'Prepayment Penalty', body: 'Terms of 1, 2, 3 or 5 years are available.' },
    ])
  })
  it('a section running onto the next page starts a new passage there, so every citation is one exact page', () => {
    expect(ps.filter((p) => p.sectionNumber === '5.2').map((p) => p.page)).toEqual([2, 3])
  })
  it('long sections are split at sentence ends', () => {
    const sentence = 'Reserves must be documented with two months of statements. '
    const long = splitIntoPassages([['6.1 Reserves', sentence.repeat(60)]])
    expect(long.length).toBeGreaterThan(1)
    expect(long.every((p) => p.body.length <= MAX_PASSAGE && p.body.endsWith('.'))).toBe(true)
    expect(long.every((p) => p.heading === 'Reserves')).toBe(true)
  })
  it('a scanned PDF with no text gives no passages', () => {
    expect(splitIntoPassages([[], []])).toEqual([])
  })
})
