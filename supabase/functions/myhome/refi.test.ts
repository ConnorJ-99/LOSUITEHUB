import { describe, expect, it } from 'vitest'
import { balanceAfter, monthlyPI, paymentsMade, pickBenchmark, refiSavings, type RefiBenchmarkRow, type RefiLoan } from './refi'

const row = (over: Partial<RefiBenchmarkRow>): RefiBenchmarkRow => ({ program: 'conventional', purpose: 'rate_term', fico: 740, ltv: 80, active: true, rate: 6, pricedOn: '2026-11-20', ...over })
const loan = (over: Partial<RefiLoan> = {}): RefiLoan => ({
  mortgageType: 'conventional',
  purpose: 'purchase',
  ratePct: 7.5,
  termMonths: 360,
  loanAmount: 400_000,
  firstPaymentDate: '2025-01-01',
  extraPaid: 0,
  value: 500_000,
  creditScore: 760,
  ...over,
})
const opts = { today: '2026-11-24', stale: false, minimum: 100 }

describe('loan math', () => {
  it('payment and balance', () => {
    expect(monthlyPI(400_000, 7.5, 360)).toBe(2796.86)
    expect(balanceAfter(400_000, 7.5, 360, 0)).toBe(400_000)
    expect(balanceAfter(400_000, 7.5, 360, 360)).toBe(0)
    expect(balanceAfter(400_000, 7.5, 360, 23)).toBeCloseTo(392_681.66, 1)
  })
  it('payments are counted on each due date', () => {
    expect(paymentsMade('2025-01-01', '2026-11-24')).toBe(23)
    expect(paymentsMade('2025-01-25', '2026-11-24')).toBe(22)
    expect(paymentsMade('2027-01-01', '2026-11-24')).toBe(0)
    expect(paymentsMade(null, '2026-11-24')).toBe(0)
  })
})

describe('pickBenchmark', () => {
  const rows = [row({ ltv: 80, fico: 740 }), row({ ltv: 80, fico: 680, rate: 6.5 }), row({ ltv: 95, fico: 740, rate: 6.4 }), row({ program: 'fha', purpose: 'streamline', ltv: null, fico: 640, rate: 5.9 })]
  it('the smallest LTV at or above theirs, then the highest score at or below theirs', () => {
    expect(pickBenchmark('conventional', 78.4, 760, rows)?.rate).toBe(6)
    expect(pickBenchmark('conventional', 78.4, 700, rows)?.rate).toBe(6.5)
    expect(pickBenchmark('conventional', 85, 760, rows)?.rate).toBe(6.4)
  })
  it('none above the highest LTV or below the lowest score; the lowest score when unknown', () => {
    expect(pickBenchmark('conventional', 97, 760, rows)).toBeNull()
    expect(pickBenchmark('conventional', 78, 600, rows)).toBeNull()
    expect(pickBenchmark('conventional', 78, null, rows)?.fico).toBe(680)
  })
  it('FHA uses the Streamline without an LTV; turned-off or unpriced scenarios are skipped', () => {
    expect(pickBenchmark('fha', null, 700, rows)?.rate).toBe(5.9)
    expect(pickBenchmark('conventional', 78, 760, [row({ active: false }), row({ rate: null })])).toBeNull()
  })
})

describe('refiSavings', () => {
  it('a conventional 7.5% loan against a 6% benchmark saves about $410/mo', () => {
    expect(refiSavings(loan(), [row({})], opts)).toBe(410)
  })
  it('logged extra payments lower the balance and the savings', () => {
    expect(refiSavings(loan({ extraPaid: 50_000 }), [row({})], opts)).toBe(360)
  })
  it('nothing when stale, old pricing, too small a drop or under the minimum', () => {
    expect(refiSavings(loan(), [row({})], { ...opts, stale: true })).toBeNull()
    expect(refiSavings(loan(), [row({ pricedOn: '2026-11-01' })], opts)).toBeNull()
    expect(refiSavings(loan({ ratePct: 6.2 }), [row({})], opts)).toBeNull()
    expect(refiSavings(loan(), [row({})], { ...opts, minimum: 450 })).toBeNull()
  })
  it('nothing for VA, USDA, home equity, near payoff, or no value for a conventional LTV', () => {
    expect(refiSavings(loan({ mortgageType: 'va' }), [row({})], opts)).toBeNull()
    expect(refiSavings(loan({ mortgageType: 'usda_rural' }), [row({})], opts)).toBeNull()
    expect(refiSavings(loan({ purpose: 'heloc' }), [row({})], opts)).toBeNull()
    expect(refiSavings(loan({ firstPaymentDate: '1999-01-01' }), [row({})], opts)).toBeNull()
    expect(refiSavings(loan({ value: null }), [row({})], opts)).toBeNull()
  })
  it('an FHA loan uses the Streamline even with no value', () => {
    expect(refiSavings(loan({ mortgageType: 'fha', value: null, creditScore: 680 }), [row({ program: 'fha', purpose: 'streamline', ltv: null, fico: 640 })], opts)).toBe(410)
  })
})

describe('value now and stale pricing', () => {
  it('Connor’s figure when newer, else the index estimate', async () => {
    const { valueNow } = await import('./refi')
    const ix = { base: 400_000, baseIndex: 400, latestIndex: 426.45, loadedOn: '2026-11-23' }
    expect(valueNow(null, ix)).toBe(426_000)
    expect(valueNow({ amount: 450_000, on: '2026-11-24' }, ix)).toBe(450_000)
    expect(valueNow({ amount: 450_000, on: '2026-10-01' }, ix)).toBe(426_000)
    expect(valueNow({ amount: 450_000, on: null }, null)).toBe(450_000)
    expect(valueNow(null, null)).toBeNull()
  })
  it('stale after a skipped or missed run, not while one is open', async () => {
    const { pricingStale } = await import('./refi')
    expect(pricingStale([{ status: 'saved', createdAt: '2026-11-20' }, { status: 'open', createdAt: '2026-11-23' }])).toBe(false)
    expect(pricingStale([{ status: 'saved', createdAt: '2026-11-18' }, { status: 'missed', createdAt: '2026-11-20' }])).toBe(true)
    expect(pricingStale([])).toBe(false)
  })
})
