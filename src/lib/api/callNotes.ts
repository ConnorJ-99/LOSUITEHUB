import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NoteItem } from '../../../supabase/functions/assistant/callNotes'
import type { SavedNow } from '@/lib/prequal/noteReview'
import { invokeAssistant } from './assistant'
import { db, keys, unwrap } from './client'
import { saveLoanDetails } from './loans'

export type ReadingStatus = 'pending_review' | 'applied' | 'discarded'

export interface NoteReadingRecord {
  id: string
  status: ReadingStatus
  noteId: string | null
  items: NoteItem[]
  notes: string | null
  aiRunId: string | null
  createdAt: string
}

interface ReadingRow {
  id: string
  status: ReadingStatus
  note_id: string | null
  items: unknown
  notes: string | null
  ai_run_id: string | null
  created_at: string
}

const KINDS = new Set(['loan_type', 'purchase_price', 'down_payment', 'down_payment_pct', 'credit_score', 'first_time_buyer', 'job', 'other_income', 'debt', 'savings', 'home', 'credit_event', 'doc_type', 'timeline'])
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Keeps only well-formed saved items. */
export function readNoteRecord(r: ReadingRow): NoteReadingRecord {
  const items = (Array.isArray(r.items) ? r.items : []).filter(
    (i): i is NoteItem => isObject(i) && typeof i.id === 'string' && KINDS.has(String(i.kind)) && ['high', 'medium', 'low'].includes(String(i.confidence)),
  )
  return { id: r.id, status: r.status, noteId: r.note_id, items, notes: r.notes, aiRunId: r.ai_run_id, createdAt: r.created_at }
}

/** The file's reading still waiting for review, if any. */
export function usePendingNoteReading(loanId: string) {
  return useQuery({
    queryKey: keys.noteReadings(loanId),
    queryFn: async () => {
      const rows = unwrap<ReadingRow[]>(
        await db().from('call_note_readings').select('id, status, note_id, items, notes, ai_run_id, created_at').eq('loan_id', loanId).eq('status', 'pending_review').order('created_at', { ascending: false }).limit(1),
      )
      return rows[0] ? readNoteRecord(rows[0]) : null
    },
  })
}

function useRefresh(loanId: string) {
  const queryClient = useQueryClient()
  return () => {
    for (const key of [keys.noteReadings(loanId), keys.queue(loanId), keys.today]) queryClient.invalidateQueries({ queryKey: key })
  }
}

/** The note was saved, but the assistant couldn't read it (so the box can clear and nothing is saved twice). */
export class NoteSavedButNotRead extends Error {}

/** Saves what Connor typed as a call note on the borrower, then asks the assistant to read it. */
export function useSaveAndReadNote(loanId: string, organizationId: string, contactId: string) {
  const queryClient = useQueryClient()
  const refresh = useRefresh(loanId)
  return useMutation({
    mutationFn: async ({ body, noteId }: { body?: string; noteId?: string }) => {
      let id = noteId
      if (!id) {
        const text = body?.trim()
        if (!text) throw new Error('Type or paste the notes first.')
        const row = unwrap<{ id: string }>(await db().from('notes').insert({ organization_id: organizationId, contact_id: contactId, loan_id: loanId, kind: 'call', body: text }).select('id').single())
        id = row.id
        queryClient.invalidateQueries({ queryKey: keys.notes(contactId) })
      }
      try {
        return await invokeAssistant<{ readingId: string }>({ task: 'call_notes_read', loanId, noteId: id }, 'The assistant could not read the notes.')
      } catch (e) {
        if (noteId) throw e
        throw new NoteSavedButNotRead(`Your note is saved. The assistant couldn't read it yet: ${(e as Error).message}`)
      }
    },
    onSettled: refresh,
  })
}

/** The newest call note on the borrower, to read again without retyping. */
export function useLatestCallNote(contactId: string) {
  return useQuery({
    queryKey: [...keys.notes(contactId), 'latestCall'],
    queryFn: async () => {
      const rows = unwrap<{ id: string; body: string; created_at: string }[]>(await db().from('notes').select('id, body, created_at').eq('contact_id', contactId).eq('kind', 'call').order('created_at', { ascending: false }).limit(1))
      return rows[0] ?? null
    },
  })
}

/** Saves the picked items that live outside the Prequal form. */
export async function saveNoteItems(loanId: string, organizationId: string, s: SavedNow) {
  const details = { ...(s.incomeDocType ? { incomeDocType: s.incomeDocType } : {}), ...(s.timeline ? { timeline: s.timeline } : {}) }
  if (Object.keys(details).length) await saveLoanDetails(loanId, details)
  if (s.creditEvents.length) {
    unwrap(
      await db()
        .from('credit_events')
        .insert(s.creditEvents.map((e) => ({ organization_id: organizationId, contact_id: e.contactId, event_type: e.eventType, event_date: e.eventDate, days_late: e.daysLate, is_mortgage: e.isMortgage, notes: 'From call notes' })))
        .select('id'),
    )
  }
  for (const o of s.ownedPast3Years) {
    unwrap(await db().from('borrower_declarations').upsert({ loan_id: loanId, contact_id: o.contactId, owned_property_past_3_years: o.value }, { onConflict: 'loan_id,contact_id' }).select('loan_id'))
  }
}

/** Records Connor's decision on a reading, its queue item and the run log. */
export function useDecideNoteReading(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  const refresh = useRefresh(loanId)
  return useMutation({
    mutationFn: async ({ reading, status, items, outcome, saveNow }: { reading: NoteReadingRecord; status: 'applied' | 'discarded'; items?: unknown[]; outcome: 'approved' | 'edited' | 'dismissed'; saveNow?: SavedNow }) => {
      if (saveNow) await saveNoteItems(loanId, organizationId, saveNow)
      const { data: user } = await db().auth.getUser()
      const now = new Date().toISOString()
      const rows = unwrap<{ id: string }[]>(
        await db()
          .from('call_note_readings')
          .update({ status, decided_at: now, decided_by: user.user?.id ?? null, ...(items ? { items } : {}) })
          .eq('id', reading.id)
          .eq('status', 'pending_review')
          .select('id'),
      )
      if (rows.length === 0) throw new Error('This reading was already reviewed.')
      unwrap(await db().from('action_items').update({ status: outcome, decided_at: now, decided_by: user.user?.id ?? null }).eq('loan_id', loanId).eq('status', 'pending').eq('payload->>readingId', reading.id).select('id'))
      if (reading.aiRunId) unwrap(await db().from('ai_runs').update({ outcome }).eq('id', reading.aiRunId).select('id'))
    },
    onSettled: () => {
      refresh()
      for (const key of [keys.creditEvents(loanId), keys.application(loanId), keys.loan(loanId)]) queryClient.invalidateQueries({ queryKey: key })
    },
  })
}
