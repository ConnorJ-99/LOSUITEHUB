// Reviewing the assistant's reading of a contract: what each term would
// change on the file, what Connor decided, and the changes to save. Pure
// functions; the review screen shows what they return.

import { CONTRACT_FIELDS, type ContractFieldKey, type ExtractedField, type FieldKind } from '../../../supabase/functions/assistant/contract'
import type { LoanDetails } from '@/lib/api/types'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'

/** Where an accepted term is saved. Earnest money is the 1003's earnest money asset; the address is only compared. */
type Target = keyof LoanDetails | 'earnestMoney' | null
type Value = number | string | boolean

const TARGET: Record<ContractFieldKey, Target> = {
  sales_price: 'purchasePrice',
  effective_date: 'contractDate',
  closing_date: 'closingDate',
  earnest_money: 'earnestMoney',
  option_fee: 'optionFee',
  option_period_days: 'optionEndDate',
  financing_type: 'mortgageType',
  financing_amount: 'contractFinancingAmount',
  financing_approval_days: 'financingDeadline',
  survey_days: 'surveyDeadline',
  seller_concessions: 'sellerCredits',
  title_policy_paid_by: 'titlePolicyPaidBy',
  possession: 'possession',
  hoa_addendum: 'hasHoaAddendum',
  property_address: null,
}

const CHOICE_LABEL: Record<string, string> = {
  conventional: 'Conventional',
  fha: 'FHA',
  va: 'VA',
  usda_rural: 'USDA',
  other: 'Other',
  seller: 'Seller',
  buyer: 'Buyer',
  closing_and_funding: 'At closing and funding',
  temporary_lease: 'Temporary lease',
}

/** What the file has now, for comparing. */
export interface FileNow {
  details: LoanDetails
  earnestMoney: number | null
  /** The subject property's address, if one is chosen. */
  propertyAddress: string | null
}

/** Connor's choice for one term: use it or not, and the value if he changed it (in the term's own units). */
export interface Decision {
  use: boolean
  edited?: Value
}

export interface ReviewRow {
  key: ContractFieldKey
  label: string
  kind: FieldKind
  field: ExtractedField
  /** The value read (or as edited), in the term's own units. */
  value: Value
  edited: boolean
  /** What would be saved on the file; null when it can't be worked out (or the term is only compared). */
  proposed: Value | null
  proposedLabel: string
  currentLabel: string
  same: boolean
  /** Can this term be saved to the file? */
  applicable: boolean
  note: string | null
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const looseAddress = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** A value for showing, by kind. */
export function displayValue(kind: FieldKind | 'date', value: Value | null): string {
  if (value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (kind === 'money' && typeof value === 'number') return formatCurrency(value)
  if (kind === 'date' && typeof value === 'string') return formatIsoDate(value)
  if (kind === 'days' && typeof value === 'number') return `${value} day${value === 1 ? '' : 's'}`
  if (kind === 'choice' && typeof value === 'string') return CHOICE_LABEL[value] ?? value
  return String(value)
}

const current = (target: Target, now: FileNow): Value | null => {
  if (target === null) return now.propertyAddress
  if (target === 'earnestMoney') return now.earnestMoney
  return (now.details[target] as Value | null) ?? null
}

/**
 * One row per term read, in the contract field order. Day counts become
 * dates from the effective date being used (the one read, if Connor is
 * using it, otherwise the file's).
 */
export function buildReview(fields: ExtractedField[], now: FileNow, decisions: Partial<Record<ContractFieldKey, Decision>>): ReviewRow[] {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const valueOf = (f: ExtractedField) => decisions[f.key]?.edited ?? f.value
  const effectiveRead = byKey.get('effective_date')
  const effective = effectiveRead && decisions.effective_date?.use ? (valueOf(effectiveRead) as string) : now.details.contractDate

  return CONTRACT_FIELDS.flatMap((def): ReviewRow[] => {
    const field = byKey.get(def.key)
    if (!field) return []
    const value = valueOf(field)
    const target = TARGET[def.key]
    const now_ = current(target, now)
    let proposed: Value | null = value
    let note: string | null = null
    const shownAs = def.kind === 'days' ? 'date' : def.kind

    if (def.kind === 'days') {
      proposed = effective ? addDays(effective, value as number) : null
      note = effective ? `${displayValue('days', value)} after the effective date (${formatIsoDate(effective)})` : 'Needs the effective date to work out the deadline.'
    }
    if (target === null) {
      const same = !!now_ && looseAddress(String(now_)).startsWith(looseAddress(String(value)).split(' ').slice(0, 3).join(' '))
      return [{ key: def.key, label: def.label, kind: def.kind, field, value, edited: decisions[def.key]?.edited !== undefined, proposed: null, proposedLabel: String(value), currentLabel: now_ ? String(now_) : 'No subject property chosen', same, applicable: false, note: same ? null : 'Check the subject property on the Properties tab; this review never changes it.' }]
    }
    return [
      {
        key: def.key,
        label: def.label,
        kind: def.kind,
        field,
        value,
        edited: decisions[def.key]?.edited !== undefined,
        proposed,
        proposedLabel: displayValue(shownAs, proposed),
        currentLabel: displayValue(shownAs, now_),
        same: proposed !== null && proposed === now_,
        applicable: proposed !== null,
        note,
      },
    ]
  })
}

/**
 * Starting choices: use every term that would change the file, except
 * low-confidence ones, which Connor turns on himself after checking.
 */
export function defaultDecisions(fields: ExtractedField[], now: FileNow): Partial<Record<ContractFieldKey, Decision>> {
  const first = Object.fromEntries(fields.map((f) => [f.key, { use: f.confidence !== 'low' }])) as Partial<Record<ContractFieldKey, Decision>>
  // Rows depend on the effective date decision, so work them out with these choices.
  const rows = buildReview(fields, now, first)
  return Object.fromEntries(rows.map((r) => [r.key, { use: r.applicable && !r.same && r.field.confidence !== 'low' }]))
}

/** What to save: loan fields and earnest money, from the rows Connor is using. */
export function reviewChanges(rows: ReviewRow[], decisions: Partial<Record<ContractFieldKey, Decision>>): { details: Partial<LoanDetails>; earnestMoney?: number } {
  const details: Record<string, Value> = {}
  let earnestMoney: number | undefined
  for (const r of rows) {
    if (!decisions[r.key]?.use || !r.applicable || r.same || r.proposed === null) continue
    const target = TARGET[r.key]
    if (target === 'earnestMoney') earnestMoney = r.proposed as number
    else if (target) details[target] = r.proposed
  }
  return { details: details as Partial<LoanDetails>, ...(earnestMoney !== undefined ? { earnestMoney } : {}) }
}

/** The record kept on the reading: what was decided for each term, and the outcome for the run log. */
export function reviewRecord(rows: ReviewRow[], decisions: Partial<Record<ContractFieldKey, Decision>>) {
  const fields = rows.map((r) => {
    const d = decisions[r.key]
    const decision = !d?.use || !r.applicable ? 'skipped' : r.edited ? 'edited' : 'accepted'
    return { ...r.field, decision, final: decision === 'skipped' ? null : r.value }
  })
  return { fields, outcome: fields.some((f) => f.decision === 'edited') ? ('edited' as const) : ('approved' as const) }
}
