import { describe, expect, it } from 'vitest'
import type { FeeOverride, FeeTemplate } from '@/lib/calc'
import {
  applyChange,
  changedSincePriced,
  compareWinners,
  computeEstimate,
  estimateName,
  estimateStatus,
  factsFingerprint,
  loanChanges,
  refreshFromLoan,
  selectRows,
  selectedNote,
  type EstimateDraft,
  type LoanFacts,
} from './estimate'

// A TEST purchase: FHA, Dallas County, $385,000, 3.5% down.
const facts: LoanFacts = {
  purpose: 'purchase',
  purchasePrice: 385_000,
  closingDate: '2026-11-20',
  property: { id: 'home-1', address: '100 Test St', county: 'Dallas', state: 'TX' },
  mortgagePayoffs: 0,
  otherFinancing: 0,
  sellerCredits: 6_000,
  earnestMoney: 5_000,
  incomes: [9_000],
  otherIncome: 0,
  rentalNets: [],
  debts: [
    { id: 'car', name: 'Car TEST', monthlyPayment: 450, balance: 18_000, toBePaidOff: false },
    { id: 'card', name: 'Card TEST', monthlyPayment: 65, balance: 1_240, toBePaidOff: false },
  ],
  assets: [
    { type: 'checking', amount: 16_800 },
    { type: 'gift_cash', amount: 8_000 },
    { type: 'earnest_money', amount: 5_000 },
  ],
}

const templates: FeeTemplate[] = [
  { key: 'underwriting', section: 'A', name: 'Underwriting fee', amountType: 'fixed', amount: 1_195, purposes: null, mortgageTypes: null, paidBy: 'B', apr: true, paidTo: null, sortOrder: 1, active: true },
  { key: 'appraisal', section: 'B', name: 'Appraisal', amountType: 'fixed', amount: 650, purposes: null, mortgageTypes: null, paidBy: 'B', apr: false, paidTo: null, sortOrder: 2, active: true },
  { key: 'escrow_fee', section: 'C', name: 'Escrow / settlement fee', amountType: 'fixed', amount: 450, purposes: null, mortgageTypes: null, paidBy: 'B', apr: false, paidTo: null, sortOrder: 3, active: true },
]

const draft = (over: Partial<EstimateDraft> = {}): EstimateDraft => ({
  loanId: 'loan-1',
  propertyId: 'home-1',
  name: 'FHA 30 Fixed · Sample',
  lenderName: null,
  programName: null,
  mortgageType: 'fha',
  amortizationType: 'fixed',
  interestOnly: false,
  termMonths: 360,
  noteRate: 6.25,
  qualifyingRate: null,
  buydown: null,
  lockDays: 30,
  loanAmount: 371_525,
  purchasePrice: 385_000,
  propertyValue: 385_000,
  taxesValue: 7_056,
  taxesFactor: 'annual',
  insuranceValue: 1_800,
  insuranceFactor: 'annual',
  supplementalInsuranceMonthly: null,
  monthlyHoa: null,
  monthlyMi: null,
  otherPaymentMonthly: null,
  otherPaymentLabel: null,
  impoundWaiver: 'none',
  estimatedFundingDate: '2026-11-20',
  firstPaymentDate: null,
  pointsPct: 0,
  lenderCredit: 0,
  prepaidInterestDays: null,
  hoiPrepaidMonths: null,
  taxPrepaidMonths: null,
  hoiReserveMonths: null,
  taxReserveMonths: null,
  miReserveMonths: null,
  aggregateAdjustment: 0,
  notes: null,
  programOptionId: null,
  quoteDate: null,
  archivedAt: null,
  sellerCredits: null,
  earnestMoney: null,
  feeRules: null,
  figures: null,
  loanSnapshot: null,
  pricedAt: null,
  feesGeneratedAt: null,
  fromLoanId: null,
  dpa: null,
  ...over,
})

