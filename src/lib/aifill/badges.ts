// AI badges on the 1003 (Connor, 2026-11-19): a field AI Fill filled shows a
// small "AI" tag until someone edits it (its value no longer matches what AI
// Fill saved) or confirms it (a click on the tag, kept in the run's
// `confirmed`). Rows AI Fill added keep their tag until confirmed. Undone
// runs show nothing. Pure and tested.

import type { AppliedChange } from '@/lib/api/aifill'
import type { Application } from '@/lib/api/urla'
import type { LoanDetails } from '@/lib/api/types'
import type { FieldFix, UrlaIssue } from '@/lib/loanfile/urla'
import type { FieldTarget, RowTable } from './plan'

export interface FillRun {
  id: string
  applied: AppliedChange[]
  confirmed: string[]
  undone: boolean
}

/** The tag key for a row AI Fill added. */
export const newRowKey = (table: RowTable, rowId: string) => `newrow:${table}:${rowId}`

/** Every key that belongs to one row (its fields, or the whole row when AI Fill added it). */
export const rowPrefixes = (table: RowTable, rowId: string) =>
  table === 'contact_addresses' ? [`address:${rowId}:`, newRowKey(table, rowId)] : [`row:${table}:${rowId}:`, newRowKey(table, rowId)]

function rowsOf(app: Application, table: RowTable): Record<string, unknown>[] {
  const list =
    table === 'employments' ? app.borrowers.flatMap((b) => b.employments) :
    table === 'other_incomes' ? app.borrowers.flatMap((b) => b.otherIncomes) :
    table === 'contact_addresses' ? app.borrowers.flatMap((b) => b.addresses) :
    table === 'assets' ? app.assets : app.liabilities
  return list as unknown as Record<string, unknown>[]
}

/** What the 1003 has now in the place a change was saved. `undefined` = the place is gone. */
export function currentValue(t: FieldTarget, app: Application, loan: Partial<LoanDetails>): unknown {
  const b = 'contactId' in t ? app.borrowers.find((x) => x.contactId === t.contactId) : undefined
  switch (t.kind) {
    case 'person':
      return b ? b.person[t.field] : undefined
    case 'address':
      return b?.addresses.find((a) => a.id === t.addressId)?.[t.field]
    case 'row':
      return rowsOf(app, t.table).find((r) => r.id === t.rowId)?.[t.field]
    case 'credit':
      return b ? b.estimatedCreditScore : undefined
    case 'loan':
      return loan[t.field]
    case 'declaration':
      return b ? b.declarations[t.field] : undefined
  }
}

const same = (a: unknown, b: unknown) => (typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : a === b)

/** The keys that still show an AI tag, newest run winning for a field filled twice. */
export function activeAiKeys(runs: FillRun[], app: Application, loan: Partial<LoanDetails>): Set<string> {
  const keys = new Set<string>()
  for (const run of runs) {
    if (run.undone) continue
    const confirmed = new Set(run.confirmed)
    for (const a of run.applied) {
      if (a.kind === 'new_row') {
        const key = newRowKey(a.table, a.rowId)
        if (!confirmed.has(key) && rowsOf(app, a.table).some((r) => r.id === a.rowId)) keys.add(key)
        continue
      }
      if (confirmed.has(a.key)) {
        keys.delete(a.key)
        continue
      }
      const now = currentValue(a.target, app, loan)
      if (now !== undefined && same(now, a.after)) keys.add(a.key)
      else keys.delete(a.key)
    }
  }
  return keys
}

/** The tag key a missing-field fix points at (the same keys the form's fields use), or null when it has none. */
export function issueKey(fix: FieldFix | undefined): string | null {
  if (!fix) return null
  switch (fix.kind) {
    case 'person':
      return `person:${fix.contactId}:${fix.field}`
    case 'loan':
      return `loan:${fix.field}`
    case 'score':
      return `credit:${fix.contactId}`
    case 'job':
      return `row:employments:${fix.employmentId}:${fix.field}`
    case 'declaration':
      return `declaration:${fix.contactId}:${fix.field}`
    default:
      return null
  }
}

/**
 * The required fields still empty, as tag keys, to show "Still need to ask"
 * (light orange). Only once the file has an AI fill that wasn't undone:
 * before that, the form looks as it always did.
 */
export function askKeys(issues: UrlaIssue[], runs: FillRun[]): Set<string> {
  if (!runs.some((r) => !r.undone)) return new Set()
  return new Set(issues.flatMap((i) => issueKey(i.fix) ?? []))
}

/** The runs that hold each key, so confirming writes to the right ones. */
export function runsWithKey(runs: FillRun[], key: string): string[] {
  return runs.filter((r) => !r.undone && r.applied.some((a) => (a.kind === 'new_row' ? newRowKey(a.table, a.rowId) : a.key) === key)).map((r) => r.id)
}
