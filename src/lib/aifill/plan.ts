// AI Summary Fill (Connor, 2026-11-19), step 2: turns the reader's facts
// (supabase/functions/assistant/summaryFill.ts) into changes on the SAME 1003
// records the form edits, and works out the numbers in code:
// - job pay (rate, how often, hours) → the job's base income with the Income
//   tab's wageIncome(); self-employed pay → self-employed income
// - years on a job → an approximate start date
// - years at an address → months
// - a down payment (% or $) and the price → the loan amount
// Rules: an empty field is filled; a field with a different value is a
// conflict for Connor (Replace / Keep), never overwritten here; the same value
// is skipped. A new row (job, debt, account, other income) is added only with
// what its table requires. Facts with no place yet (homes they own, where they
// want to buy) go to the file's notes. Pure and tested.

import type { FillFact } from '../../../supabase/functions/assistant/summaryFill'
import { FILL_FIELDS } from '../../../supabase/functions/assistant/summaryFill'
import type { Address, Application, Declarations, PersonDetails } from '@/lib/api/urla'
import type { LoanDetails } from '@/lib/api/types'
import { wageIncome, type PayFrequency } from '@/lib/calc/income/wages'
import { formatCurrency } from '@/lib/format'
import { ASSET_OPTIONS, LIABILITY_OPTIONS, OTHER_INCOME_OPTIONS, labelFor } from '@/lib/urla/options'

export type RowTable = 'employments' | 'other_incomes' | 'assets' | 'liabilities' | 'contact_addresses'

/** Where one value is saved. */
export type FieldTarget =
  | { kind: 'person'; contactId: string; field: keyof PersonDetails }
  | { kind: 'address'; contactId: string; addressId: string; field: keyof Address }
  | { kind: 'row'; table: RowTable; rowId: string; contactId: string; field: string }
  | { kind: 'credit'; contactId: string }
  | { kind: 'loan'; field: keyof LoanDetails }
  | { kind: 'declaration'; contactId: string; field: keyof Declarations }

export type FillSection = FillFact['section']

export interface FieldChange {
  kind: 'field'
  key: string
  target: FieldTarget
  section: FillSection
  /** The field's name on the 1003, e.g. "Marital status". */
  label: string
  before: unknown
  after: unknown
  /** The new value in words, e.g. "$1,350". */
  display: string
  /** The value now, in words (conflicts only). */
  beforeDisplay: string
  factIds: string[]
  /** The field already has a different value: Connor picks Replace or Keep. */
  conflict: boolean
}

export interface NewRow {
  kind: 'new_row'
  key: string
  table: RowTable
  contactId: string
  /** The row as saved (camelCase, like the form's). */
  values: Record<string, unknown>
  section: FillSection
  /** What it is, e.g. "Excel Mobile · 2 yrs · $14.80/hr × 40 = $2,565.33/mo". */
  display: string
  /** How many 1003 fields it fills. */
  fieldCount: number
  factIds: string[]
  /** Something worth asking about (e.g. "Payment not given"). */
  note: string | null
  /** An hourly job with no hours a week: the rate, so the panel can ask the hours and fill the monthly income. */
  hourlyRate?: number
}

export type Change = FieldChange | NewRow

export interface FillPlan {
  changes: Change[]
  /** Facts with no 1003 place yet, or rows missing what their table needs: saved to the file's notes. */
  toNotes: { factIds: string[]; text: string }[]
  /** Hourly jobs already on the 1003 with no monthly income and no hours given: ask the hours (new jobs carry hourlyRate instead). */
  askHours: { rowId: string; contactId: string; employer: string; rate: number; factIds: string[] }[]
}

export interface FillInput {
  app: Application
  loan: Pick<LoanDetails, 'purchasePrice' | 'loanAmount' | 'mortgageType' | 'occupancy' | 'cashOutAmount' | 'incomeDocType' | 'timeline'>
  isPurchase: boolean
  /** Today, YYYY-MM-DD (for start dates). */
  today: string
}

const money = (n: number) => formatCurrency(n)
const blank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
const same = (a: unknown, b: unknown) => (typeof a === 'string' && typeof b === 'string' ? a.trim().toLowerCase() === b.trim().toLowerCase() : a === b)

/** A value in words for its field. */
export function displayValue(path: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  const f = FILL_FIELDS[path]
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (f?.type === 'money' && typeof value === 'number') return money(value)
  if (f?.type === 'percent') return `${value}%`
  if (f?.type === 'enum' && typeof value === 'string') return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  return String(value)
}