describe('computeEstimate', () => {
  it('finances the FHA upfront MIP into the loan but never into cash to close', () => {
    const r = computeEstimate(draft(), [], templates, facts)
    expect(r.saved.financedFee).toBe(6_501.69)
    expect(r.saved.totalLoanAmount).toBe(378_026.69)
    expect(r.saved.downPayment).toBe(13_475)
    // Cash = down payment + closing costs − earnest money − seller credit.
    expect(r.saved.cashToClose).toBe(Math.round((13_475 + r.saved.closingCosts - 5_000 - 6_000) * 100) / 100)
  })

  it('counts available funds without earnest money, and reserves in months', () => {
    const r = computeEstimate(draft(), [], templates, facts)
    expect(r.saved.availableFunds).toBe(24_800)
    expect(r.saved.fundsLeft).toBe(Math.round((24_800 - r.saved.cashToClose) * 100) / 100)
    expect(r.saved.reservesMonths).toBeCloseTo(r.saved.fundsLeft / r.saved.pitia, 1)
  })

  it('paying off a debt at closing raises cash to close and lowers DTI', () => {
    const before = computeEstimate(draft(), [], templates, facts).saved
    const payoff = { ...facts, debts: facts.debts.map((d) => (d.id === 'card' ? { ...d, toBePaidOff: true } : d)) }
    const after = computeEstimate(draft(), [], templates, payoff).saved
    expect(after.cashToClose).toBe(Math.round((before.cashToClose + 1_240) * 100) / 100)
    expect(after.dtiBack!).toBeLessThan(before.dtiBack!)
    expect(after.dtiFront).toBe(before.dtiFront)
  })

  it('a fee edit changes closing costs and cash to close, not DTI', () => {
    const before = computeEstimate(draft(), [], templates, facts).saved
    const edit: FeeOverride = { key: 'escrow_fee', section: 'C', name: 'Escrow / settlement fee', atClosing: 495, beforeClosing: null, paidBy: 'B', apr: false, paidTo: null, custom: false }
    const after = computeEstimate(draft(), [edit], templates, facts).saved
    expect(after.closingCosts).toBe(before.closingCosts + 45)
    expect(after.cashToClose).toBe(before.cashToClose + 45)
    expect(after.dtiBack).toBe(before.dtiBack)
    expect(after.pitia).toBe(before.pitia)
  })

  it('negative points are a lender credit', () => {
    const base = computeEstimate(draft(), [], templates, facts).saved
    const credit = computeEstimate(draft({ pointsPct: -0.135 }), [], templates, facts).saved
    expect(credit.lenderCredit).toBe(Math.round(378_026.69 * 0.135) / 100)
    expect(credit.cashToClose).toBeCloseTo(base.cashToClose - credit.lenderCredit, 2)
  })

  it('uses the estimate’s saved fee rules over today’s fee list', () => {
    const saved = computeEstimate(draft({ feeRules: templates }), [], [{ ...templates[0], amount: 2_000 }], facts).saved
    expect(saved.closingCosts).toBe(computeEstimate(draft(), [], templates, facts).saved.closingCosts)
  })

  it('a refinance pays off the mortgage from the new loan', () => {
    const refi: LoanFacts = { ...facts, purpose: 'refinance_rate_term', purchasePrice: null, mortgagePayoffs: 300_000 }
    const r = computeEstimate(draft({ mortgageType: 'conventional', purchasePrice: null, propertyValue: 450_000, loanAmount: 310_000 }), [], templates, refi)
    expect(r.saved.downPayment).toBe(0)
    expect(r.saved.cashToClose).toBe(Math.round((300_000 + r.saved.closingCosts - 310_000) * 100) / 100)
  })
})

