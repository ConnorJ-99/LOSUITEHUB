// "Suggest from lender catalog": the quote's scenario run through the same
// rule-based Product Search engine, picking programs that fit. Rates stay
// blank (no pricing engine).

import type { MortgageType, PropertyType } from '@/lib/api/types'
import { search } from '@/lib/products/engine'
import { blankScenario as blankSearch } from '@/lib/products/scenarioForm'
import { termMonths, type MatrixPropertyType, type MatrixPurpose, type ProductFamily } from '@/lib/products/taxonomy'
import type { Catalog, CatalogProgram, ProgramResult, Scenario } from '@/lib/products/types'
import { baseLoanAmount, blankOption, scoreFor, type QuoteOption, type QuoteScenario } from './quote'

const PURPOSE: Record<QuoteScenario['purpose'], MatrixPurpose> = { purchase: 'purchase', refinance_rate_term: 'rate_term', refinance_cash_out: 'cash_out' }

const PROPERTY: Record<PropertyType, MatrixPropertyType> = {
  single_family: 'sfr_pud',
  townhouse: 'sfr_pud',
  condo: 'condo',
  two_to_four_unit: 'two_to_four',
  manufactured: 'manufactured',
  other: 'sfr_pud',
}

/** The loan type a program prices as: conventional MI for conventional and jumbo, none for Non-QM. */
export const MORTGAGE_TYPE_FOR: Record<ProductFamily, MortgageType> = { conventional: 'conventional', jumbo: 'conventional', fha: 'fha', va: 'va', usda: 'usda_rural', non_qm: 'other' }

/** The quote as a Product Search scenario: every 1st-lien full-doc product type, at the scenario's down payment. */
export function searchScenario(s: QuoteScenario, dpa: boolean): Scenario {
  const loan = baseLoanAmount(s, blankOption('scenario')) ?? 0
  const purchase = s.purpose === 'purchase'
  return {
    ...blankSearch(),
    family: 'any',
    features: dpa ? ['dpa'] : [],
    purpose: PURPOSE[s.purpose],
    occupancy: s.occupancy,
    propertyType: PROPERTY[s.propertyType],
    units: s.propertyType === 'two_to_four_unit' ? 2 : 1,
    state: s.state || 'TX',
    county: s.county?.trim() || null,
    purchasePrice: purchase ? s.purchasePrice : null,
    value: (purchase ? s.purchasePrice : s.value) ?? 0,
    loanAmount: loan,
    fico: scoreFor(s.creditBucket),
    firstTimeBuyer: s.firstTimeBuyer,
  }
}

/** What's missing before suggesting (the engine's own list, in quote words). */
export function suggestMissing(s: QuoteScenario): string[] {
  const missing: string[] = []
  if (s.creditBucket == null) missing.push('credit range')
  if (s.purpose === 'purchase') {
    if (!s.purchasePrice) missing.push('purchase price')
    if (s.downPayment == null) missing.push('down payment')
  } else {
    if (!s.value) missing.push('value')
    if (!s.loanBalance) missing.push('loan balance')
  }
  return missing
}

/** The term a suggested program starts with: 30-year fixed when it offers one, else its first term. */
export function defaultTermMonths(p: CatalogProgram): number {
  if (p.termOptions.includes('fixed_30') || p.termOptions.length === 0) return 360
  return termMonths(p.termOptions[0])
}

/**
 * Programs that fit, best first: one per product type before seconds of a
 * type, VA only when the borrower is VA eligible, down payment assistance
 * programs only when asked for, and nothing already on the quote.
 */
export function suggestPrograms(s: QuoteScenario, catalog: Catalog, existing: QuoteOption[], slots: number): ProgramResult[] {
  if (slots <= 0 || suggestMissing(s).length) return []
  const results = [...search(searchScenario(s, false), catalog).eligible, ...(s.showDpa ? search(searchScenario(s, true), catalog).eligible : [])]
  const taken = new Set(existing.map((o) => o.programId).filter(Boolean))
  const seen = new Set<string>()
  const fits = results.filter((r) => {
    if (taken.has(r.program.id) || seen.has(r.program.id)) return false
    if (r.program.family === 'va' && !s.vaEligible) return false
    seen.add(r.program.id)
    return true
  })
  const firsts: ProgramResult[] = []
  const rest: ProgramResult[] = []
  const families = new Set<ProductFamily>()
  for (const r of fits) {
    if (families.has(r.program.family)) rest.push(r)
    else {
      families.add(r.program.family)
      firsts.push(r)
    }
  }
  return [...firsts, ...rest].slice(0, slots)
}

/** A new option for a suggested program: lender and program filled in, rate and points left blank. */
export function optionFromProgram(id: string, r: Pick<ProgramResult, 'program' | 'lender'>): QuoteOption {
  return blankOption(id, {
    lenderId: r.lender.id,
    lenderName: r.lender.name,
    programId: r.program.id,
    programName: r.program.name,
    mortgageType: MORTGAGE_TYPE_FOR[r.program.family],
    termMonths: defaultTermMonths(r.program),
  })
}
