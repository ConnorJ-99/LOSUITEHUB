import { describe, expect, it } from 'vitest'
import { borrowerMonthlyIncome, employmentMonthlyIncome, monthlyDebtPayments, netMonthlyRental, qualifying, type EmploymentIncome } from './qualifying'

const job = (over: Partial<EmploymentIncome> = {}): EmploymentIncome => ({
  status: 'current',
  baseIncome: null,
  overtimeIncome: null,
  bonusIncome: null,
  commissionIncome: null,
  militaryEntitlements: null,
  otherEmploymentIncome: null,
  selfEmployedIncome: null,
  ...over,
})

describe('employment income', () => {
  it('adds every income type on a current job', () => {
    expect(employmentMonthlyIncome(job({ baseIncome: 6500, overtimeIncome: 400, bonusIncome: 250.5 }))).toBe(7150.5)
  })

  it('ignores previous jobs', () => {
    expect(employmentMonthlyIncome(job({ status: 'previous', baseIncome: 5000 }))).toBe(0)
  })

  it('subtracts a self-employment loss', () => {
    expect(borrowerMonthlyIncome([job({ baseIncome: 6500 }), job({ selfEmployedIncome: -250 })], [600])).toEqual({
      employment: 6250,
      other: 600,
      total: 6850,
    })
  })
})

describe('debts', () => {
  it('leaves out debts being paid off', () => {
    expect(monthlyDebtPayments([
      { monthlyPayment: 450, toBePaidOff: false },
      { monthlyPayment: 90, toBePaidOff: true },
      { monthlyPayment: 35, toBePaidOff: false },
    ])).toBe(485)
  })
})

describe('rental properties', () => {
  it('counts 75% of rent against the full monthly cost', () => {
    // 2,000 * 75% = 1,500 - (1,100 + 300 taxes + 100 insurance) = 0
    expect(netMonthlyRental({ monthlyRent: 2000, annualTaxes: 3600, annualInsurance: 1200, monthlyHoa: null, lienPayments: [1100] })).toBe(0)
    expect(netMonthlyRental({ monthlyRent: 1600, annualTaxes: 3600, annualInsurance: 1200, monthlyHoa: 50, lienPayments: [1100] })).toBe(-350)
  })
})

describe('qualifying', () => {
  it('combines borrowers, debts and rentals into DTI', () => {
    const r = qualifying({
      borrowerIncomes: [6850, 3150],
      housingPayment: 2500,
      debts: [{ monthlyPayment: 450, toBePaidOff: false }, { monthlyPayment: 90, toBePaidOff: true }],
      rentalNets: [-350, 200],
    })
    expect(r.totalIncome).toBe(10200)
    expect(r.otherDebts).toBe(800)
    expect(r.dti).toEqual({ front: 24.51, back: 32.353 })
  })

  it('returns null ratios with no income', () => {
    expect(qualifying({ borrowerIncomes: [], housingPayment: 2000, debts: [], rentalNets: [] }).dti).toEqual({ front: null, back: null })
  })
})
