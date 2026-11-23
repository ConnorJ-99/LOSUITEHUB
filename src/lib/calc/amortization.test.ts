import { describe, expect, it } from 'vitest'
import { amortization, balanceAfter, extraPaymentEffect, loggedExtras, mortgageToday, paymentsMade } from './amortization'

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

describe('extra payments', () => {
  it('without extras it is the plain schedule', () => {
    expect(amortization(loan, { monthly: null, oneTime: [] })).toEqual(amortization(loan))
    expect(amortization(loan)!.months).toBe(360)
  })
  it('$200 more a month from the start pays it off years sooner and saves interest', () => {
    const e = extraPaymentEffect(loan, { monthly: { amount: 200, from: '2024-05-01' } })!
    expect(e.withExtra.monthlyPayment).toBe(1822.83)
    expect(e.withExtra.years.at(-1)!.endingBalance).toBe(0)
    expect(e.monthsSaved).toBeGreaterThan(60)
    expect(e.interestSaved).toBeGreaterThan(80_000)
    expect(Math.round(e.withExtra.years.reduce((s, y) => s + y.principal, 0))).toBe(300_000)
    expect(e.withExtra.payoffDate < e.base.payoffDate).toBe(true)
  })
  it('a monthly extra starts on its date', () => {
    const later = amortization(loan, { monthly: { amount: 200, from: '2026-01-01' } })!
    expect(later.years[0].principal).toBe(amortization(loan)!.years[0].principal)
    expect(later.years.find((y) => y.year === 2026)!.principal).toBeGreaterThan(amortization(loan)!.years.find((y) => y.year === 2026)!.principal + 2_000)
  })
  it('a one-time amount lands on the next payment on or after its date', () => {
    const a = amortization(loan, { oneTime: [{ date: '2025-06-15', amount: 10_000 }] })!
    const plain = amortization(loan)!
    // The $10,000 plus a little more: the rest of 2025's payments carry less interest, so more principal.
    const more = a.years.find((y) => y.year === 2025)!.principal - plain.years.find((y) => y.year === 2025)!.principal
    expect(more).toBeGreaterThan(10_000)
    expect(more).toBeLessThan(10_500)
    expect(a.months).toBeLessThan(360)
    // A huge one-time amount pays it off then and there.
    const done = amortization(loan, { oneTime: [{ date: '2025-01-01', amount: 1_000_000 }] })!
    expect(done.payoffDate).toBe('2025-01-01')
    expect(done.years.at(-1)!.endingBalance).toBe(0)
  })
})

describe('extra payments the borrower logged', () => {
  it('count on the most recent due date on or before the day paid', () => {
    expect(loggedExtras('2024-05-01', [{ paidOn: '2025-06-15', amount: 5_000 }, { paidOn: '2025-07-01', amount: 100 }, { paidOn: '2024-04-20', amount: 50 }]).oneTime).toEqual([
      { date: '2025-06-01', amount: 5_000 },
      { date: '2025-07-01', amount: 100 },
      { date: '2024-05-01', amount: 50 },
    ])
  })
  it('lower the balance today, and without them it is the plain balance', () => {
    const plain = mortgageToday(loan, '2025-06-20', 400_000)!
    const withPaid = mortgageToday(loan, '2025-06-20', 400_000, loggedExtras(loan.firstPaymentDate, [{ paidOn: '2025-06-15', amount: 5_000 }]))!
    expect(withPaid.paymentsMade).toBe(plain.paymentsMade)
    expect(plain.balance - withPaid.balance).toBeCloseTo(5_000, -1)
    expect(withPaid.equity! - plain.equity!).toBeCloseTo(5_000, -1)
    expect(withPaid.schedule.payoffDate < plain.schedule.payoffDate).toBe(true)
    expect(mortgageToday(loan, '2025-06-20', null, { oneTime: [] })!.balance).toBe(plain.balance)
  })
})
