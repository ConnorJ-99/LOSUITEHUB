import { useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import type { FillFact, FillQuestion } from '../../../supabase/functions/assistant/summaryFill'
import type { Change, FieldTarget, RowTable } from '@/lib/aifill/plan'
import { db, keys, unwrap } from './client'
import { saveLoanDetails } from './loans'
import { toSnake, type Application } from './urla'

// AI Summary Fill (Connor, 2026-11-19): reading call notes (assistant task
// summary_fill), saving each 1003 change as the signed-in person (Row Level
// Security applies), and undoing a run exactly. Every run is kept in
// ai_fill_runs with the value before and after each change.

export interface FillReadingResult {
  facts: FillFact[]
  unmapped: { sourceText: string; summary: string }[]
  ambiguous: FillQuestion[]
  dropped: { fieldPath: string; why: string }[]
  runId: string
}

/** The 1003 as it is now, small, for the assistant to match existing rows; plus the ids it may point at. */
export function fillContext(app: Application) {
  const current = {
    borrowers: app.borrowers.map((b) => ({
      firstName: b.person.firstName,
      role: b.role,
      person: { maritalStatus: b.person.maritalStatus, dependentsCount: b.person.dependentsCount, dateOfBirth: b.person.dateOfBirth, citizenship: b.person.citizenship },
      creditScore: b.estimatedCreditScore,
      currentAddress: b.addresses.filter((a) => a.kind === 'current').map((a) => ({ line: a.addressLine, city: a.city, housing: a.housing, rent: a.monthlyRent })),
      jobs: b.employments.map((e) => ({ id: e.id, employer: e.employerName, status: e.status, base: e.baseIncome, start: e.startDate })),
      otherIncome: b.otherIncomes.map((o) => ({ id: o.id, type: o.incomeType, monthly: o.monthlyAmount })),
    })),
    assets: app.assets.map((a) => ({ id: a.id, type: a.assetType, institution: a.institutionName, amount: a.amount })),
    liabilities: app.liabilities.map((l) => ({ id: l.id, type: l.liabilityType, creditor: l.creditorName, what: l.description, balance: l.unpaidBalance, payment: l.monthlyPayment })),
  }
  const existingRowIds = [...app.borrowers.flatMap((b) => [...b.employments.map((e) => e.id), ...b.otherIncomes.map((o) => o.id)]), ...app.assets.map((a) => a.id), ...app.liabilities.map((l) => l.id)]
  return { current, existingRowIds }
}

/** Asks the assistant to read the notes. Reads only; nothing on the file changes. */
export async function readCallNotes(loanId: string, notes: string, app: Application): Promise<FillReadingResult> {
  const { current, existingRowIds } = fillContext(app)
  const { data, error } = await db().functions.invoke<FillReadingResult>('assistant', { body: { task: 'summary_fill', loanId, notes, current, existingRowIds } })
  if (error || !data) {
    const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
    throw new Error(detail?.error ?? 'The assistant could not read the notes. Try again.')
  }
  return data
}

/** One change as saved, enough to put it back exactly. */
export type AppliedChange =
  | { kind: 'field'; key: string; target: FieldTarget; before: unknown; after: unknown; section: string; display: string; label: string }
  | { kind: 'new_row'; key: string; table: RowTable; rowId: string; section: string; display: string; fieldCount: number }

const toRow = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([field, value]) => [toSnake(field), typeof value === 'string' ? value.trim() || null : value]))

/** Writes one value where the 1003 form would. */
async function writeField(loanId: string, t: FieldTarget, value: unknown): Promise<void> {
  const check = (rows: { length: number }) => {
    if (rows.length === 0) throw new Error('You do not have permission to change this.')
  }
  switch (t.kind) {
    case 'person':
      return check(unwrap(await db().from('contacts').update(toRow({ [t.field]: value })).eq('id', t.contactId).select('id')))
    case 'address':
      return check(unwrap(await db().from('contact_addresses').update(toRow({ [t.field]: value })).eq('id', t.addressId).select('id')))
    case 'row':
      return check(unwrap(await db().from(t.table).update(toRow({ [t.field]: value })).eq('id', t.rowId).select('id')))
    case 'credit':
      return check(unwrap(await db().from('loan_borrowers').update({ estimated_credit_score: value }).eq('loan_id', loanId).eq('contact_id', t.contactId).select('contact_id')))
    case 'loan':
      return saveLoanDetails(loanId, { [t.field]: value })
    case 'declaration':
      unwrap(await db().from('borrower_declarations').upsert({ ...toRow({ [t.field]: value }), loan_id: loanId, contact_id: t.contactId }, { onConflict: 'loan_id,contact_id' }).select('loan_id'))
  }
}

