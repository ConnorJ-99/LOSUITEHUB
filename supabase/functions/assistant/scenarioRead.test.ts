import { describe, expect, it } from 'vitest'
import { CITIZENSHIPS, DOC_TYPES, FEATURES, LIENS, MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, OCCUPANCIES, PRODUCT_FAMILIES } from '../../../src/lib/products/taxonomy'
import {
  normalizeScenarioRead,
  SCENARIO_CITIZENSHIPS,
  SCENARIO_DOC_TYPES,
  SCENARIO_FAMILIES,
  SCENARIO_FEATURES,
  SCENARIO_LIENS,
  SCENARIO_OCCUPANCIES,
  SCENARIO_PROPERTY_TYPES,
  SCENARIO_PURPOSES,
  SCENARIO_SCHEMA,
} from './scenarioRead'

const blank = {
  lien: null, family: null, docType: null, features: [], purpose: null, occupancy: null, propertyType: null, units: null, state: null, county: null, purchasePrice: null, value: null, loanAmount: null,
  downPaymentPct: null, ltvPct: null, firstLienBalance: null, fico: null, dti: null, reservesMonths: null, dscr: null, citizenship: null, mortgageLates12: null, mortgageLates24: null, bkSeasoningMonths: null,
  fcSeasoningMonths: null, selfEmployedYears: null, firstTimeBuyer: null, homestead: null,
}

describe('lists match the app', () => {
  it('uses the same words as the search form', () => {
    expect([...SCENARIO_FAMILIES]).toEqual([...PRODUCT_FAMILIES.values, 'any'])
    expect([...SCENARIO_LIENS]).toEqual(LIENS.values)
    expect([...SCENARIO_DOC_TYPES]).toEqual(DOC_TYPES.values)
    expect([...SCENARIO_FEATURES]).toEqual(FEATURES.values)
    expect([...SCENARIO_PURPOSES]).toEqual(MATRIX_PURPOSES.values)
    expect([...SCENARIO_OCCUPANCIES]).toEqual(OCCUPANCIES.values)
    expect([...SCENARIO_PROPERTY_TYPES]).toEqual(MATRIX_PROPERTY_TYPES.values)
    expect([...SCENARIO_CITIZENSHIPS]).toEqual(CITIZENSHIPS.values)
  })
  it('the schema asks for every field (structured outputs need them all required)', () => {
    const read = SCENARIO_SCHEMA.properties.read
    expect([...read.required].sort()).toEqual(Object.keys(blank).sort())
  })
})

describe('reading a sentence', () => {
  const sentence = 'Conventional purchase, $450k, 5% down, 720 FICO, primary SFR in Frisco'
  const reading = normalizeScenarioRead(
    {
      read: { ...blank, lien: 'first', family: 'conventional', docType: 'full_doc', purpose: 'purchase', occupancy: 'primary', propertyType: 'sfr_pud', state: 'TX', purchasePrice: 450000, downPaymentPct: 5, fico: 720 },
      evidence: [
        { field: 'family', words: 'Conventional' },
        { field: 'purchasePrice', words: '$450k' },
        { field: 'downPaymentPct', words: '5% down' },
        { field: 'fico', words: '720 FICO' },
        { field: 'state', words: 'Frisco' },
        { field: 'dti', words: '43% DTI' },
      ],
      unclear: [],
    },
    sentence,
  )

  it('works out the loan amount from the down payment in code', () => {
    if ('error' in reading) throw new Error(reading.error)
    expect(reading.read).toMatchObject({ family: 'conventional', purpose: 'purchase', purchasePrice: 450000, loanAmount: 427500, fico: 720, state: 'TX' })
  })
  it('keeps the words each field came from, and drops evidence for fields it did not fill', () => {
    if ('error' in reading) throw new Error(reading.error)
    expect(reading.evidence.map((e) => [e.field, e.words, e.found])).toEqual([
      ['family', 'Conventional', true],
      ['purchasePrice', '$450k', true],
      ['loanAmount', '5% down', true],
      ['fico', '720 FICO', true],
      ['state', 'Frisco', true],
    ])
  })
  it('an LTV becomes a loan amount on the value', () => {
    const r = normalizeScenarioRead({ read: { ...blank, value: 600000, ltvPct: 75, purpose: 'cash_out' }, evidence: [], unclear: [] }, 'cash out refi, worth 600k, 75% LTV')
    expect('error' in r ? r : r.read.loanAmount).toBe(450000)
  })
  it('drops impossible values instead of guessing', () => {
    const r = normalizeScenarioRead({ read: { ...blank, fico: 900, dti: 140, state: 'Texas', family: 'subprime', features: ['dpa', 'magic', 'dpa'], units: 25, propertyType: 'two_to_four' }, evidence: [], unclear: [] }, 'x')
    if ('error' in r) throw new Error(r.error)
    expect(r.read).toMatchObject({ fico: null, dti: null, state: null, family: null, features: ['dpa'], propertyType: 'two_to_four', units: 2 })
    // 7 units is a 5+ unit building, whatever type was read.
    const big = normalizeScenarioRead({ read: { ...blank, units: 7, propertyType: 'two_to_four' }, evidence: [], unclear: [] }, 'x')
    if ('error' in big) throw new Error(big.error)
    expect(big.read).toMatchObject({ propertyType: 'five_plus', units: 7 })
  })
  it('flags words that are not really in the sentence', () => {
    const r = normalizeScenarioRead({ read: { ...blank, fico: 700 }, evidence: [{ field: 'fico', words: '700 credit score' }], unclear: ['Is this a purchase?', 'a', 'b', 'c'] }, 'DSCR loan, 700 fico')
    if ('error' in r) throw new Error(r.error)
    expect(r.evidence).toEqual([{ field: 'fico', words: '700 credit score', found: false }])
    expect(r.unclear).toHaveLength(3)
  })
  it('says so when there is no scenario at all', () => {
    expect(normalizeScenarioRead({ read: blank, evidence: [], unclear: [] }, 'hello')).toHaveProperty('error')
    expect(normalizeScenarioRead(null, 'x')).toEqual({ error: 'The assistant returned no reading. Try again.' })
  })
})
