import { describe, expect, it } from 'vitest'
import { borrowerSummaryView, compactMoney, parsePrices, summaryDefaults, type SummaryFacts } from './borrowerSummary'

const missing = { value: null, source: 'missing' as const }
const base: SummaryFacts = {
  borrowerNames: ['Connor Watson'],
  isPurchase: true,
  purposeLabel: 'Purchase',
  stageLabel: 'Lead',
  qualificationLabel: 'Not reviewed',
  loName: 'Connor Jacquart',
  targetPrice: 750000,
  maxPrice: null,
  downPaymentPct: 20,
  loanAmount: 600000,
  programLabel: 'Conventional',
  scores: [{ name: 'Connor', score: 760 }],
  creditPulled: false,
  jobs: [],
  otherIncome: [],
  income: missing,
  incomeVerified: null,
  dti: null,
  assetGroups: [{ label: 'Savings', total: 100000, verified: false }],
  liquid: { value: 100000, source: 'reported' },
  debts: [],
  monthlyDebts: missing,
  homes: [],
}

describe('borrower summary', () => {
  it('compact money like the sample', () => {
    expect(compactMoney(650000)).toBe('$650k')
    expect(compactMoney(1250000)).toBe('$1.25M')
    expect(compactMoney(12500)).toBe('$12.5k')
    expect(compactMoney(950)).toBe('$950')
  })
  it('reads typed prices', () => {
    expect(parsePrices('650000, 750,000, $850k')).toEqual([650000, 750000, 850000])
    expect(parsePrices('1.2m; abc')).toEqual([1200000])
    expect(parsePrices('')).toEqual([])
  })
  it('writes defaults from the file and never shows missing as $0', () => {
    const t = summaryDefaults(base)
    expect(t.income).toBe('Not collected; qualifying income and DTI pending.')
    expect(t.credit).toBe('760 reported. Mortgage credit not pulled yet.')
    expect(t.assets).toContain('Savings $100,000')
    expect(t.liabilities).toContain('No debts entered')
    expect(t.homes).toBe('None on file.')
    expect(t.prices).toBe('750,000')
    expect(t.downPct).toBe('20')
    expect(t.nextSteps.split('\n')).toHaveLength(4)
    const v = borrowerSummaryView(base, t, '2026-11-24')
    expect(v.tiles.map((x) => x.value)).toEqual(['$750k', '760', '$100k', 'None entered'])
    expect(v.preparedOn).toBe('11/24/2026')
  })
  it('uses the saved assessment words and jobs', () => {
    const t = summaryDefaults(
      { ...base, jobs: [{ name: 'Connor', employer: 'Acme', type: 'W-2', current: true, startDate: '2020-01-15', monthly: { value: 9000, source: 'reported' } }], income: { value: 9000, source: 'reported' }, incomeVerified: 'unverified', dti: { front: 30, back: 35 } },
      { strategy: 'Buy before selling.', strengths: 'Strong credit.', concerns: 'Carry both homes.', nextSteps: '1. Apply\n2. Verify' },
    )
    expect(t.income).toBe('Acme, W-2 since Jan 2020: $9,000/mo. Total $9,000/mo, borrower-reported, not verified yet. DTI 30.0% / 35.0% (estimated).')
    const v = borrowerSummaryView(base, t, '2026-11-24')
    expect(v.sections.map((s) => s.title)).toEqual(['01 | Purchase strategy', '02 | Financial profile', '03 | Illustrative financing scenarios', '04 | Loan officer assessment', '05 | Next steps'])
    const steps = v.sections[4]
    expect(steps.kind === 'text' && steps.text).toBe('1. Apply 2. Verify')
  })
  it('scenario rows at the typed down payment; empty sections are left out', () => {
    const t = { ...summaryDefaults(base), prices: '650000, 850000', strengths: '', review: '', strategy: '' }
    const v = borrowerSummaryView(base, t, '2026-11-24')
    expect(v.tiles[0].value).toBe('$650k–$850k')
    const table = v.sections.find((s) => s.kind === 'table')
    expect(table?.kind === 'table' && table.rows).toEqual([
      ['$650,000', '$130,000', '$520,000'],
      ['$850,000', '$170,000', '$680,000'],
    ])
    expect(v.sections.some((s) => s.kind === 'assessment')).toBe(false)
    expect(v.sections[0].title).toBe('01 | Financial profile')
  })
  it('refinance: loan amount tile, no scenarios', () => {
    const refi = { ...base, isPurchase: false, purposeLabel: 'Refinance' }
    const v = borrowerSummaryView(refi, summaryDefaults(refi), '2026-11-24')
    expect(v.tiles[0]).toEqual({ label: 'Loan amount', value: '$600k' })
    expect(v.sections.some((s) => s.kind === 'table')).toBe(false)
  })
})