describe('two estimates of the same program stay independent', () => {
  it('different rate, down payment and fees', () => {
    const a = draft()
    const b = draft({ name: 'FHA 30 Fixed · Sample · Option B', noteRate: 6.0, pointsPct: 1, loanAmount: 365_750 })
    const edit: FeeOverride = { key: 'appraisal', section: 'B', name: 'Appraisal', atClosing: 700, beforeClosing: null, paidBy: 'B', apr: false, paidTo: null, custom: false }
    const ra = computeEstimate(a, [], templates, facts).saved
    const rb = computeEstimate(b, [edit], templates, facts).saved
    expect(ra.downPayment).toBe(13_475)
    expect(rb.downPayment).toBe(19_250)
    expect(rb.ratePct).toBe(6)
    expect(rb.principalAndInterest).toBeLessThan(ra.principalAndInterest)
    // Option B's appraisal edit doesn't reach A.
    expect(computeEstimate(a, [], templates, facts).saved.closingCosts).toBe(ra.closingCosts)
  })
})

describe('loan changed since this estimate', () => {
  it('lists price, payoff and assets changes in words', () => {
    const now = { ...facts, purchasePrice: 395_000, debts: facts.debts.map((d) => (d.id === 'card' ? { ...d, toBePaidOff: true } : d)) }
    expect(loanChanges(facts, now)).toEqual(['purchase price $385,000 → $395,000', 'Card TEST added to payoffs'])
  })

  it('is quiet when nothing changed or after "Keep as is"', () => {
    expect(changedSincePriced({ facts }, facts)).toEqual([])
    const now = { ...facts, purchasePrice: 395_000 }
    expect(changedSincePriced({ facts }, now)).toHaveLength(1)
    expect(changedSincePriced({ facts, keptFingerprint: factsFingerprint(now) }, now)).toEqual([])
  })

  it('refresh follows the new price at the same down payment percent', () => {
    const now = { ...facts, purchasePrice: 395_000 }
    const c = refreshFromLoan(draft(), facts, now)
    expect(c.purchasePrice).toBe(395_000)
    expect(c.loanAmount).toBe(381_175)
    expect(c.loanSnapshot).toEqual({ facts: now })
    // An estimate priced at a different price on purpose keeps it.
    expect(refreshFromLoan(draft({ purchasePrice: 375_000 }), facts, now).purchasePrice).toBeUndefined()
  })
})

describe('change for all', () => {
  it('sets one field and leaves the other edits', () => {
    const e = draft({ noteRate: 6.0, pointsPct: 1 })
    expect(applyChange(e, { field: 'sellerCredits', value: 8_000 }, []).changes).toEqual({ sellerCredits: 8_000 })
    expect(applyChange(e, { field: 'closingDate', value: '2026-12-05' }, []).changes.estimatedFundingDate).toBe('2026-12-05')
    const kept: FeeOverride = { key: 'hoi', section: 'F', name: 'HOI', atClosing: 1_800, beforeClosing: null, paidBy: 'B', apr: false, paidTo: null, custom: false }
    const r = applyChange(e, { field: 'fee', value: 495, fee: { key: 'escrow_fee', section: 'C', name: 'Escrow / settlement fee' } }, [kept])
    expect(r.fee).toMatchObject({ key: 'escrow_fee', atClosing: 495 })
    expect(r.changes).toEqual({})
  })

  it('a new price keeps the down payment percent', () => {
    expect(applyChange(draft(), { field: 'purchasePrice', value: 395_000 }, []).changes).toMatchObject({ purchasePrice: 395_000, loanAmount: 381_175, propertyValue: 395_000 })
  })
})

