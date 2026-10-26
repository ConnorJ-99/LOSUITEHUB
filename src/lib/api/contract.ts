import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ContactRole, ExtractedContact, ExtractedField } from '../../../supabase/functions/assistant/contract'
import { CONTACT_ROLES, CONTRACT_FIELDS } from '../../../supabase/functions/assistant/contract'
import type { LoanDetails } from './types'
import type { Application } from './urla'
import { invokeAssistant } from './assistant'
import { db, keys, unwrap } from './client'
import { saveLoanDetails } from './loans'

export type ReadingStatus = 'pending_review' | 'applied' | 'discarded'

/** One reading of the contract, as saved. Fields are re-checked on the way in. */
export interface ContractReadingRecord {
  id: string
  status: ReadingStatus
  fields: ExtractedField[]
  contacts: ExtractedContact[]
  notes: string | null
  aiRunId: string | null
  createdAt: string
  decidedAt: string | null
}

interface ReadingRow {
  id: string
  status: ReadingStatus
  fields: unknown
  contacts: unknown
  notes: string | null
  ai_run_id: string | null
  created_at: string
  decided_at: string | null
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const KEYS = new Set<string>(CONTRACT_FIELDS.map((f) => f.key))

/** Keeps only well-formed saved fields and contacts. */
export function readRecord(r: ReadingRow): ContractReadingRecord {
  const fields = (Array.isArray(r.fields) ? r.fields : []).filter(
    (f): f is ExtractedField => isObject(f) && KEYS.has(String(f.key)) && ['number', 'string', 'boolean'].includes(typeof f.value) && ['high', 'medium', 'low'].includes(String(f.confidence)),
  )
  const contacts = (Array.isArray(r.contacts) ? r.contacts : []).filter(
    (c): c is ExtractedContact => isObject(c) && CONTACT_ROLES.includes(c.role as ContactRole) && typeof c.name === 'string',
  )
  return { id: r.id, status: r.status, fields, contacts, notes: r.notes, aiRunId: r.ai_run_id, createdAt: r.created_at, decidedAt: r.decided_at }
}

/** The file's most recent contract reading, if any. */
export function useLatestReading(loanId: string) {
  return useQuery({
    queryKey: keys.readings(loanId),
    queryFn: async () => {
      const rows = unwrap<ReadingRow[]>(
        await db().from('contract_extractions').select('id, status, fields, contacts, notes, ai_run_id, created_at, decided_at').eq('loan_id', loanId).order('created_at', { ascending: false }).limit(1),
      )
      return rows[0] ? readRecord(rows[0]) : null
    },
  })
}

function useRefreshReading(loanId: string) {
  const queryClient = useQueryClient()
  return () => {
    for (const key of [keys.readings(loanId), keys.queue(loanId), keys.today, keys.loan(loanId), keys.application(loanId), keys.pipeline]) queryClient.invalidateQueries({ queryKey: key })
  }
}

/** Asks the assistant to read the uploaded contract. The reading waits for review; nothing on the file changes. */
export function useReadContract(loanId: string) {
  const refresh = useRefreshReading(loanId)
  return useMutation({
    mutationFn: () => invokeAssistant<{ extractionId: string }>({ task: 'contract_read', loanId }, 'The assistant could not read the contract.'),
    onSettled: refresh,
  })
}

/**
 * The 1003 keeps one earnest money entry: update it, add it for the primary
 * borrower, or remove it when the amount is cleared.
 */
export async function saveEarnestMoney(loanId: string, app: Application, amount: number | null) {
  const existing = app.assets.filter((a) => a.assetType === 'earnest_money')
  const [first, ...extra] = existing
  const remove = async (ids: string[]) => {
    if (ids.length) unwrap(await db().from('assets').delete().in('id', ids).select('id'))
  }
  if (amount === null) return remove(existing.map((a) => a.id))
  if (first) {
    unwrap(await db().from('assets').update({ amount }).eq('id', first.id).select('id'))
    return remove(extra.map((a) => a.id))
  }
  const primary = app.borrowers.find((b) => b.role === 'primary') ?? app.borrowers[0]
  if (!primary) throw new Error('Add a borrower before entering earnest money.')
  unwrap(await db().from('assets').insert({ loan_id: loanId, contact_id: primary.contactId, asset_type: 'earnest_money', amount, use_as: 'down_payment', description: 'From the purchase contract' }).select('id'))
}

/** Marks the queue item and the run log with the decision on a reading. */
async function recordDecision(loanId: string, reading: ContractReadingRecord, status: 'approved' | 'edited' | 'dismissed') {
  const { data: user } = await db().auth.getUser()
  unwrap(
    await db()
      .from('action_items')
      .update({ status, decided_at: new Date().toISOString(), decided_by: user.user?.id ?? null })
      .eq('loan_id', loanId)
      .eq('status', 'pending')
      .eq('payload->>extractionId', reading.id)
      .select('id'),
  )
  if (reading.aiRunId) unwrap(await db().from('ai_runs').update({ outcome: status }).eq('id', reading.aiRunId).select('id'))
}

export interface ApplyReading {
  reading: ContractReadingRecord
  app: Application
  details: Partial<LoanDetails>
  earnestMoney?: number
  /** Each field with Connor's decision, kept on the reading. */
  fields: unknown[]
  outcome: 'approved' | 'edited'
}

/** Saves the terms Connor picked to the file, then records the review. */
export function useApplyReading(loanId: string) {
  const refresh = useRefreshReading(loanId)
  return useMutation({
    mutationFn: async ({ reading, app, details, earnestMoney, fields, outcome }: ApplyReading) => {
      if (Object.keys(details).length) await saveLoanDetails(loanId, details)
      if (earnestMoney !== undefined) await saveEarnestMoney(loanId, app, earnestMoney)
      const { data: user } = await db().auth.getUser()
      const rows = unwrap<{ id: string }[]>(
        await db()
          .from('contract_extractions')
          .update({ status: 'applied', fields, decided_at: new Date().toISOString(), decided_by: user.user?.id ?? null })
          .eq('id', reading.id)
          .eq('status', 'pending_review')
          .select('id'),
      )
      if (rows.length === 0) throw new Error('This reading was already reviewed.')
      await recordDecision(loanId, reading, outcome)
    },
    onSettled: refresh,
  })
}

/** Sets a reading aside without changing the file. */
export function useDiscardReading(loanId: string) {
  const refresh = useRefreshReading(loanId)
  return useMutation({
    mutationFn: async (reading: ContractReadingRecord) => {
      const { data: user } = await db().auth.getUser()
      unwrap(
        await db()
          .from('contract_extractions')
          .update({ status: 'discarded', decided_at: new Date().toISOString(), decided_by: user.user?.id ?? null })
          .eq('id', reading.id)
          .eq('status', 'pending_review')
          .select('id'),
      )
      await recordDecision(loanId, reading, 'dismissed')
    },
    onSettled: refresh,
  })
}
