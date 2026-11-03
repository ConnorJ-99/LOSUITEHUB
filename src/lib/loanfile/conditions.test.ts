import { describe, expect, it } from 'vitest'
import { conditionCounts, guessParty, splitConditions } from './conditions'

describe('splitting pasted conditions', () => {
  it('starts a condition at each number and keeps wrapped lines together', () => {
    const pasted = [
      '1. Provide a signed letter of explanation for the $4,500 deposit on 9/14',
      '   into checking ending 1234.',
      '2) Updated title commitment with the correct vesting',
      '',
      '#103 Appraisal: provide a 1004D completion certificate',
      '104 - Fully executed amendment to contract for the new closing date',
    ].join('\r\n')
    expect(splitConditions(pasted)).toEqual([
      { body: 'Provide a signed letter of explanation for the $4,500 deposit on 9/14 into checking ending 1234.', party: 'borrower' },
      { body: 'Updated title commitment with the correct vesting', party: 'title' },
      { body: 'Appraisal: provide a 1004D completion certificate', party: 'appraisal' },
      { body: 'Fully executed amendment to contract for the new closing date', party: 'realtor' },
    ])
  })
  it('reads bullets and lender codes', () => {
    expect(splitConditions('• Two most recent paystubs\n- Rate lock confirmation\nPTD: Final CD signed').map((c) => c.body)).toEqual(['Two most recent paystubs', 'Rate lock confirmation', 'Final CD signed'])
  })
  it('a plain list is one condition per line', () => {
    expect(splitConditions('W-2s for 2024 and 2025\nHomeowners insurance declarations page\n\n')).toEqual([
      { body: 'W-2s for 2024 and 2025', party: 'borrower' },
      { body: 'Homeowners insurance declarations page', party: 'borrower' },
    ])
  })
  it('keeps a dollar amount or date that starts a wrapped line', () => {
    expect(splitConditions('1. Explain the deposit of\n$4,500 on 9/14\n2. Paystubs').map((c) => c.body)).toEqual(['Explain the deposit of $4,500 on 9/14', 'Paystubs'])
  })
  it('nothing pasted is nothing', () => {
    expect(splitConditions('  \n\n ')).toEqual([])
  })
})

describe('who a condition is on', () => {
  it('guesses from the words, else the borrower', () => {
    expect(guessParty('Escrow to provide wire instructions')).toBe('title')
    expect(guessParty('Updated appraisal with corrected comps')).toBe('appraisal')
    expect(guessParty('Listing agent to provide the HOA addendum')).toBe('realtor')
    expect(guessParty('Re-run DU with the updated income')).toBe('processor_lo')
    expect(guessParty('Most recent 2 months bank statements')).toBe('borrower')
  })
})

describe('condition counts', () => {
  it('counts cleared and waived as cleared; submitted is handed in but not cleared', () => {
    expect(conditionCounts(['cleared', 'waived', 'submitted', 'outstanding'])).toEqual({ total: 4, cleared: 2, allHandedIn: false })
    expect(conditionCounts(['cleared', 'waived', 'submitted'])).toEqual({ total: 3, cleared: 2, allHandedIn: true })
  })
  it('no conditions is not "all handed in"', () => {
    expect(conditionCounts([])).toEqual({ total: 0, cleared: 0, allHandedIn: false })
  })
})