describe('names, status and select', () => {
  it('auto-labels the same program added again', () => {
    expect(estimateName('FHA 30 Fixed · UWM', [])).toBe('FHA 30 Fixed · UWM')
    expect(estimateName('FHA 30 Fixed · UWM', ['FHA 30 Fixed · UWM'])).toBe('FHA 30 Fixed · UWM · Option B')
    expect(estimateName('FHA 30 Fixed · UWM', ['FHA 30 Fixed · UWM', 'FHA 30 Fixed · UWM · Option B'])).toBe('FHA 30 Fixed · UWM · Option C')
  })

  it('one Selected at a time comes from the loan', () => {
    expect(estimateStatus({ id: 'a', archivedAt: null }, 'a')).toBe('selected')
    expect(estimateStatus({ id: 'b', archivedAt: null }, 'a')).toBe('draft')
    expect(estimateStatus({ id: 'c', archivedAt: '2026-11-01' }, 'a')).toBe('archived')
  })

  it('the confirm lists what changes on the file', () => {
    const fa = computeEstimate(draft(), [], templates, facts).saved
    const fb = computeEstimate(draft({ mortgageType: 'conventional', noteRate: 6.5, loanAmount: 365_750 }), [], templates, facts).saved
    const rows = selectRows({ program: null, programName: 'FHA 30 Fixed', lenderName: 'UWM', pointsPct: -0.135, lenderCredit: 0, figures: fa }, { program: null, programName: 'Conv 30', lenderName: 'Rocket', pointsPct: 0, lenderCredit: 500, figures: fb }, true)
    expect(rows.map((r) => r.label)).toEqual(['Program', 'Lender', 'Rate / points', 'Down payment', 'Loan amount', 'Payment', 'Closing costs'])
    expect(rows[0]).toEqual({ label: 'Program', before: 'FHA 30 Fixed', after: 'Conv 30' })
    expect(rows[2].after).toBe('6.500% · $500 credit')
  })

  it('logs the selection in words', () => {
    expect(selectedNote({ name: 'FHA 3.5%', program: null, programName: 'FHA 30 Fixed', lenderName: 'UWM', noteRate: 6.25 }, '2026-11-03T15:00:00Z')).toBe('Selected FHA 30 Fixed · UWM · 6.250% on Nov 3 (Scenarios & Estimate: "FHA 3.5%").')
  })
})

describe('compare', () => {
  it('highlights the best value in each row', () => {
    const a = computeEstimate(draft(), [], templates, facts).saved
    const b = computeEstimate(draft({ noteRate: 6.0, pointsPct: 1, loanAmount: 365_750 }), [], templates, facts).saved
    const w = compareWinners([{ id: 'a', figures: a }, { id: 'b', figures: b }], 5)
    expect(w.rate).toBe('b')
    expect(w.cashToClose).toBe('a')
    expect(w.fundsLeft).toBe('a')
    expect(w.pitia).toBe('b')
  })
})

describe('down payment assistance on an estimate (Connor, 2026-11-14)', () => {
  const base = computeEstimate(draft(), [], templates, facts)
  it('a forgivable DPA lowers cash to close, adds no payment and counts in CLTV', () => {
    const r = computeEstimate(draft({ dpa: { kind: 'forgivable', amount: 10000, ratePct: null, termMonths: null, name: 'TDHCA' } }), [], templates, facts)
    expect(r.cash.cashToClose).toBe(Math.round((base.cash.cashToClose - 10000) * 100) / 100)
    expect(r.saved.pitia).toBe(base.saved.pitia)
    expect(r.dpaAmount).toBe(10000)
    expect(r.cltvPct).toBeGreaterThan(base.saved.ltvPct ?? 0)
  })
  it('a repayable DPA adds its monthly payment', () => {
    const r = computeEstimate(draft({ dpa: { kind: 'repayable', amount: 10000, ratePct: 7, termMonths: 360, name: null } }), [], templates, facts)
    expect(r.dpaMonthly).toBe(66.53)
    expect(r.saved.pitia).toBe(Math.round((base.saved.pitia + 66.53) * 100) / 100)
  })
  it('a zero amount is no DPA', () => {
    const r = computeEstimate(draft({ dpa: { kind: 'gift', amount: 0, ratePct: null, termMonths: null, name: null } }), [], templates, facts)
    expect(r.cash.cashToClose).toBe(base.cash.cashToClose)
    expect(r.saved.dpaAmount).toBeUndefined()
  })
})
