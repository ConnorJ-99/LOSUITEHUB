import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NoteKind } from '@/lib/api/types'
import { fullName } from '@/lib/pipeline/helpers'
import { readSources, type ActionItem, type ActionKind, type ActionStatus, type Confidence, type FileRef, type LoanDates } from '@/lib/queue/today'
import { db, keys, unwrap } from './client'

interface ActionRow {
  id: string
  loan_id: string
  kind: ActionKind
  title: string
  payload: unknown
  sources: unknown
  confidence: Confidence | null
  status: ActionStatus
  due_on: string | null
  ai_run_id: string | null
  created_at: string
  decided_at: string | null
}

const ACTION_SELECT = 'id, loan_id, kind, title, payload, sources, confidence, status, due_on, ai_run_id, created_at, decided_at'

const toAction = (r: ActionRow): ActionItem => ({
  id: r.id,
  loanId: r.loan_id,
  kind: r.kind,
  title: r.title,
  payload: r.payload,
  sources: readSources(r.sources),
  confidence: r.confidence,
  status: r.status,
  dueOn: r.due_on,
  aiRunId: r.ai_run_id,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
})

/** The file a queue item or deadline belongs to, with the primary borrower (for notes). */
export interface FileInfo extends FileRef {
  organizationId: string
  contactId: string | null
}

interface BorrowerRows {
  borrowers: { role: string; contact_id: string; contact: { first_name: string; last_name: string } | null }[]
}

const BORROWERS = 'borrowers:loan_borrowers ( role, contact_id, contact:contacts!loan_borrowers_contact_id_fkey ( first_name, last_name ) )'

function fileInfo(loanId: string, organizationId: string, loan: BorrowerRows | null): FileInfo {
  const primary = loan?.borrowers.find((b) => b.role === 'primary')
  return {
    loanId,
    organizationId,
    contactId: primary?.contact_id ?? null,
    borrowerName: primary?.contact ? fullName({ firstName: primary.contact.first_name, lastName: primary.contact.last_name }) : 'No borrower',
  }
}

/** A file's Action Queue: waiting items first (oldest first), then the last few decisions. */
export function useLoanQueue(loanId: string) {
  return useQuery({
    queryKey: keys.queue(loanId),
    queryFn: async () => {
      const items = unwrap<ActionRow[]>(await db().from('action_items').select(ACTION_SELECT).eq('loan_id', loanId).order('created_at')).map(toAction)
      const pending = items.filter((i) => i.status === 'pending')
      const decided = items
        .filter((i) => i.status !== 'pending')
        .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
        .slice(0, 5)
      return { pending, decided }
    },
  })
}

export interface TodayData {
  actions: (ActionItem & FileInfo)[]
  loans: (LoanDates & FileInfo)[]
}

/** Everything for the Today list that isn't a task: waiting queue items and loan deadlines (Row Level Security limits both to your files). */
export function useTodayData() {
  return useQuery({
    queryKey: keys.today,
    queryFn: async (): Promise<TodayData> => {
      const [actionRows, loanRows] = await Promise.all([
        db()
          .from('action_items')
          .select(`${ACTION_SELECT}, organization_id, loan:loans!action_items_loan_id_fkey ( ${BORROWERS} )`)
          .eq('status', 'pending')
          .order('created_at'),
        db()
          .from('loans')
          .select(`id, organization_id, stage, option_end_date, closing_date, ${BORROWERS}`)
          .or('option_end_date.not.is.null,closing_date.not.is.null'),
      ])
      return {
        actions: unwrap<(ActionRow & { organization_id: string; loan: BorrowerRows | null })[]>(actionRows).map((r) => ({
          ...toAction(r),
          ...fileInfo(r.loan_id, r.organization_id, r.loan),
        })),
        loans: unwrap<({ id: string; organization_id: string; stage: string; option_end_date: string | null; closing_date: string | null } & BorrowerRows)[]>(loanRows).map((r) => ({
          ...fileInfo(r.id, r.organization_id, r),
          stage: r.stage,
          optionEndDate: r.option_end_date,
          closingDate: r.closing_date,
        })),
      }
    },
  })
}

export interface Decision {
  item: ActionItem
  file: FileInfo
  status: 'approved' | 'edited' | 'dismissed'
  /** The final payload when it was edited before approving. */
  payload?: unknown
  /** Saved on the borrower's notes, tagged with the loan (approved messages). */
  note?: { kind: NoteKind; body: string }
  /** Created when a suggested task is approved. */
  task?: { title: string; dueOn: string | null }
}

/**
 * Records Connor's decision on a queue item. Approving can add a note or a
 * task to the file; nothing is ever sent from here. The assistant run's log
 * row gets the same outcome.
 */
export function useDecideAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ item, file, status, payload, note, task }: Decision) => {
      if (status !== 'dismissed' && task) {
        unwrap(await db().from('tasks').insert({ organization_id: file.organizationId, loan_id: file.loanId, title: task.title, due_on: task.dueOn }).select('id'))
      }
      if (status !== 'dismissed' && note && file.contactId) {
        unwrap(await db().from('notes').insert({ organization_id: file.organizationId, contact_id: file.contactId, loan_id: file.loanId, kind: note.kind, body: note.body }).select('id'))
      }
      const { data: user } = await db().auth.getUser()
      const rows = unwrap<{ id: string }[]>(
        await db()
          .from('action_items')
          .update({ status, decided_at: new Date().toISOString(), decided_by: user.user?.id ?? null, ...(payload !== undefined ? { payload } : {}) })
          .eq('id', item.id)
          .eq('status', 'pending')
          .select('id'),
      )
      if (rows.length === 0) throw new Error('This item was already decided, or you do not have permission.')
      if (item.aiRunId) unwrap(await db().from('ai_runs').update({ outcome: status }).eq('id', item.aiRunId).select('id'))
    },
    onSettled: (_d, _e, { file }) => {
      for (const key of [keys.queue(file.loanId), keys.today, keys.loanTasks(file.loanId), keys.myTasks]) queryClient.invalidateQueries({ queryKey: key })
      if (file.contactId) queryClient.invalidateQueries({ queryKey: keys.notes(file.contactId) })
    },
  })
}
