import { describe, expect, it } from 'vitest'
import { netMonthlyRental } from '../qualifying'
import {
  bankStatementIncome,
  partnershipCashFlow,
  sCorpCashFlow,
  scheduleCCashFlow,
  scheduleEIncome,
  selfEmployedIncome,
  twoYearMonthly,
  variableIncome,
  wageIncome,
  type SCorpYear,
  type ScheduleCYear,
} from '.'

describe('wage income', () => {
  it('turns pay per period into a monthly figure', () => {
    expect(wageIncome({ frequency: 'biweekly', amount: 2500 }).monthly).toBe(5416.67)
    expect(wageIncome({ frequency: 'semi_monthly', amount: 3000 }).monthly).toBe(6000)
    expect(wageIncome({ frequency: 'weekly', amount: 1000 }).monthly).toBe(4333.33)
    expect(wageIncome({ frequency: 'annual', amount: 90000 }).monthly).toBe(7500)
  })

  it('figures hourly pay from the rate and weekly hours', () => {
    const r = wageIncome({ frequency: 'hourly', amount: 25, hoursPerWeek: 40 })
    expect(r.monthly).toBe(4333.33)
    expect(r.warnings).toEqual([])
    expect(r.lines.at(-1)).toMatchObject({ amount: 4333.33, kind: 'result' })
  })

  it('warns about hours over 40 and missing hours', () => {
    expect(wageIncome({ frequency: 'hourly', amount: 25, hoursPerWeek: 45 }).warnings[0]).toMatch(/overtime/)
    expect(wageIncome({ frequency: 'hourly', amount: 25, hoursPerWeek: null }).warnings).toContain('Enter average hours per week.')
  })
})

describe('overtime, bonus and commission', () => {
  it('averages YTD and two prior years over the months covered', () => {
    const r = variableIncome({ ytdAmount: 9000, ytdMonths: 9, priorYear1: 10000, priorYear2: 9000 })
    expect(r.trend).toBe('increasing')
    expect(r.monthly).toBe(848.48) // 28,000 ÷ 33 months
    expect(r.warnings).toEqual([])
  })

  it('uses the lower current rate when the income is declining', () => {
    const r = variableIncome({ ytdAmount: 4500, ytdMonths: 9, priorYear1: 10000, priorYear2: 10000 })
    expect(r.trend).toBe('declining')
    expect(r.monthly).toBe(500) // 6,000 a year now, not the 742.42 average
    expect(r.warnings[0]).toMatch(/Declining 40%/)
    expect(r.warnings[1]).toMatch(/20% or more/)
  })

  it('compares the two prior years when there is no YTD', () => {
    const r = variableIncome({ ytdAmount: null, ytdMonths: null, priorYear1: 12000, priorYear2: 12000 })
    expect(r.trend).toBe('stable')
    expect(r.monthly).toBe(1000)
  })

  it('flags short history', () => {
    expect(variableIncome({ ytdAmount: 3000, ytdMonths: 6, priorYear1: null, priorYear2: null }).warnings[0]).toMatch(/Less than 12 months/)
    expect(variableIncome({ ytdAmount: 3000, ytdMonths: 6, priorYear1: 6000, priorYear2: null }).warnings[0]).toMatch(/Under 24 months/)
    expect(variableIncome({ ytdAmount: null, ytdMonths: null, priorYear1: null, priorYear2: null })).toMatchObject({ monthly: 0, warnings: ['Enter YTD and prior-year amounts.'] })
  })

  it('ignores a YTD amount until its months are entered', () => {
    const r = variableIncome({ ytdAmount: 5000, ytdMonths: null, priorYear1: 12000, priorYear2: 12000 })
    expect(r.monthly).toBe(1000)
    expect(r.warnings).toContain('Enter how many months the YTD amount covers.')
  })
})

const schedC = (over: Partial<ScheduleCYear>): ScheduleCYear => ({
  netProfit: null,
  nonrecurringIncome: null,
  depletion: null,
  depreciation: null,
  nonDeductibleMeals: null,
  businessUseOfHome: null,
  amortizationCasualty: null,
  mileageDepreciation: null,
  ...over,
})

const sCorp = (over: Partial<SCorpYear>): SCorpYear => ({
  k1OrdinaryIncome: null,
  k1RentalIncome: null,
  depreciation: null,
  depletion: null,
  amortizationCasualty: null,
  notesPayableUnder1Yr: null,
  nonDeductibleTravelMeals: null,
  ownershipPct: null,
  ...over,
})

