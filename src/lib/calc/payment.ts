import { round } from './round'

/**
 * Monthly principal and interest on a fully amortizing loan.
 * `annualRatePct` is a percent (6.5 means 6.5%).
 */
export function monthlyPrincipalAndInterest(
  principal: number,
  annualRatePct: number,
  termMonths: number,
): number {
  if (principal <= 0 || termMonths <= 0) return 0
  const r = annualRatePct / 100 / 12
  if (r === 0) return round(principal / termMonths)
  const factor = (1 + r) ** termMonths
  return round((principal * r * factor) / (factor - 1))
}

/** Monthly interest-only payment. */
export function monthlyInterestOnly(principal: number, annualRatePct: number): number {
  if (principal <= 0) return 0
  return round((principal * annualRatePct) / 100 / 12)
}

export interface PitiInput {
  principal: number
  annualRatePct: number
  termMonths: number
  annualTaxes?: number
  annualInsurance?: number
  monthlyHoa?: number
  monthlyMortgageInsurance?: number
  /** Interest-only loans pay interest only during the IO period. */
  interestOnly?: boolean
}

export interface PitiResult {
  principalAndInterest: number
  taxes: number
  insurance: number
  hoa: number
  mortgageInsurance: number
  total: number
}

/** Full monthly housing payment: principal, interest, taxes, insurance, HOA and MI. */
export function piti(input: PitiInput): PitiResult {
  const principalAndInterest = input.interestOnly
    ? monthlyInterestOnly(input.principal, input.annualRatePct)
    : monthlyPrincipalAndInterest(input.principal, input.annualRatePct, input.termMonths)
  const taxes = round((input.annualTaxes ?? 0) / 12)
  const insurance = round((input.annualInsurance ?? 0) / 12)
  const hoa = round(input.monthlyHoa ?? 0)
  const mortgageInsurance = round(input.monthlyMortgageInsurance ?? 0)
  return {
    principalAndInterest,
    taxes,
    insurance,
    hoa,
    mortgageInsurance,
    total: round(principalAndInterest + taxes + insurance + hoa + mortgageInsurance),
  }
}
