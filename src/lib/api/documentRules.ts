import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import { DEFAULT_DOCUMENT_RULES, type DocRule, type DocumentCondition } from '@/lib/prequal/nextStep'
import type { DocumentKind } from './documents'
import { db, keys, unwrap } from './client'

// ---------------------------------------------------------------------------
// Checklist rules (Settings)
// ---------------------------------------------------------------------------

export interface SavedRule extends DocRule {
  id: string
  builtIn: boolean
}

interface RuleRow {
  id: string
  key: string
  condition: DocumentCondition
  short_text: string
  full_text: string
  kind: DocumentKind
  sort_order: number
  active: boolean
  built_in: boolean
}

export const CONDITION_LABEL: Record<DocumentCondition, string> = {
  everyone: 'Everyone',
  wage_earner: 'Paid by an employer (full doc)',
  self_employed: 'Self-employed (full doc)',
  bank_statement_income: 'Bank-statement income',
  form_1099_income: '1099-only income',
  asset_based_income: 'Asset-based income',
  award_income: 'Social Security, pension, disability or VA income',
  support_income: 'Child support or alimony income',
  bank_accounts: 'Has bank accounts',
  investment_accounts: 'Has investment or retirement accounts',
  gift: 'Gift or grant',
  bankruptcy: 'Bankruptcy',
  foreclosure: 'Foreclosure, short sale or deed in lieu',
  late_or_collection: 'Late payment or collection',
  owns_home: 'Owns a home (whole file)',
  rental_or_dscr: 'Rents a home out, or DSCR (whole file)',
}

/** The company's checklist rules, in order. Falls back to the starter list before the rules script is run. */
export function useDocumentRules() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: [...keys.documentRules, orgId],
    queryFn: async (): Promise<SavedRule[]> => {
      // Someone in more than one company sees each company's rules; use the current one.
      let query = db().from('document_rules').select('id, key, condition, short_text, full_text, kind, sort_order, active, built_in')
      if (orgId) query = query.eq('organization_id', orgId)
      const { data, error } = await query.order('sort_order')
      if (error || !data?.length) return DEFAULT_DOCUMENT_RULES.map((r) => ({ ...r, id: r.key, builtIn: true }))
      return (data as RuleRow[]).map((r) => ({ id: r.id, key: r.key, condition: r.condition, shortText: r.short_text, fullText: r.full_text, kind: r.kind, sortOrder: r.sort_order, active: r.active, builtIn: r.built_in }))
    },
  })
}

export type RuleDraft = Omit<SavedRule, 'id' | 'builtIn' | 'key'> & { id: string | null; key: string | null }

/** A key from the wording: "A written VOE" → "a_written_voe". */
export const ruleKeyFrom = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'custom'

export function useSaveDocumentRule() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (r: RuleDraft) => {
      if (!r.shortText.trim() || !r.fullText.trim()) throw new Error('A rule needs both the short and the full wording.')
      const row = { condition: r.condition, short_text: r.shortText.trim(), full_text: r.fullText.trim(), kind: r.kind, sort_order: r.sortOrder, active: r.active }
      const result = r.id
        ? await db().from('document_rules').update(row).eq('id', r.id).select('id')
        : await db().from('document_rules').insert({ ...row, organization_id: orgId, key: `custom_${ruleKeyFrom(r.shortText)}` }).select('id')
      if (result.error?.code === '23505') throw new Error('A rule with that wording already exists.')
      if (unwrap<{ id: string }[]>(result).length === 0) throw new Error('Only owners and admins can change the checklist.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.documentRules }),
  })
}

export function useDeleteDocumentRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from('document_rules').delete().eq('id', id).select('id'))
      if (rows.length === 0) throw new Error('Built-in rules are turned off, not deleted. Only owners and admins can delete custom rules.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.documentRules }),
  })
}

// ---------------------------------------------------------------------------
// Requests on a file
// ---------------------------------------------------------------------------

export type RequestStatus = 'requested' | 'received' | 'reviewed' | 'waived'

export interface DocumentRequest {
  id: string
  contactId: string | null
  ruleKey: string
  label: string
  kind: DocumentKind
  status: RequestStatus
  requestedAt: string
  receivedAt: string | null
  reviewedAt: string | null
  documentId: string | null
}

interface RequestRow {
  id: string
  contact_id: string | null
  rule_key: string
  label: string
  kind: DocumentKind
  status: RequestStatus
  requested_at: string
  received_at: string | null
  reviewed_at: string | null
  document_id: string | null
}

export function useDocumentRequests(loanId: string) {
  return useQuery({
    queryKey: keys.documentRequests(loanId),
    queryFn: async () =>
      unwrap<RequestRow[]>(await db().from('document_requests').select('id, contact_id, rule_key, label, kind, status, requested_at, received_at, reviewed_at, document_id').eq('loan_id', loanId).order('requested_at')).map(
        (r): DocumentRequest => ({ id: r.id, contactId: r.contact_id, ruleKey: r.rule_key, label: r.label, kind: r.kind, status: r.status, requestedAt: r.requested_at, receivedAt: r.received_at, reviewedAt: r.reviewed_at, documentId: r.document_id }),
      ),
  })
}

export interface NewRequest {
  contactId: string | null
  ruleKey: string
  label: string
  kind: DocumentKind
}

/** Starts tracking these items as requested; items already tracked are left as they are. */
export async function addDocumentRequests(loanId: string, organizationId: string, items: NewRequest[]): Promise<number> {
  const existing = unwrap<{ contact_id: string | null; rule_key: string }[]>(await db().from('document_requests').select('contact_id, rule_key').eq('loan_id', loanId))
  const have = new Set(existing.map((e) => `${e.contact_id ?? ''}:${e.rule_key}`))
  const fresh = items.filter((i) => !have.has(`${i.contactId ?? ''}:${i.ruleKey}`))
  if (fresh.length === 0) return 0
  unwrap(
    await db()
      .from('document_requests')
      .insert(fresh.map((i) => ({ organization_id: organizationId, loan_id: loanId, contact_id: i.contactId, rule_key: i.ruleKey, label: i.label, kind: i.kind })))
      .select('id'),
  )
  return fresh.length
}

export function useAddDocumentRequests(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (items: NewRequest[]) => addDocumentRequests(loanId, organizationId, items),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.documentRequests(loanId) }),
  })
}

/** Moves a request along: received (optionally with the document), reviewed, waived, or back to requested. */
export function useUpdateDocumentRequest(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status, documentId }: { id: string; status: RequestStatus; documentId?: string | null }) => {
      const now = new Date().toISOString()
      const changes =
        status === 'requested'
          ? { status, received_at: null, reviewed_at: null, document_id: null }
          : status === 'received'
            ? { status, received_at: now, reviewed_at: null, ...(documentId !== undefined ? { document_id: documentId } : {}) }
            : status === 'reviewed'
              ? { status, reviewed_at: now }
              : { status }
      const rows = unwrap<{ id: string }[]>(await db().from('document_requests').update(changes).eq('id', id).select('id'))
      if (rows.length === 0) throw new Error('You do not have permission to change this request.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.documentRequests(loanId) }),
  })
}

export function useDeleteDocumentRequest(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await db().from('document_requests').delete().eq('id', id).select('id'))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.documentRequests(loanId) }),
  })
}