describe('self-employed cash flow', () => {
  const recentC = schedC({ netProfit: 60000, nonrecurringIncome: 2000, depreciation: 5000, nonDeductibleMeals: 1000, businessUseOfHome: 3000, mileageDepreciation: 2500 })
  const olderC = schedC({ netProfit: 55000, depreciation: 4000 })

  it('adds back Schedule C non-cash items and subtracts non-deductibles', () => {
    expect(scheduleCCashFlow(recentC).total).toBe(67500)
  })

  it('applies ownership to the business adjustments but not the K-1 income', () => {
    const year = sCorp({ k1OrdinaryIncome: 80000, depreciation: 10000, amortizationCasualty: 2000, notesPayableUnder1Yr: 4000, nonDeductibleTravelMeals: 1000, ownershipPct: 50 })
    expect(sCorpCashFlow(year).total).toBe(83500) // 80,000 + 50% of 7,000
    expect(partnershipCashFlow({ ...year, k1GuaranteedPayments: 24000 }).total).toBe(107500)
  })

  it('averages two years when income grew', () => {
    const r = selfEmployedIncome('schedule_c', olderC, recentC)
    expect(r.olderTotal).toBe(59000)
    expect(r.recentTotal).toBe(67500)
    expect(r.monthly).toBe(5270.83)
    expect(r.warnings).toEqual([])
  })

  it('uses the most recent year alone when income declined', () => {
    const r = selfEmployedIncome('schedule_c', recentC, olderC)
    expect(r.monthly).toBe(4916.67)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/declined 13%/)
  })

  it('reminds that K-1 income needs distributions or liquidity', () => {
    const r = selfEmployedIncome('s_corp', sCorp({ k1OrdinaryIncome: 50000 }), sCorp({ k1OrdinaryIncome: 50000 }))
    expect(r.monthly).toBe(4166.67)
    expect(r.warnings[0]).toMatch(/distributions/)
  })

  it('handles one year, a loss, and nothing entered', () => {
    expect(twoYearMonthly(null, 60000)).toMatchObject({ monthly: 5000 })
    expect(twoYearMonthly(null, 60000).warnings[0]).toMatch(/Only one year/)
    expect(twoYearMonthly(-12000, -6000).monthly).toBe(-750)
    expect(selfEmployedIncome('schedule_c', schedC({ netProfit: -12000 }), schedC({ netProfit: -6000 })).warnings).toContain('This is a loss: it reduces qualifying income.')
    expect(twoYearMonthly(null, null)).toMatchObject({ monthly: 0, warnings: ['Enter at least the most recent year.'] })
  })
})

describe('bank statement income', () => {
  it('applies the expense factor to eligible business deposits', () => {
    const r = bankStatementIncome({ totalDeposits: 600000, excludedDeposits: 40000, months: 24, accountType: 'business', expenseRatioPct: 50, ownershipPct: 100 })
    expect(r.monthly).toBe(11666.67)
    expect(r.warnings).toEqual([])
  })

  it('uses no expense factor on personal accounts', () => {
    const r = bankStatementIncome({ totalDeposits: 120000, excludedDeposits: 0, months: 12, accountType: 'personal', expenseRatioPct: 50, ownershipPct: null })
    expect(r.monthly).toBe(10000)
    expect(r.warnings[0]).toMatch(/No deposits excluded/)
  })

  it('applies ownership and flags a low expense factor', () => {
    expect(bankStatementIncome({ totalDeposits: 240000, excludedDeposits: 10, months: 12, accountType: 'business', expenseRatioPct: 50, ownershipPct: 50 }).monthly).toBe(4999.79)
    expect(bankStatementIncome({ totalDeposits: 240000, excludedDeposits: 10, months: 12, accountType: 'business', expenseRatioPct: 30, ownershipPct: 100 }).warnings[0]).toMatch(/CPA letter/)
  })
})

describe('rental income', () => {
  it('adds back depreciation and the costs the payment covers', () => {
    const r = scheduleEIncome({ rentsReceived: 24000, totalExpenses: 18000, depreciation: 3000, insurance: 1200, mortgageInterest: 6000, taxes: 3600, hoa: null, oneTimeExpense: null, monthsInService: 12 })
    expect(r.monthly).toBe(1650)
  })

  it('averages over the months in service', () => {
    const r = scheduleEIncome({ rentsReceived: 12000, totalExpenses: 9000, depreciation: 1500, insurance: null, mortgageInterest: null, taxes: null, hoa: null, oneTimeExpense: null, monthsInService: 6 })
    expect(r.monthly).toBe(750)
    expect(r.warnings[0]).toMatch(/6 months/)
  })

  it('nets the Schedule E figure against the property payment', () => {
    const property = { monthlyRent: 2000, annualTaxes: 3600, annualInsurance: 1200, monthlyHoa: null, lienPayments: [1100] }
    expect(netMonthlyRental(property)).toBe(0) // 75% of 2,000 − 1,500
    expect(netMonthlyRental({ ...property, rentalMethod: 'schedule_e', scheduleEMonthly: 1650 })).toBe(150)
    // No Schedule E figure saved yet: falls back to the lease.
    expect(netMonthlyRental({ ...property, rentalMethod: 'schedule_e', scheduleEMonthly: null })).toBe(0)
  })
})
