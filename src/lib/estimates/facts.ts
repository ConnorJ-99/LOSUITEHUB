// The loan facts an estimate is priced from, read from the file (loan, 1003
// and homes). Pure: the screens pass in what they loaded.

import { assetDepletionIncome, borrowerMonthlyIncome, round } from '@/lib/calc'
import type { LoanProfile, Property } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { otherCollateralFor, otherFinancingFor, payoffsFor } from '@/lib/pricing/scenario'
import { ownedProperties, propertyNetRental } from '@/lib/urla/realEstate'
import type { LoanFacts } from './estimate'

/** The facts for an estimate on one home (or the subject property, or none). */
export function loanFactsFor(loan: Pick<LoanProfile, 'purpose' | 'details'>, app: Pick<Application, 'borrowers' | 'assets' | 'liabilities'>, properties: Property[], propertyId: string | null): LoanFacts {
  const d = loan.details
  const home = properties.find((p) => p.id === (propertyId ?? d.subjectPropertyId)) ?? null
  // Cross-collateral: an estimate on the subject also pays off the other collateral homes' mortgages.
  const other = home && home.id === d.subjectPropertyId ? otherCollateralFor(d, properties) : null
  const rentalNets = ownedProperties(properties)
    .filter((p) => p.id !== d.subjectPropertyId && p.id !== home?.id && p.reoDisposition === 'retain')
    .map(propertyNetRental)
  return {
    purpose: loan.purpose,
    purchasePrice: d.purchasePrice,
    closingDate: d.closingDate,
    property: home ? { id: home.id, address: home.addressLine, county: home.county, state: home.state } : null,
    mortgagePayoffs: round(payoffsFor(loan.purpose, home) + (other?.payoffBalance ?? 0)),
    otherFinancing: round(otherFinancingFor(loan.purpose, home) + (other?.remainingMonthlyPayment ?? 0)),
    sellerCredits: d.sellerCredits ?? 0,
    earnestMoney: round(app.assets.filter((a) => a.assetType === 'earnest_money').reduce((s, a) => s + a.amount, 0)),
    incomes: app.borrowers.map((b) => borrowerMonthlyIncome(b.employments, b.otherIncomes.map((i) => i.monthlyAmount)).total),
    otherIncome: assetDepletionIncome(app.assets),
    rentalNets,
    debts: app.liabilities.map((l) => ({
      id: l.id,
      name: l.creditorName ?? 'Debt',
      monthlyPayment: l.monthlyPayment,
      balance: l.unpaidBalance ?? 0,
      toBePaidOff: l.toBePaidOff,
    })),
    assets: app.assets.map((a) => ({ type: a.assetType, amount: a.amount })),
    occupancy: d.occupancy,
    upfrontFeePct: d.upfrontFeePct,
    miRatePct: d.miRatePct,
  }
}
