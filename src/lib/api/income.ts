import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { aiEdits } from '@/lib/income/edits'
import type { InputSources } from '@/lib/income/fromDocuments'
import type { EmploymentIncomeField, PushTarget, WorksheetKind } from '@/lib/income/worksheets'
import { db, keys, num, unwrap } from './client'

/** One saved income worksheet. `inputs` is normalized with normalizeInputs() before use. */
export interface IncomeWorksheet {
  id: string
  organizationId: string
  loanId: string
  contactId: string
  kind: WorksheetKind
  label: string | null
  inputs: unknown
  resultMonthly: number | null
  employmentId: string | null
  propertyId: string | null
  pushedMonthly: number | null
  pushedAt: string | null
  createdAt: string
  /** AI income drafts (Stage 4): 'draft' until pushed to the 1003. Worksheets from before the script read as final and manual. */
  status: 'draft' | 'final'
  source: 'manual' | 'ai'
  sourceDocumentIds: string[]
  sourceNotes: string[]
  /** Stage 4d: where each AI-filled input came from ({} when typed by hand, or before the income review script). */
  inputSources: InputSources
}

interface WorksheetRow {
  id: string
  organization_id: string
  loan_id: string
  contact_id: string
  kind: WorksheetKind
  label: string | null
  inputs: unknown
  result_monthly: number | string | null
  employment_id: string | null
  property_id: string | null
  pushed_monthly: number | string | null
  pushed_at: string | null
  created_at: string
  status?: 'draft' | 'final'
  source?: 'manual' | 'ai'
  source_document_ids?: string[]
  source_notes?: string[]
  input_sources?: InputSources
}

const toWorksheet = (r: WorksheetRow): IncomeWorksheet => ({
  id: r.id,
  organizationId: r.organization_id,
  loanId: r.loan_id,
  contactId: r.contact_id,
  kind: r.kind,
  label: r.label,
  inputs: r.inputs,
  resultMonthly: num(r.result_monthly),
  employmentId: r.employment_id,
  propertyId: r.property_id,
  pushedMonthly: num(r.pushed_monthly),
  pushedAt: r.pushed_at,
  createdAt: r.created_at,
  status: r.status ?? 'final',
  source: r.source ?? 'manual',
  sourceDocumentIds: r.source_document_ids ?? [],
  sourceNotes: r.source_notes ?? [],
  inputSources: r.input_sources ?? {},
})

const missingTable = (message: string) => /income_worksheet_edits|input_sources|schema cache|does not exist/.test(message)

/**
 * Logs each change to a figure the AI filled in (Stage 4d-1): compares the
 * worksheet as last saved with what's being saved. Before the income review
 * script has run there's nowhere to log, and the save still goes through.
 */
async function logAiEdits(previous: IncomeWorksheet | undefined, newInputs: unknown) {
  if (!previous || previous.source !== 'ai') return
  const edits = aiEdits(previous.inputSources, previous.inputs, newInputs)
  if (!edits.length) return
  const r = await db()
    .from('income_worksheet_edits')
    .insert(edits.map((e) => ({ organization_id: previous.organizationId, worksheet_id: previous.id, input: e.input, ai_value: e.aiValue, ai_quote: e.aiQuote, new_value: e.newValue })))
    .select('id')
  if (r.error && !missingTable(r.error.message)) throw new Error(`Saved, but the change log failed: ${r.error.message}`)
}

/** Every income worksheet on a loan, oldest first. */
export function useWorksheets(loanId: string) {
  return useQuery({
    queryKey: keys.worksheets(loanId),
    queryFn: async () => unwrap<WorksheetRow[]>(await db().from('income_worksheets').select('*').eq('loan_id', loanId).order('created_at')).map(toWorksheet),
  })
}

/** What the worksheet editor saves. */
export interface WorksheetDraft {
  label: string
  inputs: unknown
  resultMonthly: number
  employmentId: string | null
  propertyId: string | null
}

const draftRow = (d: WorksheetDraft) => ({
  label: d.label.trim() || null,
  inputs: d.inputs,
  result_monthly: d.resultMonthly,
  employment_id: d.employmentId,
  property_id: d.propertyId,
})

async function updateWorksheet(id: string, row: Record<string, unknown>) {
  const rows = unwrap<{ id: string }[]>(await db().from('income_worksheets').update(row).eq('id', id).select('id'))
  if (rows.length === 0) throw new Error('You do not have permission to edit this worksheet.')
}

export function useCreateWorksheet(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ contactId, kind, ...draft }: WorksheetDraft & { contactId: string; kind: WorksheetKind }) =>
      unwrap<{ id: string }>(
        await db()
          .from('income_worksheets')
          .insert({ ...draftRow(draft), kind, contact_id: contactId, loan_id: loanId, organization_id: organizationId })
          .select('id')
          .single(),
      ).id,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.worksheets(loanId) }),
  })
}

export function useSaveWorksheet(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    /** `previous` = the worksheet as last saved, for the AI edit log. */
    mutationFn: async ({ id, previous, ...draft }: WorksheetDraft & { id: string; previous?: IncomeWorksheet }) => {
      await updateWorksheet(id, draftRow(draft))
      await logAiEdits(previous, draft.inputs)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.worksheets(loanId) }),
  })
}

export function useDeleteWorksheet(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from('income_worksheets').delete().eq('id', id).select('id'))
      if (rows.length === 0) throw new Error('You do not have permission to delete this worksheet.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.worksheets(loanId) }),
  })
}

