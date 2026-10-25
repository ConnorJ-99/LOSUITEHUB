import { describe, expect, it } from 'vitest'
import {
  cltv,
  combinedLienAmounts,
  downPayment,
  dscr,
  isTexasHomeEquity,
  refinanceBenefit,
  texasHomeEquityFlags,
  type TexasCheckInput,
} from './index'

describe('downPayment', () => {
  it('computes amount and percent', () => {
    expect(downPayment(400_000, 380_000)).toEqual({ amount: 20_000, percent: 5 })
    expect(downPayment(350_000, 337_750)).toEqual({ amount: 12_250, percent: 3.5 })
  })

  it('returns a null percent with no price', () => {
    expect(downPayment(0, 0).percent).toBeNull()
  })
})

describe('dscr', () => {
  it('divides rent by PITIA to 2 decimals', () => {
    expect(dscr(2_500, 2_000)).toBe(1.25)
    expect(dscr(1_800, 2_000)).toBe(0.9)
  })

  it('returns null without a payment', () => {
    expect(dscr(2_500, 0)).toBeNull()
  })
})

describe('refinanceBenefit', () => {
  it('computes savings, rate drop and breakeven', () => {
    expect(
      refinanceBenefit({ currentPayment: 2_800, currentRatePct: 7.5, newPayment: 2_450, newRatePct: 6.25, closingCosts: 5_000 }),
    ).toEqual({ monthlySavings: 350, rateReduction: 1.25, breakevenMonths: 15 })
  })

  it('has no breakeven when the payment goes up', () => {
    expect(refinanceBenefit({ currentPayment: 2_000, currentRatePct: 6, newPayment: 2_300, newRatePct: 6.5, closingCosts: 4_000 }))
      .toEqual({ monthlySavings: -300, rateReduction: -0.5, breakevenMonths: null })
  })
})

describe('combinedLienAmounts', () => {
  const liens = [
    { position: 'first' as const, balance: 250_000 },
    { position: 'second' as const, balance: 40_000 },
  ]

  it('purchase counts only the new loan', () => {
    expect(combinedLienAmounts('purchase', 320_000, liens)).toEqual([320_000])
  })

  it('refinance replaces the 1st and keeps the 2nd', () => {
    expect(combinedLienAmounts('refinance_cash_out', 300_000, liens)).toEqual([300_000, 40_000])
  })

  it('HELOC sits behind the existing 1st', () => {
    const amounts = combinedLienAmounts('heloc', 100_000, [liens[0]])
    expect(amounts).toEqual([250_000, 100_000])
    expect(cltv(amounts, 500_000)).toBe(70)
  })

  it('DSCR follows purchase or refinance depending on price', () => {
    expect(combinedLienAmounts('investment_dscr', 200_000, liens, true)).toEqual([200_000])
    expect(combinedLienAmounts('investment_dscr', 200_000, liens, false)).toEqual([200_000, 40_000])
  })
})

describe('Texas §50(a)(6) flags', () => {
  const base: TexasCheckInput = {
    purpose: 'refinance_cash_out',
    propertyState: 'TX',
    isHomestead: true,
    cltv: 75,
    priorCashOutDates: [],
    closingDate: null,
    today: '2026-10-25',
  }

  it('only applies to cash-out or 2nd liens on a Texas homestead', () => {
    expect(isTexasHomeEquity(base)).toBe(true)
    expect(isTexasHomeEquity({ ...base, purpose: 'heloc' })).toBe(true)
    expect(isTexasHomeEquity({ ...base, purpose: 'refinance_rate_term' })).toBe(false)
    expect(isTexasHomeEquity({ ...base, isHomestead: false })).toBe(false)
    expect(isTexasHomeEquity({ ...base, propertyState: 'OK' })).toBe(false)
    expect(isTexasHomeEquity({ ...base, propertyState: ' tx ' })).toBe(true)
    expect(texasHomeEquityFlags({ ...base, propertyState: 'OK' })).toEqual([])
  })

  it('flags CLTV over 80%', () => {
    const flags = texasHomeEquityFlags({ ...base, cltv: 81.25 })
    expect(flags.find((f) => f.code === 'cltv_cap')).toEqual({
      code: 'cltv_cap',
      severity: 'error',
      message: 'Texas home equity max CLTV is 80%; this scenario is 81.25%.',
    })
  })

  it('allows exactly 80%', () => {
    expect(texasHomeEquityFlags({ ...base, cltv: 80 }).some((f) => f.code === 'cltv_cap')).toBe(false)
  })

  it('asks for data when CLTV is unknown', () => {
    expect(texasHomeEquityFlags({ ...base, cltv: null })[0].code).toBe('cltv_unknown')
  })

  it('enforces 1-year seasoning from the latest prior cash-out', () => {
    const flags = texasHomeEquityFlags({ ...base, priorCashOutDates: ['2023-01-10', '2026-03-01'], closingDate: '2026-11-15' })
    expect(flags.find((f) => f.code === 'seasoning')?.message).toBe(
      "A prior Texas cash-out loan closed 3/1/2026. A new one can't close before 3/1/2027.",
    )
    expect(
      texasHomeEquityFlags({ ...base, priorCashOutDates: ['2025-03-01'], closingDate: '2026-11-15' }).some((f) => f.code === 'seasoning'),
    ).toBe(false)
  })

  it('reminds about the 12-day notice', () => {
    const later = texasHomeEquityFlags({ ...base, closingDate: '2026-12-01' }).find((f) => f.code === 'notice')
    expect(later).toEqual({ code: 'notice', severity: 'info', message: 'Send the 12-day Texas home equity notice by 11/19/2026.' })

    const soon = texasHomeEquityFlags({ ...base, closingDate: '2026-11-01' }).find((f) => f.code === 'notice')
    expect(soon?.severity).toBe('warning')
    expect(soon?.message).toBe('Closing is 7 days away. The 12-day Texas home equity notice must have gone out by 10/20/2026.')
  })
})
