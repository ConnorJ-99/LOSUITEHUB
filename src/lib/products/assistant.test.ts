import { describe, expect, it } from 'vitest'
import type { ScenarioRead } from '../../../supabase/functions/assistant/scenarioRead'
import { applyReading, questionQuery, questionTerms, rankPassages, readChips, resultSummary } from './assistant'
import { search } from './engine'
import { blankScenario } from './scenarioForm'
import { dscrCatalog } from './testCatalog'

const none: ScenarioRead = {
  lien: null, family: null, docType: null, features: [], purpose: null, occupancy: null, propertyType: null, units: null, state: null, county: null, purchasePrice: null, value: null, loanAmount: null,
  firstLienBalance: null, fico: null, dti: null, reservesMonths: null, dscr: null, citizenship: null, mortgageLates12: null, mortgageLates24: null, bkSeasoningMonths: null, fcSeasoningMonths: null,
  selfEmployedYears: null, firstTimeBuyer: null, homestead: null,
}

describe('putting a reading into the search form', () => {
  it('a conventional purchase: the price is also the value', () => {
    const s = applyReading(blankScenario(), { ...none, family: 'conventional', purpose: 'purchase', purchasePrice: 450000, loanAmount: 427500, fico: 720, state: 'TX' })
    expect(s).toMatchObject({ lien: 'first', family: 'conventional', purpose: 'purchase', purchasePrice: 450000, value: 450000, loanAmount: 427500, fico: 720 })
  })
  it('a DSCR closed-end second: non-QM, investment, keeps the 1st lien', () => {
    const s = applyReading(blankScenario(), { ...none, lien: 'ces', docType: 'dscr', occupancy: 'investment', purpose: 'cash_out', value: 500000, firstLienBalance: 250000, loanAmount: 100000, fico: 740 })
    expect(s).toMatchObject({ lien: 'ces', family: 'non_qm', docType: 'dscr', occupancy: 'investment', purchasePrice: null, value: 500000, firstLienBalance: 250000, loanAmount: 100000 })
  })
  it('only what was said changes; the rest comes from the starting point', () => {
    const base = { ...blankScenario(), fico: 680, dti: 41, county: 'Collin' }
    expect(applyReading(base, { ...none, fico: 700 })).toMatchObject({ fico: 700, dti: 41, county: 'Collin' })
  })
  it('the search after reading is the same rule-based search (no AI)', () => {
    const s = applyReading(blankScenario(), { ...none, lien: 'ces', docType: 'dscr', occupancy: 'investment', purpose: 'cash_out', value: 500000, firstLienBalance: 250000, loanAmount: 100000, fico: 740 })
    const r = search(s, dscrCatalog)
    expect(r.eligible.length + r.ineligible.length).toBeGreaterThan(0)
    for (const x of [...r.eligible, ...r.ineligible]) expect(x.program).toMatchObject({ lien: 'ces', family: 'non_qm' })
  })
})

describe('"I read this as" chips', () => {
  it('in form order, with the words and a check flag', () => {
    const chips = readChips({ ...none, family: 'conventional', fico: 720, purchasePrice: 450000, firstTimeBuyer: true }, [
      { field: 'fico', words: '720', found: true },
      { field: 'purchasePrice', words: '$450 thousand', found: false },
    ])
    expect(chips).toEqual([
      { field: 'family', text: 'Conventional', words: null, check: false },
      { field: 'purchasePrice', text: 'Price $450,000', words: '$450 thousand', check: true },
      { field: 'fico', text: 'FICO 720', words: '720', check: false },
      { field: 'firstTimeBuyer', text: 'First-time buyer', words: null, check: false },
    ])
  })
})

describe('finding passages for a question', () => {
  it('keeps the meaningful words and abbreviations', () => {
    expect(questionTerms('Can a DSCR loan close in an LLC?')).toEqual(['dscr', 'loan', 'close', 'llc'])
    expect(questionQuery('Is an LLC allowed?')).toBe('(llc | (limited <-> liability <-> company))')
    expect(questionQuery('is it ok?')).toBeNull()
  })
  it('ranks passages by matching words, headings count double', () => {
    const passages = [
      { id: 'a', heading: 'Reserves', body: 'Six months of reserves are required.' },
      { id: 'b', heading: 'Vesting', body: 'Loans may close in the name of a limited liability company.' },
      { id: 'c', heading: 'LLC vesting', body: 'Members must guarantee the loan.' },
    ]
    expect(rankPassages('Is an LLC allowed?', passages, 5).map((p) => p.id)).toEqual(['c', 'b'])
    expect(rankPassages('Is an LLC allowed?', passages, 1).map((p) => p.id)).toEqual(['c'])
  })
})

describe('results kept in a chat', () => {
  it('lists what fits and the closest that do not, with what was not searched', () => {
    const s = applyReading(blankScenario(), { ...none, lien: 'ces', docType: 'dscr', occupancy: 'investment', purpose: 'cash_out', value: 500000, firstLienBalance: 250000, loanAmount: 100000, fico: 740 })
    const r = search(s, dscrCatalog)
    const summary = resultSummary(s, r)
    expect(summary.fits.length).toBe(Math.min(6, r.eligible.length))
    expect(summary.close.length).toBe(Math.min(3, r.ineligible.length))
    expect(summary.typeChips[0]).toBe('Closed-end 2nd')
    for (const line of summary.fits) expect(line.detail).toMatch(/^Max CLTV \d/)
    if (r.notSearched.count) expect(summary.notSearched).toMatch(/not searched/)
  })
})