/** YYYY-MM-DD `years` before `today`, to the month (2 years before 2026-11-19 → 2024-11-01). */
export function startDateFrom(today: string, years: number): string {
  const [y, m] = today.split('-').map(Number)
  const months = Math.round(years * 12)
  const total = y * 12 + (m - 1) - months
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

/** "2 yrs" / "1 yr 6 mo" / "8 mo". */
export function tenure(years: number): string {
  const months = Math.round(years * 12)
  const y = Math.floor(months / 12)
  const m = months % 12
  return [y ? `${y} yr${y === 1 ? '' : 's'}` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ') || '0 mo'
}

const FREQ_WORD: Record<PayFrequency, string> = { hourly: '/hr', weekly: '/wk', biweekly: ' every 2 wks', semi_monthly: ' twice a month', monthly: '/mo', annual: '/yr' }

/** Monthly pay from the raw inputs, with the Income tab's math. Null when it can't be worked out. */
export function monthlyPay(rate: number | null, frequency: PayFrequency | null, hours: number | null): number | null {
  if (rate === null || !frequency) return null
  if (frequency === 'hourly' && !hours) return null
  return wageIncome({ amount: rate, frequency, hoursPerWeek: hours }).monthly
}

/**
 * The plan: one change per 1003 field (or one per new row), in the order the
 * facts came. Nothing is saved here.
 */
export function planFill(facts: FillFact[], input: FillInput): FillPlan {
  const { app, loan } = input
  const changes: Change[] = []
  const toNotes: FillPlan['toNotes'] = []
  const askHours: FillPlan['askHours'] = []
  const borrower = (contactId: string) => app.borrowers.find((b) => b.contactId === contactId)

  const field = (target: FieldTarget, path: string, label: string, before: unknown, after: unknown, factIds: string[], display?: string) => {
    if (!blank(before) && same(before, after)) return
    changes.push({
      kind: 'field',
      key: targetKey(target),
      target,
      section: FILL_FIELDS[path]?.section ?? 'borrower',
      label,
      before: blank(before) ? null : before,
      after,
      display: display ?? displayValue(path, after),
      beforeDisplay: blank(before) ? '—' : displayValue(path, before),
      factIds,
      conflict: !blank(before),
    })
  }

  // Single fields, and rows grouped by borrower + record.
  const rows = new Map<string, FillFact[]>()
  for (const f of facts) {
    const def = FILL_FIELDS[f.fieldPath]
    if (!def) continue
    if (def.row) {
      const k = `${f.contactId}|${f.record}|${def.row}`
      rows.set(k, [...(rows.get(k) ?? []), f])
      continue
    }
    const [group, name] = f.fieldPath.split('.')
    const b = borrower(f.contactId)
    if (group === 'person' && b) {
      const key = name as keyof PersonDetails
      field({ kind: 'person', contactId: f.contactId, field: key }, f.fieldPath, def.label, b.person[key], f.value, [f.id])
    } else if (group === 'credit' && b) {
      field({ kind: 'credit', contactId: f.contactId }, f.fieldPath, def.label, b.estimatedCreditScore, f.value, [f.id])
    } else if (group === 'declarations' && b) {
      const key = name as keyof Declarations
      field({ kind: 'declaration', contactId: f.contactId, field: key }, f.fieldPath, def.label, b.declarations[key], f.value, [f.id])
    } else if (group === 'loan' && (name === 'downPaymentPct' || name === 'downPaymentAmount')) {
      // Handled below with the price.
    } else if (group === 'loan') {
      const key = name as keyof FillInput['loan']
      field({ kind: 'loan', field: key }, f.fieldPath, def.label, loan[key], f.value, [f.id])
    }
  }

  // The current address: its fields, when they have one.
  const addressFacts = facts.filter((f) => f.fieldPath.startsWith('address.'))
  for (const [contactId, list] of groupBy(addressFacts, (f) => f.contactId)) {
    const b = borrower(contactId)
    const current = b?.addresses.find((a) => a.kind === 'current')
    if (!current) {
      // No current address yet: add one when the street was given (the table needs it); else keep it in the notes.
      const value = (name: string) => list.find((f) => f.fieldPath === `address.${name}`)?.value ?? null
      const street = value('addressLine')
      if (street && b) {
        const years = value('yearsAtAddress')
        const months = years !== null ? Math.round(Number(years) * 12) : value('monthsAtAddress')
        const values: Record<string, unknown> = { contactId, kind: 'current', addressLine: street }
        for (const k of ['city', 'state', 'zip', 'housing', 'monthlyRent'] as const) if (value(k) !== null) values[k] = value(k)
        if (months !== null) values.monthsAtAddress = months
        const housing = values.housing === 'rent' ? `Renting${values.monthlyRent !== undefined ? ` ${money(values.monthlyRent as number)}/mo` : ''}` : values.housing === 'own' ? 'Owns' : values.housing === 'no_primary_expense' ? 'No housing expense' : ''
        const time = months !== null ? tenure(Number(months) / 12) : ''
        const place = [street, values.city].filter(Boolean).join(', ')
        changes.push({ kind: 'new_row', key: `new:contact_addresses:${contactId}:current`, table: 'contact_addresses', contactId, values, section: 'borrower', display: ['Current address', place, housing, time].filter(Boolean).join(' · '), fieldCount: Object.keys(values).length - 2, factIds: list.map((f) => f.id), note: null })
        continue
      }
      toNotes.push({ factIds: list.map((f) => f.id), text: `Current housing (no address on the 1003 yet): ${list.map((f) => `${FILL_FIELDS[f.fieldPath].label} ${displayValue(f.fieldPath, f.value)}`).join(', ')}` })
      continue
    }
    for (const f of list) {
      const name = f.fieldPath.split('.')[1]
      if (name === 'yearsAtAddress') {
        const months = Math.round(Number(f.value) * 12)
        field({ kind: 'address', contactId, addressId: current.id, field: 'monthsAtAddress' }, 'address.monthsAtAddress', 'Months at current address', current.monthsAtAddress, months, [f.id], `${months} months`)
      } else {
        const key = name as keyof Address
        field({ kind: 'address', contactId, addressId: current.id, field: key }, f.fieldPath, FILL_FIELDS[f.fieldPath].label, current[key], f.value, [f.id])
      }
    }
  }

  // The loan amount from a down payment and the price (the price from the notes, else the file's).
  const pct = facts.find((f) => f.fieldPath === 'loan.downPaymentPct')
  const amt = facts.find((f) => f.fieldPath === 'loan.downPaymentAmount')
  const priceFact = facts.find((f) => f.fieldPath === 'loan.purchasePrice')
  const amountFact = facts.find((f) => f.fieldPath === 'loan.loanAmount')
  const down = pct ?? amt
  if (down && !amountFact) {
    const price = typeof priceFact?.value === 'number' ? priceFact.value : loan.purchasePrice
    if (price && input.isPurchase) {
      const downDollars = pct ? Math.round(((price * Number(pct.value)) / 100) * 100) / 100 : Number(amt!.value)
      const amount = Math.round((price - downDollars) * 100) / 100
      if (amount > 0) {
        const how = pct ? `${money(price)} − ${pct.value}% down` : `${money(price)} − ${money(downDollars)} down`
        field({ kind: 'loan', field: 'loanAmount' }, 'loan.loanAmount', 'Loan amount', loan.loanAmount, amount, [down.id, ...(priceFact ? [priceFact.id] : [])], `${money(amount)} (${how})`)
      }
    } else {
      toNotes.push({ factIds: [down.id], text: `Down payment: ${displayValue(down.fieldPath, down.value)} (no purchase price yet to work out the loan amount)` })
    }
  }

  // Property and homes they own: no 1003 place in this step; kept in the notes.
  const later = facts.filter((f) => f.fieldPath.startsWith('property.') || f.fieldPath.startsWith('home.'))
  if (later.length) toNotes.push({ factIds: later.map((f) => f.id), text: later.map((f) => `${FILL_FIELDS[f.fieldPath].label}: ${displayValue(f.fieldPath, f.value)}`).join('; ') })

  for (const list of rows.values()) {
    const kind = FILL_FIELDS[list[0].fieldPath].row!
    if (kind === 'home') continue
    planRow(kind, list, input, field, changes, toNotes, askHours)
  }

  return { changes, toNotes, askHours }
}

type FieldFn = (target: FieldTarget, path: string, label: string, before: unknown, after: unknown, factIds: string[], display?: string) => void

function planRow(kind: Exclude<NonNullable<(typeof FILL_FIELDS)[string]['row']>, 'home'>, list: FillFact[], input: FillInput, field: FieldFn, changes: Change[], toNotes: FillPlan['toNotes'], askHours: FillPlan['askHours']) {
  const contactId = list[0].contactId
  const record = list[0].record
  const v = (name: string) => list.find((f) => f.fieldPath.endsWith(`.${name}`))?.value ?? null
  const ids = list.map((f) => f.id)
  const table: RowTable = kind === 'job' ? 'employments' : kind === 'other_income' ? 'other_incomes' : kind === 'asset' ? 'assets' : 'liabilities'
  const section = FILL_FIELDS[list[0].fieldPath].section
  const existingId = record.startsWith('existing:') ? record.slice('existing:'.length) : null
  const b = input.app.borrowers.find((x) => x.contactId === contactId)

  // The row's values in the form's names, with the math done here.
  const values: Record<string, unknown> = {}
  let display = ''
  let note: string | null = null
  let hourlyRate: number | undefined
  if (kind === 'job') {
    const rate = v('payRate') as number | null
    const freq = v('payFrequency') as PayFrequency | null
    const hours = v('hoursPerWeek') as number | null
    const years = v('yearsOnJob') as number | null
    const selfEmployed = v('isSelfEmployed') === true
    const monthly = monthlyPay(rate, freq, hours)
    if (v('employerName') !== null) values.employerName = v('employerName')
    if (v('positionTitle') !== null) values.positionTitle = v('positionTitle')
    if (v('status') !== null) values.status = v('status')
    if (v('isSelfEmployed') !== null) values.isSelfEmployed = selfEmployed
    if (v('ownership25OrMore') !== null) values.ownership25OrMore = v('ownership25OrMore')
    const start = (v('startDate') as string | null) ?? (years !== null ? startDateFrom(input.today, years) : null)
    if (start) values.startDate = start
    if (monthly !== null) values[selfEmployed ? 'selfEmployedIncome' : 'baseIncome'] = monthly
    for (const [from, to] of [['overtimeMonthly', 'overtimeIncome'], ['bonusMonthly', 'bonusIncome'], ['commissionMonthly', 'commissionIncome'], ['selfEmployedMonthly', 'selfEmployedIncome']] as const) {
      if (v(from) !== null) values[to] = v(from)
    }
    const pay =
      rate !== null && freq
        ? `${money(rate)}${FREQ_WORD[freq]}${freq === 'hourly' && hours ? ` × ${hours}` : ''}${monthly !== null ? ` = ${money(monthly)}/mo` : ''}`
        : monthly !== null
          ? `${money(monthly)}/mo`
          : ''
    display = [values.employerName ?? 'Job', values.positionTitle, years !== null ? tenure(years) : start ? `since ${start.slice(0, 7)}` : '', pay].filter(Boolean).join(' · ')
    if (rate !== null && freq === 'hourly' && !hours) {
      note = 'Hours a week not given, so no monthly pay yet'
      hourlyRate = rate
    }
  } else if (kind === 'other_income') {
    values.incomeType = v('incomeType') ?? 'other'
    if (v('monthlyAmount') !== null) values.monthlyAmount = v('monthlyAmount')
    if (v('description') !== null) values.description = v('description')
    display = [labelFor(OTHER_INCOME_OPTIONS, values.incomeType as never), values.monthlyAmount !== undefined ? `${money(values.monthlyAmount as number)}/mo` : ''].filter(Boolean).join(' · ')
  } else if (kind === 'asset') {
    if (v('assetType') !== null) values.assetType = v('assetType')
    if (v('institutionName') !== null) values.institutionName = v('institutionName')
    if (v('amount') !== null) values.amount = v('amount')
    if (v('accountLast4') !== null) values.accountLast4 = v('accountLast4')
    display = [values.assetType ? labelFor(ASSET_OPTIONS, values.assetType as never) : 'Account', values.institutionName, values.amount !== undefined ? money(values.amount as number) : ''].filter(Boolean).join(' · ')
  } else {
    if (v('liabilityType') !== null) values.liabilityType = v('liabilityType')
    if (v('description') !== null) values.description = v('description')
    if (v('creditorName') !== null) values.creditorName = v('creditorName')
    if (v('unpaidBalance') !== null) values.unpaidBalance = v('unpaidBalance')
    if (v('monthlyPayment') !== null) values.monthlyPayment = v('monthlyPayment')
    if (v('toBePaidOff') !== null) values.toBePaidOff = v('toBePaidOff')
    const what = (values.description as string | undefined) ?? (values.liabilityType ? labelFor(LIABILITY_OPTIONS, values.liabilityType as never) : 'Debt')
    display = [what, values.creditorName, values.unpaidBalance !== undefined ? `${money(values.unpaidBalance as number)} bal` : '', values.monthlyPayment !== undefined ? `${money(values.monthlyPayment as number)}/mo` : ''].filter(Boolean).join(' · ')
  }

  // An existing row: each value is a field change (filled when blank, a conflict when different).
  if (existingId) {
    const current = rowOf(input.app, table, existingId)
    if (!current) {
      toNotes.push({ factIds: ids, text: display })
      return
    }
    for (const [name, after] of Object.entries(values)) {
      const path = pathFor(kind, name)
      field({ kind: 'row', table, rowId: existingId, contactId: current.contactId as string, field: name }, path, rowFieldLabel(kind, name), current[name], after, ids, path ? undefined : money(after as number))
    }
    // An hourly job on file with no monthly income, and no hours in the notes: ask them.
    if (hourlyRate !== undefined && current.baseIncome == null) askHours.push({ rowId: existingId, contactId: current.contactId as string, employer: String(current.employerName ?? 'this job'), rate: hourlyRate, factIds: ids })
    return
  }

  // A new row: only with what its table requires.
  const missing =
    kind === 'job' ? (values.employerName ? null : 'employer name') :
    kind === 'other_income' ? (values.monthlyAmount !== undefined ? null : 'monthly amount') :
    kind === 'asset' ? (values.amount !== undefined ? null : 'balance') :
    values.monthlyPayment !== undefined || values.unpaidBalance !== undefined ? null : 'payment or balance'
  if (missing || !b) {
    toNotes.push({ factIds: ids, text: `${display} (not added to the 1003: no ${missing ?? 'borrower'} given)` })
    return
  }
  if (kind === 'asset' && !values.assetType) values.assetType = 'other_liquid'
  if (kind === 'liability') {
    if (!values.liabilityType) values.liabilityType = 'other'
    if (values.monthlyPayment === undefined) {
      values.monthlyPayment = 0
      note = 'Payment not given'
    }
  }
  if (kind === 'job' && !values.status) values.status = 'current'
  changes.push({ kind: 'new_row', key: `new:${table}:${contactId}:${record}`, table, contactId, values: { contactId, ...values }, section, display, fieldCount: Object.keys(values).length, factIds: ids, note, ...(hourlyRate !== undefined ? { hourlyRate } : {}) })
}

const groupBy = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>()
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x])
  return m
}

