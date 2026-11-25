import { describe, expect, it } from 'vitest'
import { assetGroup, assetLines, assetTotals, fig, incomeVerification, jobLines, liabilityLines, profileFlags, qualification, reoLines, type JobIn } from './profile'

const job = (over: Partial<JobIn> = {}): JobIn => ({
  id: 'j1',
  contactId: 'c1',
  employerName: 'Acme',
  positionTitle: 'Analyst',
  status: 'current',
  startDate: '2022-01-01',
  endDate: null,
  isSelfEmployed: false,
  baseIncome: 6000,
  overtimeIncome: 500,
  bonusIncome: null,
  commissionIncome: null,
  otherEmploymentIncome: null,
  militaryEntitlements: null,
  selfEmployedIncome: null,
  ...over,
})

describe('figures', () => {
  it('missing is never zero', () => {
    expect(fig(null, 'reported')).toEqual({ value: null, source: 'missing' })
    expect(fig(0, 'reported')).toEqual({ value: 0, source: 'reported' })
  })
})

describe('qualification', () => {
  it('comes from the stage; readiness only adds a hint', () => {
    expect(qualification('lead', null)).toEqual({ status: 'not_reviewed', hint: null, qualified: false })
    expect(qualification('contacted', 'needs_documents')).toEqual({ status: 'in_progress', hint: 'additional_info', qualified: false })
    expect(qualification('contacted', 'not_ready').hint).toBe('not_qualified')
    expect(qualification('contacted', 'ready')).toEqual({ status: 'in_progress', hint: null, qualified: false })
    expect(qualification('pre_qualified', 'needs_documents')).toEqual({ status: 'pre_qualified', hint: null, qualified: true })
    expect(qualification('under_contract', null).status).toBe('pre_approved')
    expect(qualification('nurture', 'ready')).toEqual({ status: 'not_qualified', hint: null, qualified: false })
  })
})

describe('income', () => {
  it('reported until a final worksheet was pushed for the job', () => {
    const [l] = jobLines([job()], [])
    expect(l.monthly).toEqual({ value: 6500, source: 'reported' })
    expect(l.variable).toEqual({ value: 500, source: 'reported' })
    expect(l.selfEmployed).toEqual({ value: null, source: 'missing' })
    const [v] = jobLines([job()], [{ contactId: 'c1', employmentId: 'j1', status: 'final', pushedMonthly: 6500 }])
    expect(v.monthly.source).toBe('verified')
  })
  it('a job with no income is missing, not $0', () => {
    expect(jobLines([job({ baseIncome: null, overtimeIncome: null })], [])[0].monthly).toEqual({ value: null, source: 'missing' })
  })
  it('verification across current jobs', () => {
    const lines = jobLines([job(), job({ id: 'j2' })], [{ contactId: 'c1', employmentId: 'j1', status: 'final', pushedMonthly: 1 }])
    expect(incomeVerification(lines)).toBe('partly')
    expect(incomeVerification([])).toBeNull()
  })
})

describe('assets', () => {
  it('groups 1003 asset types', () => {
    expect(['checking', 'savings', 'money_market', 'stocks', 'retirement', 'gift_cash', 'earnest_money'].map(assetGroup)).toEqual(['checking', 'savings', 'savings', 'investment', 'retirement', 'gift', 'other'])
  })
  it('a statement on file verifies that borrower’s accounts (not gifts); totals and missing', () => {
    const lines = assetLines(
      [
        { id: 'a', contactId: 'c1', assetType: 'checking', institutionName: 'Chase', accountLast4: '1234', amount: 4000, useAs: 'down_payment' },
        { id: 'b', contactId: 'c1', assetType: 'savings', institutionName: null, accountLast4: null, amount: 20000, useAs: 'down_payment' },
        { id: 'c', contactId: 'c1', assetType: 'gift_cash', institutionName: null, accountLast4: null, amount: 5000, useAs: 'down_payment' },
      ],
      ['c1'],
    )
    expect(lines.map((l) => [l.name, l.amount.source])).toEqual([['Chase ··1234', 'verified'], ['Savings', 'verified'], ['Gift funds', 'reported']])
    expect(assetTotals(lines, 29000)).toEqual({ liquid: { value: 24000, source: 'verified' }, total: { value: 29000, source: 'reported' }, eligible: { value: 29000, source: 'reported' } })
    expect(assetTotals([], 0).total.source).toBe('missing')
    expect(assetTotals([], 0).eligible.source).toBe('missing')
  })
})

describe('liabilities and REO', () => {
  it('verified after a credit pull; payoffs are left out of the monthly total; none entered = missing', () => {
    const r = liabilityLines(
      [
        { id: '1', liabilityType: 'revolving', creditorName: 'Amex', unpaidBalance: 3000, monthlyPayment: 90, toBePaidOff: false },
        { id: '2', liabilityType: 'installment', creditorName: 'Toyota', unpaidBalance: 8000, monthlyPayment: 410, toBePaidOff: true },
      ],
      true,
    )
    expect(r.monthly).toEqual({ value: 90, source: 'verified' })
    expect(liabilityLines([], false).monthly.source).toBe('missing')
  })
  it('equity, housing costs; a home with no value has no equity', () => {
    const [a, b] = reoLines([
      { id: 'h', addressLine: '1 Main', city: 'Azle', status: 'current_home', occupancy: 'primary', disposition: 'retain', estimatedValue: 400000, monthlyRent: null, annualTaxes: 7200, annualInsurance: 2400, monthlyHoa: null, liens: [{ balance: 150000, monthlyPayment: 1100 }] },
      { id: 'g', addressLine: '2 Elm', city: null, status: 'owned', occupancy: 'investment', disposition: null, estimatedValue: null, monthlyRent: 1800, annualTaxes: null, annualInsurance: null, monthlyHoa: null, liens: [] },
    ])
    expect([a.equity.value, a.housing.value, a.address]).toEqual([250000, 1900, '1 Main, Azle'])
    expect(b.equity.source).toBe('missing')
    expect(b.balance.value).toBe(0)
  })
})

describe('flags', () => {
  const base = { isPurchase: true, targetPrice: 750000, maxPrice: 700000, maxMissing: null, income: 10000, jobs: [], worksheets: [], assets1003: 100000, assetsMyHome: null, score: 760, creditPulled: true, hasDebts: true, rate: 6.5 }
  it('target over max, MyHome vs 1003, and what is missing', () => {
    expect(profileFlags(base).map((f) => f.text)).toEqual(['The target price ($750,000) is above the maximum calculated price ($700,000).'])
    expect(profileFlags({ ...base, maxPrice: 800000, assetsMyHome: 70000 })[0].text).toMatch(/MyHome balances \(\$70,000\) differ/)
    const missing = profileFlags({ ...base, maxPrice: null, maxMissing: 'Enter income.', income: null, assets1003: null, score: null, creditPulled: false, hasDebts: false, rate: null, targetPrice: null }).map((f) => f.text)
    expect(missing).toEqual([
      'Income: missing. Qualifying income and DTI are pending.',
      'Assets: none on the 1003 yet.',
      'Credit score: missing.',
      'No debts entered; confirm with a credit pull.',
      'Target purchase price: missing.',
      'Maximum price not calculated: Enter income.',
      'Interest rate: not set (no Selected estimate or rate on the file).',
    ])
  })
  it('a reported score before the credit pull is noted', () => {
    expect(profileFlags({ ...base, maxPrice: 800000, creditPulled: false }).map((f) => f.text)).toContain('Credit score is borrower-reported; mortgage credit not pulled yet.')
  })
})
