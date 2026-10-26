// Checks a purchase contract's terms against the rest of the file.
// Pure functions: the Contract section shows what they return.

import { concessionLimit, maxDtiFor, type ConcessionOccupancy, type MortgageTypeKind } from '@/lib/calc'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency, formatPercent } from '@/lib/format'

/** Days a file normally needs from the effective date to closing. */
export const STANDARD_TURN_DAYS = 21

export interface ContractFacts {
  mortgageType: MortgageTypeKind | null
  occupancy: ConcessionOccupancy
  purchasePrice: number | null
  loanAmount: number | null
  contractFinancingAmount: number | null
  sellerCredits: number | null
  /** The subject property's estimated or appraised value, if known. */
  propertyValue: number | null
  contractDate: string | null
  optionEndDate: string | null
  financingDeadline: string | null
  surveyDeadline: string | null
  closingDate: string | null
  /** Back-end DTI with the file's current numbers (the shared summary). */
  dti: number | null
}

export interface ContractFlag {
  key: string
  tone: 'red' | 'amber'
  title: string
  detail: string
}

const TYPE_LABEL: Record<MortgageTypeKind, string> = { conventional: 'conventional', fha: 'FHA', va: 'VA', usda_rural: 'USDA', other: 'this loan type' }

/** Whole days from one YYYY-MM-DD date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Everything on the contract that doesn't line up with the file, most serious first. */
export function contractFlags(c: ContractFacts): ContractFlag[] {
  const flags: ContractFlag[] = []

  if (c.contractFinancingAmount !== null && c.loanAmount !== null && Math.abs(c.contractFinancingAmount - c.loanAmount) >= 1) {
    flags.push({
      key: 'financing_amount',
      tone: 'amber',
      title: "Contract financing doesn't match the loan amount",
      detail: `The financing addendum says ${formatCurrency(c.contractFinancingAmount)}; the file's loan amount is ${formatCurrency(c.loanAmount)}.`,
    })
  }

  const limit = concessionLimit(c.mortgageType, c.occupancy, c.purchasePrice, c.propertyValue, c.loanAmount)
  if (limit && c.sellerCredits !== null && c.sellerCredits > limit.maxAmount) {
    flags.push({
      key: 'concessions',
      tone: limit.approximate ? 'amber' : 'red',
      title: 'Seller concessions are over the limit',
      detail: `${formatCurrency(c.sellerCredits)} is over ${TYPE_LABEL[c.mortgageType ?? 'conventional']}'s ${limit.maxPct}% limit (${formatCurrency(limit.maxAmount)}).${limit.approximate ? ' VA does not count normal closing costs toward the 4%, so check what the credit covers.' : ' The extra must be cut or the price adjusted.'}`,
    })
  }

  const maxDti = maxDtiFor(c.mortgageType)
  if (c.dti !== null && c.dti > maxDti) {
    flags.push({
      key: 'dti',
      tone: 'red',
      title: 'DTI is over the max at this contract',
      detail: `DTI is ${formatPercent(c.dti, 2)}, over the ${maxDti}% ${TYPE_LABEL[c.mortgageType ?? 'conventional']} max.`,
    })
  }

  if (c.contractDate && c.closingDate) {
    const days = daysBetween(c.contractDate, c.closingDate)
    if (days < 0) {
      flags.push({ key: 'closing_before_contract', tone: 'red', title: 'Closing date is before the effective date', detail: 'One of the two dates is wrong.' })
    } else if (days < STANDARD_TURN_DAYS) {
      flags.push({
        key: 'tight_closing',
        tone: 'amber',
        title: 'Tight closing date',
        detail: `Closing is ${plural(days, 'day')} after the effective date; a normal turn time is ${STANDARD_TURN_DAYS} days or more.`,
      })
    }
  }
  if (c.contractDate && c.optionEndDate && c.optionEndDate < c.contractDate) {
    flags.push({ key: 'option_before_contract', tone: 'red', title: 'Option period ends before the effective date', detail: 'One of the two dates is wrong.' })
  }
  for (const [key, label, date] of [
    ['financing_after_closing', 'Financing deadline', c.financingDeadline],
    ['survey_after_closing', 'Survey deadline', c.surveyDeadline],
    ['option_after_closing', 'Option period end', c.optionEndDate],
  ] as const) {
    if (date && c.closingDate && date > c.closingDate) {
      flags.push({ key, tone: 'amber', title: `${label} is after closing`, detail: `${label} is ${formatIsoDate(date)}; closing is ${formatIsoDate(c.closingDate)}.` })
    }
  }

  return flags.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'red' ? -1 : 1))
}
