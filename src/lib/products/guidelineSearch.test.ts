import { describe, expect, it } from 'vitest'
import { guidelineQuery } from './guidelineSearch'

describe('guideline search query', () => {
  it('every word is required', () => {
    expect(guidelineQuery('non-warrantable condo')).toBe('non & warrantable & condo')
  })
  it('an abbreviation also matches its spelled-out form', () => {
    expect(guidelineQuery('LLC guaranty')).toBe('(llc | (limited <-> liability <-> company)) & guaranty')
    expect(guidelineQuery('PPP')).toBe('(ppp | (prepayment <-> penalty))')
  })
  it('quoted text is a phrase', () => {
    expect(guidelineQuery('"first time investor" DSCR')).toBe('(first <-> time <-> investor) & (dscr | (debt <-> service <-> coverage <-> ratio))')
  })
  it('symbols are dropped, and nothing searchable gives null', () => {
    expect(guidelineQuery("50(a)(6) can't")).toBe('50 & a & 6 & can & t')
    expect(guidelineQuery('  !? ')).toBeNull()
  })
})
