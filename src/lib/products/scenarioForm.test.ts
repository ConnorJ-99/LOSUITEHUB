import { describe, expect, it } from 'vitest'
import { application, details as baseDetails, loan as baseLoan, property } from '@/lib/mismo/testFixture'
import { blankScenario, downPayment, scenarioChips, scenarioFromFile, scenarioLabel, typeChips, withDownAmount, withDownPct, withPrice } from './scenarioForm'
import { conventionalPurchase, dscrSecond } from './testCatalog'

describe('down payment', () => {
  const s = { ...blankScenario(), purchasePrice: 400000, value: 400000, loanAmount: 380000 }
  it('is shown as $ and %', () => {
    expect(downPayment(s)).toEqual({ amount: 20000, pct: 5 })
    expect(downPayment(blankScenario())).toBeNull()
  })
  it('a new price keeps the same percent, and the value follows the price', () => {
    expect(withPrice(s, 500000)).toMatchObject({ purchasePrice: 500000, value: 500000, loanAmount: 475000 })
    expect(withPrice({ ...s, value: 410000 }, 500000).value).toBe(410000)
    expect(withPrice({ ...blankScenario() }, 300000)).toMatchObject({ purchasePrice: 300000, value: 300000, loanAmount: 285000 })
  })
  it('% and $ move the loan amount', () => {
    expect(withDownPct(s, 10).loanAmount).toBe(360000)
    expect(withDownAmount(s, 50000).loanAmount).toBe(350000)
  })
})

describe('describing a search', () => {
  it('mockup 03 chips', () => {
    expect(typeChips(conventionalPurchase)).toEqual(['1st lien', 'Conventional', 'Full doc'])
    expect(scenarioChips(conventionalPurchase)).toEqual(['Purchase', 'Primary', 'SFR/PUD', 'Collin, TX', '$400,000', '5% down', '$380,000', 'LTV 95%', '720 FICO', 'DTI 38%', 'First-time buyer'])
  })
  it('mockup 02 chips and the recent-search label', () => {
    expect(scenarioChips(dscrSecond)).toEqual(['Cash-out', 'Investment', '4 units', 'Tarrant, TX', 'Value $640,000', '1st lien $310,000', '2nd $120,000', 'CLTV 67.19%', '704 FICO', 'DSCR 1.21'])
    expect(scenarioLabel(dscrSecond)).toBe('Closed-end 2nd · Non-QM · DSCR · 4 units · 704 · CLTV 67.19%')
  })
})

describe('pre-filling from a borrower file', () => {
  const today = '2026-10-26'
  const home = property({ id: 'p1', propertyType: 'single_family', unitCount: 1, county: 'Collin', estimatedValue: 410000, isHomestead: false, liens: [] })
  const file = (purpose: typeof baseLoan.purpose, over = {}) => ({ ...baseLoan, purpose, details: { ...baseDetails, subjectPropertyId: 'p1', purchasePrice: 400000, loanAmount: 380000, mortgageType: 'conventional' as const, occupancy: 'primary' as const, incomeDocType: null, ...over } })

  it('a conventional purchase', () => {
    const s = scenarioFromFile({ loan: file('purchase'), app: application, properties: [home], creditEvents: [], today })
    expect(s).toMatchObject({ lien: 'first', family: 'conventional', docType: 'full_doc', purpose: 'purchase', propertyType: 'sfr_pud', county: 'Collin', purchasePrice: 400000, value: 410000, loanAmount: 380000, bkSeasoningMonths: null })
  })
  it('a HELOAN on a bank-statement file is a non-QM closed-end second with the 1st lien balance', () => {
    const withLien = { ...home, liens: [{ id: 'l', propertyId: 'p1', position: 'first' as const, lender: null, balance: 282000, noteRate: 3, monthlyPayment: 1500, isHeloc: false, originatedOn: null, isTexasCashOut: false, toBePaidOff: false, creditLimit: null, mortgageType: null }], isHomestead: true }
    const s = scenarioFromFile({ loan: file('heloan', { incomeDocType: 'bank_statement', purchasePrice: null, loanAmount: 75000 }), app: application, properties: [withLien], creditEvents: [], today })
    expect(s).toMatchObject({ lien: 'ces', family: 'non_qm', docType: 'bank_statement_12', purpose: 'cash_out', firstLienBalance: 282000, loanAmount: 75000, purchasePrice: null, homestead: true })
  })
  it('credit events become seasoning and mortgage lates; a missing date is "unknown"', () => {
    const ev = (eventType: 'bankruptcy_ch7' | 'late_payment' | 'foreclosure', eventDate: string | null, isMortgage = false) => ({ id: eventType + eventDate, contactId: 'c', eventType, eventDate, daysLate: 30, isMortgage, amount: null, notes: null })
    const s = scenarioFromFile({ loan: file('purchase'), app: application, properties: [home], creditEvents: [ev('bankruptcy_ch7', '2022-04-15'), ev('late_payment', '2026-01-10', true), ev('late_payment', '2025-03-01', true), ev('foreclosure', null)], today })
    expect(s).toMatchObject({ bkSeasoningMonths: 54, mortgageLates12: 1, mortgageLates24: 2, fcSeasoningMonths: 'unknown' })
  })
})
