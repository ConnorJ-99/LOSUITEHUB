import { describe, expect, it } from 'vitest'
import { amortization, balanceAfter, mortgageToday, paymentsMade } from './amortization'

const loan = { loanAmount: 300_000, ratePct: 6.125, termMonths: 360, firstPaymentDate: '2024-05-01', closingDate: '2024-03-15' }

describe('amortization', () => {
  it('uses the note payment and pays the loan to zero on the last payment', () => {
    const a = amortization(loan)!
    expect(a.monthlyPayment).toBe(1822.83)
    expect(a.payoffDate).toBe('2054-04-01')
    expect(a.years.at(-1)!.endingBalance).toBe(0)
    expect(a.years.reduce((s, y) => s + y.payments, 0)).toBe(360)
    expect(Math.round(a.years.reduce((s, y) => s + y.principal, 0))).toBe(300_000)
    // Total interest is every payment less the amount borrowed (within rounding).
    expect(Math.abs(a.totalInterest - (1822.83 * 360 - 300_000))).toBeLessThan(5)
  })

  it('groups payments by calendar year: May-December in the first year', () => {
    const a = amortization(loan)!
    expect(a.years[0]).toMatchObject({ year: 2024, payments: 8 })
    expect(a.years[1]).toMatchObject({ year: 2025, payments: 12 })
    expect(a.years[0].interest).toBeGreaterThan(a.years[0].principal)
  })

  it('assumes the first payment from the closing date when it is missing', () => {
    const a = amortization({ ...loan, firstPaymentDate: null })!
    expect(a.firstPaymentDate).toBe('2024-05-01')
    expect(a.firstPaymentAssumed).toBe(true)
  })

  it('handles a 0% loan and refuses missing terms', () => {
    expect(amortization({ ...loan, ratePct: 0, loanAmount: 120_000 })!.monthlyPayment).toBe(333.33)
    expect(amortization({ ...loan, ratePct: 0, loanAmount: 120_000 })!.years.at(-1)!.endingBalance).toBe(0)
    expect(amortization({ ...loan, ratePct: null })).toBeNull()
    expect(amortization({ ...loan, firstPaymentDate: null, closingDate: null })).toBeNull()
  })
})

describe('balance today', () => {
  it('puts payments, balance and equity together', () => {
    const t = mortgageToday(loan, '2026-10-29', 340_000)!
    expect(t.paymentsMade).toBe(30)
    expect(t.balance).toBe(balanceAfter(300_000, 6.125, 360, 30))
    expect(t.equity).toBe(Math.round((340_000 - t.balance) * 100) / 100)
    expect(mortgageToday(loan, '2026-10-29', null)!.equity).toBeNull()
  })

  it('counts the payments due so far', () => {
    expect(paymentsMade('2024-05-01', 360, '2024-04-30')).toBe(0)
    expect(paymentsMade('2024-05-01', 360, '2024-05-01')).toBe(1)
    expect(paymentsMade('2024-05-01', 360, '2026-10-29')).toBe(30)
    expect(paymentsMade('2024-05-01', 360, '2070-01-01')).toBe(360)
  })

  it('matches the schedule\'s year-end balance', () => {
    const a = amortization(loan)!
    expect(balanceAfter(300_000, 6.125, 360, 8)).toBe(a.years[0].endingBalance)
    expect(balanceAfter(300_000, 6.125, 360, 20)).toBe(a.years[1].endingBalance)
    expect(balanceAfter(300_000, 6.125, 360, 360)).toBe(0)
    expect(balanceAfter(300_000, 6.125, 360, 0)).toBe(300_000)
  })
})
