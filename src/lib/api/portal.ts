// The borrower portal from MPS-HQ's side (Stage 2, docs/plans/borrower-portal.md):
// portal links (one per borrower per file, 90 days, Copy any time), drafted
// invites, "Publish to borrower" on letters and estimate PDFs, and the
// borrower's home requests. Every message is a draft in the Action Queue.
// Before the borrower portal script has run, reads come back empty.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { newToken, sha256Hex } from '@/lib/documents/uploadRequests'
import { numbersReady, portalInvite, portalUrl } from '@/lib/portal/messages'
import { PORTAL_LINK_DAYS, type RequestStatus } from '../../../supabase/functions/document-upload/portal'
import { db, keys, unwrap } from './client'

const portalKey = (loanId: string) => ['portalLinks', loanId] as const
const requestsKey = (loanId: string) => ['portalRequests', loanId] as const
const openRequestsKey = ['openPortalRequests'] as const

export interface PortalLink {
  id: string
  contactId: string
  token: string
  url: string
  createdAt: string
  expiresAt: string
  firstOpenedAt: string | null
  lastOpenedAt: string | null
}

/** The file's live portal links (one per borrower). Null = the borrower portal script hasn't run yet. */
export function usePortalLinks(loanId: string) {
  return useQuery({
    queryKey: portalKey(loanId),
    retry: false,
    queryFn: async (): Promise<PortalLink[] | null> => {
      const r = await db().from('document_upload_links').select('*').eq('loan_id', loanId).is('revoked_at', null).order('created_at', { ascending: false })
      if (r.error) return null
      const rows = r.data as Record<string, string | null>[]
      if (rows.length && !('kind' in rows[0])) return null
      return rows
        .filter((l) => l.kind === 'portal' && l.token)
        .map((l) => ({ id: l.id!, contactId: l.contact_id!, token: l.token!, url: portalUrl(window.location.origin, l.token!), createdAt: l.created_at!, expiresAt: l.expires_at!, firstOpenedAt: l.first_opened_at, lastOpenedAt: l.last_opened_at }))
    },
  })
}

/** Makes (or renews) a borrower's portal link: the live one is turned off first, so the old address stops working. */
export function useMakePortalLink(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { organizationId: string; contactId: string }) => {
      unwrap(await db().from('document_upload_links').update({ revoked_at: new Date().toISOString() }).eq('loan_id', loanId).eq('contact_id', v.contactId).eq('kind', 'portal').is('revoked_at', null).select('id'))
      const token = newToken()
      unwrap(
        await db()
          .from('document_upload_links')
          .insert({ organization_id: v.organizationId, loan_id: loanId, contact_id: v.contactId, kind: 'portal', token, token_hash: await sha256Hex(token), expires_at: new Date(Date.now() + PORTAL_LINK_DAYS * 86_400_000).toISOString() })
          .select('id'),
      )
      return portalUrl(window.location.origin, token)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: portalKey(loanId) }),
  })
}

export function useTurnOffPortalLink(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from('document_upload_links').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null).select('id'))
      if (!rows.length) throw new Error('This link could not be turned off.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: portalKey(loanId) }),
  })
}

interface DraftTo {
  organizationId: string
  loanId: string
  contactId: string
  name: string
  phone: string | null
  email: string | null
}

async function queueDrafts(to: DraftTo, title: string, m: { text: string; subject: string; email: string }, channels: ('text' | 'email')[], sourceKey?: string) {
  const rows = channels
    .filter((c) => (c === 'text' ? to.phone : to.email))
    .map((c) => ({
      organization_id: to.organizationId,
      loan_id: to.loanId,
      kind: 'draft_message',
      title,
      payload: { channel: c, to: c === 'text' ? to.phone : to.email, subject: c === 'email' ? m.subject : null, body: c === 'text' ? m.text : m.email, contactId: to.contactId },
      sources: [],
      confidence: null,
      due_on: null,
      ai_run_id: null,
      ...(sourceKey ? { source_key: `${sourceKey}:${c}` } : {}),
    }))
  if (!rows.length) throw new Error(`${to.name} has no ${channels.join(' or ')} on file.`)
  if (sourceKey) return unwrap<{ id: string }[]>(await db().from('action_items').upsert(rows, { onConflict: 'organization_id,source_key', ignoreDuplicates: true }).select('id')).length
  return unwrap<{ id: string }[]>(await db().from('action_items').insert(rows).select('id')).length
}

/** The portal invite as a text or email draft in the Action Queue. */
export function useDraftPortalInvite(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: DraftTo & { firstName: string; loName: string; url: string; isPurchase: boolean; channel: 'text' | 'email' }) => queueDrafts(v, `Borrower portal: ${v.name}`, portalInvite(v), [v.channel]),
    onSettled: () => {
      for (const k of [keys.queue(loanId), keys.today]) queryClient.invalidateQueries({ queryKey: k })
    },
  })
}

