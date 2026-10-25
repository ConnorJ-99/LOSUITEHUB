import { combinedLienAmounts, downPayment, dscr, refinanceBenefit, type DownPayment, type LoanPurposeKind, type RefinanceBenefit } from './loan'
import { monthlyInterestOnly, monthlyPrincipalAndInterest, piti, type PitiResult } from './payment'
import { cltv, ltv, qualifyingValue } from './ratios'
import { round } from './round'

export interface ScenarioProperty {
  estimatedValue: number | null
  annualTaxes: number | null
  annualInsurance: number | null
  monthlyHoa: number | null
  monthlyRent: number | null
}

export interface ScenarioLien {
  position: 'first' | 'second'
  balance: number | null
  monthlyPayment: number | null
  noteRate: number | null
  toBePaidOff?: boolean
}

export interface ScenarioInput {
  purpose: LoanPurposeKind
  purchasePrice: number | null
  loanAmount: number | null
  noteRatePct: number | null
  termMonths: number | null
  /** The subject property, if one has been chosen. */
  property: ScenarioProperty | null
  /** Existing liens on the subject property. */
  liens: ScenarioLien[]
}

export interface ScenarioResult {
  /** Value used for LTV: lower of price and value on a purchase, else the home's value. */
  value: number | null
  ltv: number | null
  cltv: number | null
  firstLienBalance: number | null
  downPayment: DownPayment | null
  /**
   * New monthly payment. Purchases and refinances include taxes, insurance and
   * HOA; HELOC (interest-only) and HELOAN show only the new 2nd lien payment.
   */
  payment: PitiResult | null
  dscr: number | null
  refinance: RefinanceBenefit | null
}

const isRefinance = (p: LoanPurposeKind) => p === 'refinance_rate_term' || p === 'refinance_cash_out'
const isSecondLien = (p: LoanPurposeKind) => p === 'heloc' || p === 'heloan'

/** Every key number on the borrower Overview, from the loan's facts plus its subject property. */
export function computeScenario(input: ScenarioInput): ScenarioResult {
  const { purpose, purchasePrice, loanAmount, noteRatePct, termMonths, property, liens } = input
  const homeValue = property?.estimatedValue ?? null
  const hasPrice = purchasePrice !== null && purchasePrice > 0
  const usesPrice = purpose === 'purchase' || (purpose === 'investment_dscr' && hasPrice)

  let value: number | null
  if (usesPrice) value = hasPrice ? qualifyingValue(homeValue ?? 0, purchasePrice) : homeValue
  else value = homeValue
  if (value !== null && value <= 0) value = null

  const knownLiens = liens.filter((l) => l.balance !== null).map((l) => ({ position: l.position, balance: l.balance as number, toBePaidOff: l.toBePaidOff }))
  const firstLien = liens.find((l) => l.position === 'first') ?? null
  const firstLienBalance = firstLien?.balance ?? null

  const amount = loanAmount ?? 0
  const loanLtv = loanAmount !== null && value !== null ? ltv(amount, value) : null
  const loanCltv =
    loanAmount !== null && value !== null ? cltv(combinedLienAmounts(purpose, amount, knownLiens, hasPrice), value) : null

  let payment: PitiResult | null = null
  if (loanAmount && noteRatePct !== null && (termMonths || purpose === 'heloc')) {
    if (isSecondLien(purpose)) {
      const pi = purpose === 'heloc' ? monthlyInterestOnly(amount, noteRatePct) : monthlyPrincipalAndInterest(amount, noteRatePct, termMonths!)
      payment = { principalAndInterest: pi, taxes: 0, insurance: 0, hoa: 0, mortgageInsurance: 0, total: pi }
    } else {
      payment = piti({
        principal: amount,
        annualRatePct: noteRatePct,
        termMonths: termMonths!,
        annualTaxes: property?.annualTaxes ?? 0,
        annualInsurance: property?.annualInsurance ?? 0,
        monthlyHoa: property?.monthlyHoa ?? 0,
      })
    }
  }

  const refinance =
    isRefinance(purpose) && payment && firstLien?.monthlyPayment != null && firstLien.noteRate != null
      ? refinanceBenefit({
          currentPayment: firstLien.monthlyPayment,
          currentRatePct: firstLien.noteRate,
          newPayment: payment.principalAndInterest,
          newRatePct: noteRatePct!,
        })
      : null

  return {
    value,
    ltv: loanLtv,
    cltv: loanCltv,
    firstLienBalance,
    downPayment: usesPrice && hasPrice && loanAmount !== null ? downPayment(purchasePrice, amount) : null,
    payment,
    dscr: purpose === 'investment_dscr' && payment && property?.monthlyRent ? dscr(property.monthlyRent, payment.total) : null,
    refinance,
  }
}

/**
 * Full monthly housing payment after closing, for DTI. Purchases and
 * refinances use the new PITI. HELOC/HELOAN keep the existing 1st lien, so
 * the housing payment is that payment plus the new 2nd plus taxes, insurance and HOA.
 */
export function proposedHousingPayment(input: ScenarioInput, result: ScenarioResult): number | null {
  if (!result.payment) return null
  if (input.purpose !== 'heloc' && input.purpose !== 'heloan') return result.payment.total
  const firstLienPayment = input.liens.find((l) => l.position === 'first' && !l.toBePaidOff)?.monthlyPayment ?? 0
  const p = input.property
  return round(
    result.payment.total + firstLienPayment + (p?.annualTaxes ?? 0) / 12 + (p?.annualInsurance ?? 0) / 12 + (p?.monthlyHoa ?? 0),
  )
}
