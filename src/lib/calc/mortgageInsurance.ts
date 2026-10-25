import { round } from './round'

export type MortgageTypeKind = 'conventional' | 'fha' | 'va' | 'usda_rural' | 'other'

export interface MiRates {
  /** Yearly mortgage insurance as a percent of the base loan. */
  annualRatePct: number
  /** Upfront fee financed into the loan, as a percent of the base loan. */
  upfrontFeePct: number
}

/**
 * Typical rates by loan type, for estimates. Conventional PMI varies with
 * credit and coverage, so 0.5% is a middle-of-the-road guess; FHA, VA and
 * USDA follow their published schedules for most borrowers. A blank loan
 * type is treated as conventional.
 */
export function defaultMiRates(type: MortgageTypeKind | null, ltvPct: number | null): MiRates {
  const ltv = ltvPct ?? 0
  switch (type) {
    case 'fha':
      return { annualRatePct: ltv > 95 ? 0.55 : 0.5, upfrontFeePct: 1.75 }
    case 'va': {
      // First-use funding fee, by down payment. Veterans with a service-connected disability are exempt (set the fee to 0).
      const down = 100 - (ltvPct ?? 100)
      return { annualRatePct: 0, upfrontFeePct: down >= 10 ? 1.25 : down >= 5 ? 1.5 : 2.15 }
    }
    case 'usda_rural':
      return { annualRatePct: 0.35, upfrontFeePct: 1 }
    case 'other':
      return { annualRatePct: 0, upfrontFeePct: 0 }
    default:
      return { annualRatePct: ltv > 80 ? 0.5 : 0, upfrontFeePct: 0 }
  }
}

export interface MortgageInsuranceInput {
  mortgageType: MortgageTypeKind | null
  baseLoanAmount: number
  /** LTV on the base loan, as a percent. */
  ltvPct: number | null
  /** Yearly rate override; null or undefined uses the default. */
  annualRatePct?: number | null
  /** Upfront fee override; null or undefined uses the default, 0 means none. */
  upfrontFeePct?: number | null
}

export interface MortgageInsurance extends MiRates {
  /** Upfront fee added to the loan. */
  financedFee: number
  /** Base loan plus the financed fee: what the payment is figured on. */
  totalLoanAmount: number
  /** Monthly mortgage insurance. */
  monthly: number
  usesDefaultRate: boolean
  usesDefaultFee: boolean
}

/** Monthly mortgage insurance and the financed upfront fee for a loan. */
export function mortgageInsurance(input: MortgageInsuranceInput): MortgageInsurance {
  const defaults = defaultMiRates(input.mortgageType, input.ltvPct)
  const usesDefaultRate = input.annualRatePct == null
  const usesDefaultFee = input.upfrontFeePct == null
  const annualRatePct = usesDefaultRate ? defaults.annualRatePct : input.annualRatePct!
  const upfrontFeePct = usesDefaultFee ? defaults.upfrontFeePct : input.upfrontFeePct!
  const base = Math.max(input.baseLoanAmount, 0)
  const financedFee = round((base * upfrontFeePct) / 100)
  return {
    annualRatePct,
    upfrontFeePct,
    financedFee,
    totalLoanAmount: round(base + financedFee),
    monthly: round((base * annualRatePct) / 100 / 12),
    usesDefaultRate,
    usesDefaultFee,
  }
}
