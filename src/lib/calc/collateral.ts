import { round } from './round'
import type { ScenarioLien } from './scenario'

// Cross-collateralized (blanket) loans: several homes secure one loan, so the
// full value of all of them counts (Connor, 2026-11-09). The subject property
// keeps its own math (lower of price and value on a purchase, its own liens);
// these are the OTHER homes marked "Use as collateral", added on top.

export interface CollateralHome {
  estimatedValue: number | null
  annualTaxes: number | null
  annualInsurance: number | null
  monthlyHoa: number | null
  monthlyRent: number | null
  liens: ScenarioLien[]
}

export interface OtherCollateral {
  /** How many other homes secure the loan (the subject property not counted). */
  count: number
  /** Their values added together; a home with no value adds nothing and is counted in `missingValues`. */
  estimatedValue: number
  missingValues: number
  annualTaxes: number
  annualInsurance: number
  monthlyHoa: number
  monthlyRent: number
  /** Their existing mortgages that stay after closing (marked "paid off at closing" = not counted). */
  remainingLienBalance: number
}

const sum = (values: (number | null)[]) => round(values.reduce<number>((total, v) => total + (v ?? 0), 0))

/** The other collateral homes added together, or null when there are none. */
export function otherCollateral(homes: CollateralHome[]): OtherCollateral | null {
  if (homes.length === 0) return null
  return {
    count: homes.length,
    estimatedValue: sum(homes.map((h) => (h.estimatedValue && h.estimatedValue > 0 ? h.estimatedValue : 0))),
    missingValues: homes.filter((h) => !h.estimatedValue || h.estimatedValue <= 0).length,
    annualTaxes: sum(homes.map((h) => h.annualTaxes)),
    annualInsurance: sum(homes.map((h) => h.annualInsurance)),
    monthlyHoa: sum(homes.map((h) => h.monthlyHoa)),
    monthlyRent: sum(homes.map((h) => h.monthlyRent)),
    remainingLienBalance: sum(homes.flatMap((h) => h.liens.filter((l) => !l.toBePaidOff).map((l) => l.balance))),
  }
}

/** Which homes secure the loan besides the subject: only on a cross-collateralized loan, and never the subject itself. */
export function collateralHomes<T extends { id: string; isCollateral: boolean }>(crossCollateral: boolean, subjectId: string | null, homes: T[]): T[] {
  if (!crossCollateral || !subjectId) return []
  return homes.filter((h) => h.isCollateral && h.id !== subjectId)
}

export interface CollateralSummary {
  /** Every home securing the loan, the subject included. */
  count: number
  /** Their estimated or appraised values added together. */
  value: number
  /** Homes with no value entered yet. */
  missingValues: number
  /** Every existing mortgage on them, before any payoff. */
  existingMortgages: number
  monthlyRent: number
}

/** The Properties tab's combined line: the subject plus the other collateral homes. */
export function collateralSummary(subject: CollateralHome, others: CollateralHome[]): CollateralSummary {
  const all = [subject, ...others]
  const o = otherCollateral(all)!
  return {
    count: o.count,
    value: o.estimatedValue,
    missingValues: o.missingValues,
    existingMortgages: sum(all.flatMap((h) => h.liens.map((l) => l.balance))),
    monthlyRent: o.monthlyRent,
  }
}
