import type { LoanDetails } from '@/lib/api/types'
import {
  approvalDownPct,
  approvalFunds,
  approvalMaxDti,
  approvalReserveMonths,
  approvalTypeFor,
  DEFAULT_INSURANCE_PCT,
  round,
  type ApprovalLoanType,
  type ConcessionOccupancy,
  type MaxApprovalInput,
} from '@/lib/calc'
import { SUGGESTED_TAX_RATE_PCT, type PrequalDraft, type PrequalSummary } from './draft'

// The Max Approval calculator's form: what Connor types over, with null
// meaning "use the 1003 figure" or "use the default for this loan type".
// Loan type, rate, term and the VA funding fee live on the prequal draft
// (they're loan facts, saved with Save); everything else here is a what-if
// and isn't saved, except the result through "Save as Approval Limits".

export interface ApprovalForm {
  occupancy: ConcessionOccupancy
  /** Null = from the 1003 (the prequal's income, debts, savings and gifts). */
  monthlyIncome: number | null
  monthlyDebts: number | null
  assets: number | null
  giftAmount: number | null
  nonQmAllowsGift: boolean
  /** Null = the loan type's usual minimum. */
  downPaymentPct: number | null
  /** Null = the loan type's default. */
  maxDtiPct: number | null
  maxMonthlyPayment: number | null
  taxRatePct: number | null
  insuranceRatePct: number | null
  monthlyHoa: number | null
  /** Conventional and Non-QM; null = the usual default. */
  miRatePct: number | null
  sellerConcessionPct: number | null
  nonQmConcessionCapPct: number | null
  /** Null = the default for the occupancy. */
  reserveMonths: number | null
  /** Null = from Settings → Company. */
  loanLimit: number | null
}

/** Figures from the 1003 (through the prequal draft) and Settings that the form starts from. */
export interface ApprovalFacts {
  income: number
  debts: number
  /** Own funds: savings (not gifts, not depletion accounts) plus sale proceeds. */
  assets: number
  gift: number
  /** Balances of debts paid off at closing. */
  payoffs: number
  conformingLimit: number | null
  fhaLimit: number | null
  defaultInsurancePct: number | null
}

export function approvalFacts(draft: PrequalDraft, summary: PrequalSummary, org: { conformingLoanLimit?: number | null; fhaLoanLimit?: number | null; defaultHoiPct?: number | null } | null | undefined): ApprovalFacts {
  const funds = approvalFunds(draft.assets)
  return {
    income: summary.totalIncome,
    debts: summary.otherDebts,
    assets: round(funds.own + summary.saleProceeds),
    gift: funds.gift,
    payoffs: summary.payoffs,
    conformingLimit: org?.conformingLoanLimit ?? null,
    fhaLimit: org?.fhaLoanLimit ?? null,
    defaultInsurancePct: org?.defaultHoiPct ?? null,
  }
}

/** A blank form for a file: occupancy, tax and HOA from the loan, the seller credit as a percent of a price on file. */
export function approvalFormFrom(d: Pick<LoanDetails, 'occupancy' | 'estimatedTaxRatePct' | 'estimatedMonthlyHoa' | 'sellerCredits' | 'purchasePrice'>): ApprovalForm {
  const concessionPct = d.sellerCredits && d.purchasePrice ? round((d.sellerCredits / d.purchasePrice) * 100, 2) : null
  return {
    occupancy: d.occupancy ?? 'primary',
    monthlyIncome: null,
    monthlyDebts: null,
    assets: null,
    giftAmount: null,
    nonQmAllowsGift: true,
    downPaymentPct: null,
    maxDtiPct: null,
    maxMonthlyPayment: null,
    taxRatePct: d.estimatedTaxRatePct,
    insuranceRatePct: null,
    monthlyHoa: d.estimatedMonthlyHoa,
    miRatePct: null,
    sellerConcessionPct: concessionPct,
    nonQmConcessionCapPct: null,
    reserveMonths: null,
    loanLimit: null,
  }
}

/** Defaults shown as placeholders: what a blank field means. */
export function approvalDefaults(type: ApprovalLoanType, form: ApprovalForm, facts: ApprovalFacts) {
  return {
    monthlyIncome: facts.income,
    monthlyDebts: facts.debts,
    assets: facts.assets,
    giftAmount: facts.gift,
    downPaymentPct: approvalDownPct(type, form.occupancy),
    maxDtiPct: approvalMaxDti(type),
    taxRatePct: SUGGESTED_TAX_RATE_PCT,
    insuranceRatePct: facts.defaultInsurancePct ?? DEFAULT_INSURANCE_PCT,
    nonQmConcessionCapPct: 6,
    reserveMonths: approvalReserveMonths(form.occupancy),
    // VA (full entitlement) and Non-QM have no county limit here.
    loanLimit: type === 'conventional' ? facts.conformingLimit : type === 'fha' ? facts.fhaLimit : null,
  }
}

export interface ApprovalLoanTerms {
  mortgageType: LoanDetails['mortgageType']
  noteRate: number | null
  termMonths: number | null
  /** The VA funding fee override (0 = exempt). */
  upfrontFeePct: number | null
}

/** The calculator input: the form, with every blank filled from the 1003 or the defaults. */
export function approvalInput(loan: ApprovalLoanTerms, form: ApprovalForm, facts: ApprovalFacts, costsAt?: (price: number, loanAmount: number) => number): MaxApprovalInput {
  const loanType = approvalTypeFor(loan.mortgageType)
  const def = approvalDefaults(loanType, form, facts)
  return {
    loanType,
    occupancy: form.occupancy,
    monthlyIncome: form.monthlyIncome ?? def.monthlyIncome,
    monthlyDebts: form.monthlyDebts ?? def.monthlyDebts,
    assets: form.assets ?? def.assets,
    giftAmount: form.giftAmount ?? def.giftAmount,
    nonQmAllowsGift: form.nonQmAllowsGift,
    noteRatePct: loan.noteRate,
    termMonths: loan.termMonths,
    downPaymentPct: form.downPaymentPct ?? def.downPaymentPct,
    maxDtiPct: form.maxDtiPct ?? def.maxDtiPct,
    maxMonthlyPayment: form.maxMonthlyPayment,
    taxRatePct: form.taxRatePct ?? def.taxRatePct,
    insuranceRatePct: form.insuranceRatePct ?? def.insuranceRatePct,
    monthlyHoa: form.monthlyHoa ?? 0,
    miRatePct: form.miRatePct,
    upfrontFeePct: loan.upfrontFeePct,
    sellerConcessionPct: form.sellerConcessionPct ?? 0,
    nonQmConcessionCapPct: form.nonQmConcessionCapPct ?? def.nonQmConcessionCapPct,
    reserveMonths: form.reserveMonths ?? def.reserveMonths,
    payoffs: facts.payoffs,
    loanLimit: form.loanLimit ?? def.loanLimit,
    costsAt,
  }
}