/** Saves one planned change. A new row returns its id so it can be removed again. */
export async function applyChange(loanId: string, organizationId: string, c: Change): Promise<AppliedChange> {
  if (c.kind === 'field') {
    await writeField(loanId, c.target, c.after)
    return { kind: 'field', key: c.key, target: c.target, before: c.before, after: c.after, section: c.section, display: c.display, label: c.label }
  }
  const owner = c.table === 'assets' || c.table === 'liabilities' ? { loan_id: loanId } : { organization_id: organizationId }
  const row = unwrap<{ id: string }>(await db().from(c.table).insert({ ...toRow(c.values), ...owner }).select('id').single())
  return { kind: 'new_row', key: c.key, table: c.table, rowId: row.id, section: c.section, display: c.display, fieldCount: c.fieldCount }
}

/** Puts a run back: newest change first, each field to its value before, each added row removed. */
export async function undoChanges(loanId: string, applied: AppliedChange[]): Promise<string[]> {
  const problems: string[] = []
  for (const a of [...applied].reverse()) {
    try {
      if (a.kind === 'field') await writeField(loanId, a.target, a.before ?? null)
      else unwrap(await db().from(a.table).delete().eq('id', a.rowId).select('id'))
    } catch (e) {
      problems.push(`${a.display}: ${(e as Error).message}`)
    }
  }
  return problems
}

/** Saves the run (the typed notes, the reading and what changed). Before the script runs, it says so instead of failing the fill. */
export async function saveRun(v: { organizationId: string; loanId: string; aiRunId: string | null; notes: string; reading: unknown; applied: AppliedChange[] }): Promise<string | null> {
  const fields = v.applied.reduce((n, a) => n + (a.kind === 'new_row' ? a.fieldCount : 1), 0)
  const { data, error } = await db()
    .from('ai_fill_runs')
    .insert({ organization_id: v.organizationId, loan_id: v.loanId, ai_run_id: v.aiRunId, notes: v.notes, reading: v.reading, applied: v.applied, fields_filled: fields })
    .select('id')
    .single()
  if (error) return null
  return (data as { id: string }).id
}

/** Records more changes on a run (a Replace, or an answered question). */
export async function updateRun(runId: string | null, applied: AppliedChange[]) {
  if (!runId) return
  const fields = applied.reduce((n, a) => n + (a.kind === 'new_row' ? a.fieldCount : 1), 0)
  await db().from('ai_fill_runs').update({ applied, fields_filled: fields }).eq('id', runId)
}

export async function markRunUndone(runId: string | null) {
  if (!runId) return
  await db().from('ai_fill_runs').update({ undone_at: new Date().toISOString() }).eq('id', runId)
}

/** The typed notes as a call note, and what had no 1003 place as a second note, on the primary borrower, tagged with the file. */
export async function saveFillNotes(v: { organizationId: string; contactId: string; loanId: string; notes: string; leftovers: string[] }) {
  const rows = [{ organization_id: v.organizationId, contact_id: v.contactId, loan_id: v.loanId, kind: 'call', body: `Call notes (AI Fill):\n${v.notes.trim()}` }]
  if (v.leftovers.length) rows.push({ organization_id: v.organizationId, contact_id: v.contactId, loan_id: v.loanId, kind: 'note', body: `From the call, not on the 1003:\n${v.leftovers.map((l) => `• ${l}`).join('\n')}` })
  unwrap(await db().from('notes').insert(rows).select('id'))
}

/** Refreshes every screen that shows 1003 and loan values after a fill or undo. */
export function useRefreshAfterFill(loanId: string, contactIds: string[]) {
  const queryClient = useQueryClient()
  /** Resolves once the 1003 and the file have loaded again. */
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.application(loanId) }),
      queryClient.invalidateQueries({ queryKey: keys.loan(loanId) }),
      queryClient.invalidateQueries({ queryKey: keys.pipeline }),
      ...contactIds.map((id) => queryClient.invalidateQueries({ queryKey: keys.notes(id) })),
    ])
}
