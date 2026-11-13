import { describe, expect, it } from 'vitest'
import { conventionalCatalog, program } from '@/lib/products/testCatalog'
import type { Catalog } from '@/lib/products/types'
import { blankOption, blankScenario, type QuoteScenario } from './quote'
import { defaultTermMonths, optionFromProgram, searchScenario, suggestMissing, suggestPrograms } from './suggest'

// The test catalog's mockup case: $400,000, 5% down, 720, primary single family, first-time buyer.
const s: QuoteScenario = { ...blankScenario(), purchasePrice: 400000, downPayment: 20000, creditBucket: 720, firstTimeBuyer: true, county: 'Collin' }
const catalog: Catalog = {
  ...conventionalCatalog,
  programs: [...conventionalCatalog.programs, program('Pinecrest TPO', 'VA 30-Year Fixed', { family: 'va', cells: conventionalCatalog.programs.find((p) => p.family === 'fha')!.cells })],
}

describe('the quote as a search', () => {
  it('searches every 1st-lien product type at the down payment', () => {
    expect(searchScenario(s, false)).toMatchObject({ lien: 'first', family: 'any', docType: 'full_doc', features: [], purpose: 'purchase', occupancy: 'primary', propertyType: 'sfr_pud', units: 1, county: 'Collin', purchasePrice: 400000, value: 400000, loanAmount: 380000, fico: 720, firstTimeBuyer: true })
    expect(searchScenario(s, true).features).toEqual(['dpa'])
  })

  it('a refinance searches on the value and the payoff plus cash out', () => {
    const refi = { ...s, purpose: 'refinance_cash_out' as const, value: 500000, loanBalance: 250000, cashOut: 50000, propertyType: 'two_to_four_unit' as const }
    expect(searchScenario(refi, false)).toMatchObject({ purpose: 'cash_out', purchasePrice: null, value: 500000, loanAmount: 300000, propertyType: 'two_to_four', units: 2 })
  })

  it('says what is missing first', () => {
    expect(suggestMissing(blankScenario())).toEqual(['credit range', 'purchase price', 'down payment'])
    expect(suggestMissing({ ...blankScenario(), purpose: 'refinance_rate_term' })).toEqual(['credit range', 'value', 'loan balance'])
    expect(suggestMissing(s)).toEqual([])
    expect(suggestPrograms(blankScenario(), catalog, [], 4)).toEqual([])
  })
})

describe('suggestions', () => {
  const names = (r: ReturnType<typeof suggestPrograms>) => r.map((x) => `${x.lender.name} · ${x.program.name}`)

  it('puts one of each product type first, leaves out VA unless eligible and DPA unless asked', () => {
    const picks = suggestPrograms(s, catalog, [], 4)
    expect(picks).toHaveLength(4)
    expect(picks.map((p) => p.program.family).slice(0, 2).sort()).toEqual(['conventional', 'fha'])
    expect(names(picks).some((n) => n.includes('VA'))).toBe(false)
    expect(names(picks).some((n) => n.includes('DPA'))).toBe(false)
  })

  it('adds VA for a VA-eligible borrower and DPA programs when asked', () => {
    expect(suggestPrograms({ ...s, vaEligible: true }, catalog, [], 4).map((p) => p.program.family).slice(0, 3).sort()).toEqual(['conventional', 'fha', 'va'])
    expect(names(suggestPrograms({ ...s, showDpa: true }, catalog, [], 20))).toContain('Northline Wholesale · Conventional with DPA')
  })

  it('skips programs already on the quote and fills only the open slots', () => {
    const first = suggestPrograms(s, catalog, [], 1)[0]
    const existing = [blankOption('a', { programId: first.program.id })]
    const next = suggestPrograms(s, catalog, existing, 2)
    expect(next).toHaveLength(2)
    expect(next.map((r) => r.program.id)).not.toContain(first.program.id)
    expect(suggestPrograms(s, catalog, existing, 0)).toEqual([])
  })

  it('makes an option with the lender and program, rate left blank', () => {
    const fha = suggestPrograms(s, catalog, [], 4).find((r) => r.program.family === 'fha')!
    expect(optionFromProgram('x', fha)).toMatchObject({ id: 'x', lenderName: 'Northline Wholesale', programName: 'FHA 30-Year Fixed', mortgageType: 'fha', termMonths: 360, ratePct: null, pointsPct: 0, onQuote: true })
  })

  it('starts on the 30-year term when the program has one', () => {
    const p = conventionalCatalog.programs[0]
    expect(defaultTermMonths({ ...p, termOptions: ['fixed_15', 'fixed_30'] })).toBe(360)
    expect(defaultTermMonths({ ...p, termOptions: ['fixed_15'] })).toBe(180)
    expect(defaultTermMonths({ ...p, termOptions: [] })).toBe(360)
  })
})
