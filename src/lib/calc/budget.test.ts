import { describe, expect, it } from 'vitest'
import { cashNow, forecast, monthSummary, monthlyEquivalent, monthlyNet, occurrences, savingsPlan, toConfirm, type BudgetEntry, type BudgetItem } from './budget'

const item = (over: Partial<BudgetItem>): BudgetItem => ({ id: 'i', kind: 'expense', name: 'Bill', amount: 100, schedule: 'monthly', everyDays: null, nextOn: '2026-12-01', category: null, paused: false, ...over })

describe('occurrences', () => {
  it('weekly and every two weeks from the next date', () => {
    expect(occurrences(item({ schedule: 'weekly', nextOn: '2026-12-04' }), '2026-12-01', '2026-12-31')).toEqual(['2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25'])
    expect(occurrences(item({ schedule: 'biweekly', nextOn: '2026-11-27' }), '2026-12-01', '2026-12-31')).toEqual(['2026-12-11', '2026-12-25'])
  })
  it('monthly keeps the day, or the month end (Jan 31 → Feb 28)', () => {
    expect(occurrences(item({ nextOn: '2027-01-31' }), '2027-01-01', '2027-04-30')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  })
  it('twice a month: the day and 15 days off it', () => {
    expect(occurrences(item({ schedule: 'semimonthly', nextOn: '2026-12-01' }), '2026-12-01', '2027-01-31')).toEqual(['2026-12-01', '2026-12-16', '2027-01-01', '2027-01-16'])
    expect(occurrences(item({ schedule: 'semimonthly', nextOn: '2027-01-30' }), '2027-01-01', '2027-02-28')).toEqual(['2027-01-30', '2027-02-15', '2027-02-28'])
  })
  it('once a year, every N days, just once', () => {
    expect(occurrences(item({ schedule: 'annual', nextOn: '2026-03-15' }), '2026-01-01', '2028-12-31')).toEqual(['2026-03-15', '2027-03-15', '2028-03-15'])
    expect(occurrences(item({ schedule: 'every_n_days', everyDays: 10, nextOn: '2026-12-05' }), '2026-12-01', '2026-12-31')).toEqual(['2026-12-05', '2026-12-15', '2026-12-25'])
    expect(occurrences(item({ schedule: 'one_time', nextOn: '2026-12-20' }), '2026-12-01', '2026-12-31')).toEqual(['2026-12-20'])
  })
  it('none for paused or "it varies" items, or before the next date', () => {
    expect(occurrences(item({ paused: true }), '2026-12-01', '2026-12-31')).toEqual([])
    expect(occurrences(item({ schedule: 'irregular' }), '2026-12-01', '2026-12-31')).toEqual([])
    expect(occurrences(item({ nextOn: '2027-02-01' }), '2026-12-01', '2027-01-31')).toEqual([])
  })
  it('a far-back weekly date catches up without walking every week', () => {
    expect(occurrences(item({ schedule: 'weekly', nextOn: '2020-01-03' }), '2026-12-01', '2026-12-10')).toEqual(['2026-12-04'])
  })
})

describe('a month on average', () => {
  it('turns each schedule into a monthly amount', () => {
    expect(monthlyEquivalent(item({ schedule: 'weekly', amount: 300 }))).toBe(1300)
    expect(monthlyEquivalent(item({ schedule: 'biweekly', amount: 1500 }))).toBe(3250)
    expect(monthlyEquivalent(item({ schedule: 'semimonthly', amount: 1500 }))).toBe(3000)
    expect(monthlyEquivalent(item({ schedule: 'annual', amount: 1200 }))).toBe(100)
    expect(monthlyEquivalent(item({ schedule: 'every_n_days', everyDays: 30, amount: 90 }))).toBe(91.31)
    expect(monthlyEquivalent(item({ schedule: 'irregular', amount: 250 }))).toBe(250)
    expect(monthlyEquivalent(item({ schedule: 'one_time', amount: 900 }))).toBe(0)
    expect(monthlyEquivalent(item({ paused: true }))).toBe(0)
  })
  it('income less expenses', () => {
    const items = [item({ kind: 'income', schedule: 'biweekly', amount: 1500 }), item({ amount: 1200 }), item({ schedule: 'irregular', amount: 400 })]
    expect(monthlyNet(items)).toEqual({ income: 3250, expenses: 1600, net: 1650 })
  })
})

describe('forecast', () => {
  const pay = item({ id: 'pay', kind: 'income', name: 'Paycheck', amount: 1500, schedule: 'biweekly', nextOn: '2026-12-04' })
  const rent = item({ id: 'rent', name: 'Rent', amount: 1400, nextOn: '2026-12-01' })
  const food = item({ id: 'food', name: 'Groceries', amount: 600, schedule: 'irregular', nextOn: null })
  it('lists the next 30 days, income first on a day, with the balance and its low point', () => {
    const f = forecast({ items: [pay, rent, food], entries: [], startingCash: 1000, startingOn: '2026-11-30', today: '2026-12-01', days: 30 })
    expect(f.to).toBe('2026-12-30')
    expect(f.lines.map((l) => `${l.on} ${l.name} ${l.status}`)).toEqual(['2026-12-01 Rent projected', '2026-12-04 Paycheck projected', '2026-12-18 Paycheck projected', '2026-12-30 Groceries estimate'])
    expect(f.income).toBe(3000)
    expect(f.expenses).toBe(1400 + 591.38)
    expect(f.cashNow).toBe(1000)
    expect(f.endCash).toBe(round2(1000 + 3000 - 1991.38))
    expect(f.low).toEqual({ amount: -400, on: '2026-12-01' })
  })
  it('a confirmed date replaces its projection; cash now counts only what was confirmed', () => {
    const entries: BudgetEntry[] = [
      { id: 'e1', itemId: 'rent', kind: 'expense', name: 'Rent', amount: 1450, on: '2026-12-01', plannedOn: '2026-12-01' },
      { id: 'e2', itemId: null, kind: 'income', name: 'Side job', amount: 200, on: '2026-11-30', plannedOn: null },
    ]
    const f = forecast({ items: [pay, rent], entries, startingCash: 1000, startingOn: '2026-11-30', today: '2026-12-01', days: 7 })
    expect(f.lines.map((l) => l.name)).toEqual(['Paycheck'])
    expect(f.cashNow).toBe(1000 + 200 - 1450)
  })
  it('without a starting balance there is no cash line', () => {
    const f = forecast({ items: [pay], entries: [], startingCash: null, startingOn: null, today: '2026-12-01', days: 7 })
    expect([f.cashNow, f.endCash, f.low]).toEqual([null, null, null])
    expect(f.net).toBe(1500)
  })
  it('entries before the starting date are left out of cash now', () => {
    expect(cashNow(500, '2026-12-01', [{ id: 'x', itemId: null, kind: 'expense', name: 'Old', amount: 100, on: '2026-11-15', plannedOn: null }], '2026-12-05')).toBe(500)
  })
})

describe('a month', () => {
  const pay = item({ id: 'pay', kind: 'income', amount: 1500, schedule: 'biweekly', nextOn: '2026-12-04' })
  const rent = item({ id: 'rent', amount: 1400, nextOn: '2026-12-01' })
  const gas = item({ id: 'gas', amount: 200, schedule: 'irregular', nextOn: null })
  it('projected, confirmed, and the two together without counting twice', () => {
    const entries: BudgetEntry[] = [
      { id: 'a', itemId: 'rent', kind: 'expense', name: 'Rent', amount: 1450, on: '2026-12-01', plannedOn: '2026-12-01' },
      { id: 'b', itemId: 'gas', kind: 'expense', name: 'Gas', amount: 80, on: '2026-12-03', plannedOn: null },
      { id: 'c', itemId: null, kind: 'income', name: 'Gift', amount: 100, on: '2026-12-10', plannedOn: null },
    ]
    expect(monthSummary([pay, rent, gas], entries, '2026-12')).toEqual({
      month: '2026-12',
      projectedIncome: 3000,
      projectedExpenses: 1600,
      confirmedIncome: 100,
      confirmedExpenses: 1530,
      expectedIncome: 3100,
      expectedExpenses: 1530,
      expectedNet: 1570,
    })
  })
  it('lists past dates still to confirm, newest first', () => {
    const entries: BudgetEntry[] = [{ id: 'a', itemId: 'rent', kind: 'expense', name: 'Rent', amount: 1400, on: '2026-12-01', plannedOn: '2026-12-01' }]
    expect(toConfirm([pay, rent], entries, '2026-12-20').map((c) => `${c.itemId} ${c.on}`)).toEqual(['pay 2026-12-18', 'pay 2026-12-04'])
  })
})

describe('savings plan', () => {
  it('months at a monthly amount', () => {
    expect(savingsPlan(3900, 650)).toEqual({ months: 6, line: 'About 6 months at $650 a month.' })
    expect(savingsPlan(3901, 650)?.months).toBe(7)
    expect(savingsPlan(500, 650)).toEqual({ months: 1, line: 'About 1 month at $650 a month.' })
  })
  it('reached, or no way there', () => {
    expect(savingsPlan(0, 650)?.months).toBe(0)
    expect(savingsPlan(3900, 0)).toBeNull()
    expect(savingsPlan(3900, -50)).toBeNull()
  })
})

function round2(n: number) {
  return Math.round(n * 100) / 100
}