const EMPLOYMENT_COLUMNS: Record<EmploymentIncomeField, string> = {
  baseIncome: 'base_income',
  overtimeIncome: 'overtime_income',
  bonusIncome: 'bonus_income',
  commissionIncome: 'commission_income',
  selfEmployedIncome: 'self_employed_income',
}

export interface PushInput {
  id: string
  contactId: string
  draft: WorksheetDraft
  target: PushTarget
  value: number
  /** Creates a current job with this employer name first, when the worksheet has no job yet. */
  newEmployerName?: string
}

/**
 * "Push to 1003": saves the worksheet, writes its result into the job or
 * property it points at, then records what was pushed and when. Returns the
 * job id (new when the push created the job).
 */
export function usePushWorksheet(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, contactId, draft, target, value, newEmployerName, previous }: PushInput & { previous?: IncomeWorksheet }) => {
      let { employmentId } = draft
      const selfEmployed = target.to === 'employment' && target.field === 'selfEmployedIncome'
      if (target.to === 'employment' && !employmentId && newEmployerName?.trim()) {
        employmentId = unwrap<{ id: string }>(
          await db()
            .from('employments')
            .insert({ organization_id: organizationId, contact_id: contactId, employer_name: newEmployerName.trim(), status: 'current', is_self_employed: selfEmployed })
            .select('id')
            .single(),
        ).id
      }
      await updateWorksheet(id, draftRow({ ...draft, employmentId }))
      await logAiEdits(previous, draft.inputs)

      if (target.to === 'employment') {
        if (!employmentId) throw new Error('Choose the job this income belongs to.')
        const changes: Record<string, unknown> = { [EMPLOYMENT_COLUMNS[target.field]]: value }
        if (selfEmployed) changes.is_self_employed = true
        const rows = unwrap<{ id: string }[]>(await db().from('employments').update(changes).eq('id', employmentId).select('id'))
        if (rows.length === 0) throw new Error('Could not update that job on the 1003.')
      } else {
        if (!draft.propertyId) throw new Error('Choose the property this rental income belongs to.')
        const changes =
          target.method === 'lease'
            ? { rental_income_method: 'lease', monthly_rent: value }
            : { rental_income_method: 'schedule_e', schedule_e_monthly_income: value }
        const rows = unwrap<{ id: string }[]>(await db().from('properties').update(changes).eq('id', draft.propertyId).select('id'))
        if (rows.length === 0) throw new Error('Could not update that property.')
      }

      await updateWorksheet(id, { pushed_monthly: value, pushed_at: new Date().toISOString() })
      return { employmentId }
    },
    onSettled: () => {
      for (const key of [keys.worksheets(loanId), keys.application(loanId), keys.properties(loanId), keys.loan(loanId)]) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })
}


/** One draft from "Calculate income" (src/lib/income/fromDocuments.ts). */
export interface NewIncomeDraft {
  contactId: string
  kind: WorksheetKind
  label: string
  inputs: unknown
  resultMonthly: number
  employmentId: string | null
  sourceDocumentIds: string[]
  sourceNotes: string[]
  /** Stage 4d: where each input came from. */
  inputSources: InputSources
}

/**
 * Saves "Calculate income" results as AI drafts. A new calculation replaces
 * the earlier AI drafts for the same borrower, type, job and label; worksheets
 * Connor typed (or accepted) are never touched.
 */
export function useSaveIncomeDrafts(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (drafts: NewIncomeDraft[]) => {
      for (const d of drafts) {
        let old = db().from('income_worksheets').delete().eq('loan_id', loanId).eq('contact_id', d.contactId).eq('kind', d.kind).eq('status', 'draft').eq('source', 'ai').eq('label', d.label)
        old = d.employmentId ? old.eq('employment_id', d.employmentId) : old.is('employment_id', null)
        unwrap(await old.select('id'))
      }
      const rows = (withSources: boolean) =>
        drafts.map((d) => ({
          organization_id: organizationId,
          loan_id: loanId,
          contact_id: d.contactId,
          kind: d.kind,
          label: d.label,
          inputs: d.inputs,
          result_monthly: d.resultMonthly,
          employment_id: d.employmentId,
          property_id: null,
          status: 'draft',
          source: 'ai',
          source_document_ids: d.sourceDocumentIds,
          source_notes: d.sourceNotes,
          ...(withSources ? { input_sources: d.inputSources } : {}),
        }))
      const first = await db().from('income_worksheets').insert(rows(true)).select('id')
      // Before the income review script there's no input_sources column: save the drafts without it.
      if (first.error && missingTable(first.error.message)) unwrap(await db().from('income_worksheets').insert(rows(false)).select('id'))
      else unwrap(first)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.worksheets(loanId) }),
  })
}

/** Ticks (or unticks) one AI figure as checked: saved on the worksheet's input_sources right away (Stage 4d-2). */
export function useSaveInputSources(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, inputSources }: { id: string; inputSources: InputSources }) => {
      const r = await db().from('income_worksheets').update({ input_sources: inputSources }).eq('id', id).select('id')
      if (r.error) throw new Error(missingTable(r.error.message) ? 'Run the income review script in Supabase first.' : r.error.message)
      if (!r.data?.length) throw new Error('You do not have permission to edit this worksheet.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.worksheets(loanId) }),
  })
}