// ---------------------------------------------------------------------------
// Publish to borrower
// ---------------------------------------------------------------------------

export const PUBLISHABLE_KINDS = ['preapproval_letter', 'fee_worksheet', 'loan_comparison'] as const
export const isPublishable = (kind: string) => (PUBLISHABLE_KINDS as readonly string[]).includes(kind)

/** Published dates for the file's documents (id → when); `ready` is false before the borrower portal script has run. */
export function usePublished(loanId: string) {
  return useQuery({
    queryKey: ['published', loanId],
    retry: false,
    queryFn: async (): Promise<{ ready: boolean; at: Map<string, string> }> => {
      const r = await db().from('loan_documents').select('id, published_at').eq('loan_id', loanId).not('published_at', 'is', null)
      if (r.error) return { ready: false, at: new Map() }
      return { ready: true, at: new Map((r.data as { id: string; published_at: string }[]).map((d) => [d.id, d.published_at])) }
    },
  })
}

/**
 * Publishes (or unpublishes) a letter or estimate PDF to the borrower portal.
 * Publishing one for a home the borrower asked about marks the request Ready
 * (the database does that) and drafts "your numbers are ready" for each
 * requester with a live portal link. Returns how many drafts were queued.
 */
export function usePublishDocument(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { documentId: string; publish: boolean; userId: string | null; loName: string }): Promise<number> => {
      const doc = unwrap<{ id: string; organization_id: string; property_id: string | null }[]>(await db().from('loan_documents').select('id, organization_id, property_id').eq('id', v.documentId))[0]
      if (!doc) throw new Error('That document is gone.')
      const open = v.publish && doc.property_id
        ? unwrap<{ id: string; contact_id: string; address_line: string }[]>(await db().from('portal_property_requests').select('id, contact_id, address_line').eq('loan_id', loanId).eq('property_id', doc.property_id).in('status', ['requested', 'in_progress']))
        : []
      unwrap(await db().from('loan_documents').update(v.publish ? { published_at: new Date().toISOString(), published_by: v.userId } : { published_at: null, published_by: null }).eq('id', v.documentId).select('id'))
      let drafts = 0
      for (const req of open) {
        const link = unwrap<{ token: string | null }[]>(await db().from('document_upload_links').select('token').eq('loan_id', loanId).eq('contact_id', req.contact_id).eq('kind', 'portal').is('revoked_at', null).limit(1))[0]
        const person = unwrap<{ first_name: string; last_name: string | null; phone: string | null; email: string | null; sms_opted_out_at: string | null; email_opted_out_at: string | null }[]>(
          await db().from('contacts').select('first_name, last_name, phone, email, sms_opted_out_at, email_opted_out_at').eq('id', req.contact_id),
        )[0]
        if (!link?.token || !person) continue
        const to: DraftTo = { organizationId: doc.organization_id, loanId, contactId: req.contact_id, name: `${person.first_name} ${person.last_name ?? ''}`.trim(), phone: person.sms_opted_out_at ? null : person.phone, email: person.email_opted_out_at ? null : person.email }
        const m = numbersReady({ firstName: person.first_name, loName: v.loName, url: portalUrl(window.location.origin, link.token), address: req.address_line })
        // A text first; an email only when there's no phone to text.
        drafts += await queueDrafts(to, `Numbers ready: ${req.address_line}`, m, to.phone ? ['text'] : ['email'], `portal-ready:${req.id}`).catch(() => 0)
      }
      return drafts
    },
    onSettled: () => {
      for (const k of [['published', loanId], keys.documents(loanId), requestsKey(loanId), openRequestsKey, keys.queue(loanId), keys.today]) queryClient.invalidateQueries({ queryKey: k })
    },
  })
}

// ---------------------------------------------------------------------------
// Home requests
// ---------------------------------------------------------------------------

export interface PortalRequest {
  id: string
  loanId: string
  contactId: string
  propertyId: string | null
  borrowerName: string
  address: string
  price: number
  downPaymentAmount: number | null
  downPaymentPct: number | null
  loanAmount: number | null
  wantsLetter: boolean
  wantsEstimate: boolean
  notes: string | null
  overPrice: number
  overLoanAmount: number
  status: RequestStatus
  createdAt: string
}

const REQUEST_SELECT = 'id, loan_id, contact_id, property_id, address_line, city, price, down_payment_amount, down_payment_pct, loan_amount, wants_letter, wants_estimate, notes, over_price, over_loan_amount, status, created_at, contact:contacts ( first_name, last_name )'

