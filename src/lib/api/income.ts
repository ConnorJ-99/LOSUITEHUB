import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EmploymentIncomeField, PushTarget, WorksheetKind } from '@/lib/income/worksheets'
import { db, keys, num, unwrap } from './client'

/** One saved income worksheet. `inputs` is normalized with normalizeInputs() before use. */
export interface IncomeWorksheet {
  id: string
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
}

interface WorksheetRow {
  id: string
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
}

const toWorksheet = (r: WorksheetRow): IncomeWorksheet => ({
  id: r.id,
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
})

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
    mutationFn: ({ id, ...draft }: WorksheetDraft & { id: string }) => updateWorksheet(id, draftRow(draft)),
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
    mutationFn: async ({ id, contactId, draft, target, value, newEmployerName }: PushInput) => {
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