function rowOf(app: Application, table: RowTable, id: string): Record<string, unknown> | null {
  const list: { id: string }[] =
    table === 'employments' ? app.borrowers.flatMap((b) => b.employments) :
    table === 'other_incomes' ? app.borrowers.flatMap((b) => b.otherIncomes) :
    table === 'contact_addresses' ? app.borrowers.flatMap((b) => b.addresses) :
    table === 'assets' ? app.assets : app.liabilities
  return (list.find((r) => r.id === id) as unknown as Record<string, unknown>) ?? null
}

/** The reader's path for a row field (form name → fact path), for showing values. */
function pathFor(kind: string, name: string): string {
  const back: Record<string, string> = { baseIncome: 'job.payRate', selfEmployedIncome: 'job.selfEmployedMonthly', overtimeIncome: 'job.overtimeMonthly', bonusIncome: 'job.bonusMonthly', commissionIncome: 'job.commissionMonthly' }
  return back[name] ?? `${kind}.${name}`
}

const ROW_LABELS: Record<string, string> = { baseIncome: 'Base income a month', selfEmployedIncome: 'Self-employed income a month', overtimeIncome: 'Overtime a month', bonusIncome: 'Bonus a month', commissionIncome: 'Commission a month' }
const rowFieldLabel = (kind: string, name: string) => ROW_LABELS[name] ?? FILL_FIELDS[`${kind}.${name}`]?.label ?? name

/** One key per saved place, so a change and its undo always point at the same field. */
export function targetKey(t: FieldTarget): string {
  switch (t.kind) {
    case 'person':
    case 'declaration':
      return `${t.kind}:${t.contactId}:${t.field}`
    case 'address':
      return `address:${t.addressId}:${t.field}`
    case 'row':
      return `row:${t.table}:${t.rowId}:${t.field}`
    case 'credit':
      return `credit:${t.contactId}`
    case 'loan':
      return `loan:${t.field}`
  }
}

/** "Filled 14 fields across 5 sections". Conflicts count only once replaced. */
export function fillSummary(applied: Change[]): { fields: number; sections: number } {
  const fields = applied.reduce((n, c) => n + (c.kind === 'new_row' ? c.fieldCount : 1), 0)
  return { fields, sections: new Set(applied.map((c) => c.section)).size }
}