function toRequest(r: Record<string, unknown>): PortalRequest {
  const c = r.contact as { first_name: string; last_name: string | null } | null
  const n = (x: unknown) => (x == null ? null : Number(x))
  return {
    id: r.id as string,
    loanId: r.loan_id as string,
    contactId: r.contact_id as string,
    propertyId: (r.property_id as string | null) ?? null,
    borrowerName: c ? `${c.first_name} ${c.last_name ?? ''}`.trim() : 'Borrower',
    address: r.city ? `${r.address_line as string}, ${r.city as string}` : (r.address_line as string),
    price: Number(r.price),
    downPaymentAmount: n(r.down_payment_amount),
    downPaymentPct: n(r.down_payment_pct),
    loanAmount: n(r.loan_amount),
    wantsLetter: r.wants_letter as boolean,
    wantsEstimate: r.wants_estimate as boolean,
    notes: (r.notes as string | null) ?? null,
    overPrice: Number(r.over_price),
    overLoanAmount: Number(r.over_loan_amount),
    status: r.status as RequestStatus,
    createdAt: r.created_at as string,
  }
}

/** One file's home requests, newest first. */
export function usePortalRequests(loanId: string) {
  return useQuery({
    queryKey: requestsKey(loanId),
    retry: false,
    queryFn: async (): Promise<PortalRequest[]> => {
      const r = await db().from('portal_property_requests').select(REQUEST_SELECT).eq('loan_id', loanId).order('created_at', { ascending: false })
      if (r.error) return []
      return (r.data as Record<string, unknown>[]).map(toRequest)
    },
  })
}

/** Where "Start numbers" goes: Build estimates on that home with the price and down payment % the borrower asked for. */
export function startNumbersUrl(r: PortalRequest): string {
  const pct = r.downPaymentPct ?? (r.downPaymentAmount != null && r.price > 0 ? Math.round((r.downPaymentAmount / r.price) * 100_000) / 1000 : null)
  const q = new URLSearchParams({ tab: 'estimates', view: 'build', price: String(r.price), ...(pct != null ? { down: String(pct) } : {}), ...(r.propertyId ? { property: r.propertyId } : {}) })
  return `/loans/${r.loanId}?${q.toString()}`
}

/** Open home requests on files you can see, oldest first (Today's Portal requests). */
export function useOpenPortalRequests() {
  return useQuery({
    queryKey: openRequestsKey,
    retry: false,
    refetchInterval: 60_000,
    queryFn: async (): Promise<PortalRequest[]> => {
      const r = await db().from('portal_property_requests').select(REQUEST_SELECT).in('status', ['requested', 'in_progress']).order('created_at')
      if (r.error) return []
      return (r.data as Record<string, unknown>[]).map(toRequest)
    },
  })
}

export interface PortalUpload {
  id: string
  loanId: string
  label: string
  borrowerName: string
  receivedAt: string
}

/** Documents borrowers sent that wait for review (received, not accepted yet), newest first. */
export function usePortalUploads() {
  return useQuery({
    queryKey: ['portalUploads'],
    retry: false,
    refetchInterval: 60_000,
    queryFn: async (): Promise<PortalUpload[]> => {
      const r = await db().from('document_requests').select('id, loan_id, label, received_at, contact:contacts ( first_name, last_name )').eq('status', 'received').not('link_id', 'is', null).order('received_at', { ascending: false }).limit(20)
      if (r.error) return []
      return (r.data as unknown as { id: string; loan_id: string; label: string; received_at: string; contact: { first_name: string; last_name: string | null } | null }[]).map((d) => ({
        id: d.id,
        loanId: d.loan_id,
        label: d.label,
        borrowerName: d.contact ? `${d.contact.first_name} ${d.contact.last_name ?? ''}`.trim() : 'Borrower',
        receivedAt: d.received_at,
      }))
    },
  })
}

export function useSetRequestStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; loanId: string; status: RequestStatus }) => {
      unwrap(await db().from('portal_property_requests').update({ status: v.status }).eq('id', v.id).select('id'))
    },
    onSettled: (_d, _e, v) => {
      for (const k of [openRequestsKey, requestsKey(v.loanId)]) queryClient.invalidateQueries({ queryKey: k })
    },
  })
}

// ---------------------------------------------------------------------------
// Portal step messages (Settings → Borrower portal)
// ---------------------------------------------------------------------------

const stageKey = ['portalStageMessages'] as const

/** Connor's wording per portal step (blank = the default). Null = the borrower portal script hasn't run yet. */
export function usePortalStageMessages() {
  return useQuery({
    queryKey: stageKey,
    retry: false,
    queryFn: async (): Promise<Record<string, string> | null> => {
      const r = await db().from('messaging_settings').select('portal_stage_messages').maybeSingle()
      if (r.error) return null
      return ((r.data as { portal_stage_messages: Record<string, string> } | null)?.portal_stage_messages ?? {}) as Record<string, string>
    },
  })
}

export function useSavePortalStageMessages() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { organizationId: string; messages: Record<string, string> }) => {
      const clean = Object.fromEntries(Object.entries(v.messages).map(([k, t]) => [k, t.trim()]).filter(([, t]) => t))
      unwrap(await db().from('messaging_settings').upsert({ organization_id: v.organizationId, portal_stage_messages: clean }, { onConflict: 'organization_id' }).select('organization_id'))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: stageKey }),
  })
}
