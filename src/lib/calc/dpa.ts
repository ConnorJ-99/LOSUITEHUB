// Down payment assistance and gift funds on an estimate (Connor, 2026-11-14).
// Some programs allow a DPA second lien or a gift / grant toward the down
// payment. The funds lower cash to close. A forgivable DPA is a second lien
// with no monthly payment; a repayable one has a payment worked out from its
// rate and term; a gift / grant has neither. Both DPA kinds count in CLTV.
import { monthlyPrincipalAndInterest } from './payment'
import { round } from './round'

export type DpaKind = 'gift' | 'forgivable' | 'repayable'

export const DPA_KINDS: readonly { value: DpaKind; label: string; hint: string }[] = [
  { value: 'gift', label: 'Gift / grant', hint: 'No lien, no payment' },
  { value: 'forgivable', label: 'DPA · forgivable', hint: '2nd lien, no monthly payment' },
  { value: 'repayable', label: 'DPA · repayable', hint: '2nd lien with a monthly payment' },
]

export interface Dpa {
  kind: DpaKind
  amount: number
  /** Repayable only. 0 = no interest. */
  ratePct: number | null
  /** Repayable only. */
  termMonths: number | null
  /** The program's name, e.g. "TDHCA My First Texas Home". */
  name: string | null
}

/** Usable funds: a positive amount (else none). */
export const activeDpa = (d: Dpa | null | undefined): Dpa | null => (d && Number.isFinite(d.amount) && d.amount > 0 ? d : null)

/** The DPA's monthly payment: only a repayable one with a term has one (no interest = amount ÷ term). */
export function dpaMonthly(d: Dpa | null | undefined): number {
  const a = activeDpa(d)
  if (!a || a.kind !== 'repayable' || !a.termMonths || a.termMonths <= 0) return 0
  if (!a.ratePct || a.ratePct <= 0) return round(a.amount / a.termMonths)
  return monthlyPrincipalAndInterest(a.amount, a.ratePct, a.termMonths)
}

/** The second lien it puts on the home (counts in CLTV); a gift / grant has none. */
export const dpaLien = (d: Dpa | null | undefined) => {
  const a = activeDpa(d)
  return a && a.kind !== 'gift' ? round(a.amount) : 0
}

/** CLTV with the DPA lien: (loan + DPA lien) ÷ value. */
export function cltvWithDpa(totalLoanAmount: number, d: Dpa | null | undefined, value: number | null): number | null {
  if (!value || value <= 0) return null
  return round(((totalLoanAmount + dpaLien(d)) / value) * 100, 2)
}

/** What's missing before a repayable DPA's payment can be worked out. */
export function dpaProblem(d: Dpa | null | undefined): string | null {
  const a = activeDpa(d)
  if (!a || a.kind !== 'repayable') return null
  if (!a.termMonths) return 'Add the term to work out the payment.'
  return null
}
