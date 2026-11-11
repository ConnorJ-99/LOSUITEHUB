import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import { planRequest, newToken, remindersDue, sha256Hex, uploadMessages, uploadUrl, type CatalogCategory, type CatalogItem, type PickedItem, type RequestPlan } from '@/lib/documents/uploadRequests'
import type { ItemStatus } from '../../../supabase/functions/document-upload/rules'
import { db, keys, unwrap } from './client'
import type { DocumentKind } from './documents'
import type { ShareRecipient } from './estimateShares'

// Custom document requests (UI pass Part 3): the catalog, presets, sending a
// request (a link, checklist rows and draft messages; nothing sends), the
// links on a file and the uploads for each item.

const catalogKey = ['documentCatalog'] as const
const presetsKey = ['documentPresets'] as const
const linksKey = (loanId: string) => ['uploadLinks', loanId] as const
const itemFilesKey = (loanId: string) => ['requestFiles', loanId] as const

interface CatalogRow {
  id: string
  key: string
  category: CatalogCategory
  label: string
  instructions: string
  period: string | null
  kind: DocumentKind
  sort_order: number
  active: boolean
  built_in: boolean
}

/** The company's document catalog. Empty before the upload links script has run. */
export function useDocumentCatalog() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: [...catalogKey, orgId],
    enabled: !!orgId,
    retry: false,
    queryFn: async (): Promise<CatalogItem[]> => {
      const r = await db().from('document_catalog').select('*').eq('organization_id', orgId!).order('sort_order')
      if (r.error) return []
      return (r.data as CatalogRow[]).map((c) => ({ id: c.id, key: c.key, category: c.category, label: c.label, instructions: c.instructions, period: c.period, kind: c.kind, sortOrder: c.sort_order, active: c.active, builtIn: c.built_in }))
    },
  })
}

export function useSaveCatalogItem() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (c: Omit<CatalogItem, 'id' | 'builtIn' | 'key'> & { id: string | null }) => {
      if (!c.label.trim()) throw new Error('Give the item a name.')
      const row = { category: c.category, label: c.label.trim(), instructions: c.instructions.trim(), period: c.period?.trim() || null, kind: c.kind, sort_order: c.sortOrder, active: c.active }
      const key = `my_${c.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 36)}`
      const r = c.id ? await db().from('document_catalog').update(row).eq('id', c.id).select('id') : await db().from('document_catalog').insert({ ...row, organization_id: orgId, key }).select('id')
      if (r.error?.code === '23505') throw new Error('An item with that name already exists.')
      if (unwrap<{ id: string }[]>(r).length === 0) throw new Error('Only owners and admins can change the catalog.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKey }),
  })
}

export function useDeleteCatalogItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from('document_catalog').delete().eq('id', id).select('id'))
      if (!rows.length) throw new Error('Built-in items are turned off, not deleted. Only owners and admins can delete your own items.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKey }),
  })
}

export interface Preset {
  id: string
  name: string
  items: { key?: string; label?: string; instructions?: string }[]
  createdBy: string | null
}

export function usePresets() {
  return useQuery({
    queryKey: presetsKey,
    retry: false,
    queryFn: async (): Promise<Preset[]> => {
      const r = await db().from('document_request_presets').select('id, name, items, created_by').order('name')
      if (r.error) return []
      return (r.data as { id: string; name: string; items: Preset['items']; created_by: string | null }[]).map((p) => ({ id: p.id, name: p.name, items: p.items, createdBy: p.created_by }))
    },
  })
}

export function useSavePreset(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ name, items }: { name: string; items: PickedItem[] }) => {
      const r = await db()
        .from('document_request_presets')
        .insert({ organization_id: organizationId, name: name.trim(), items: items.map((i) => (i.key ? { key: i.key } : { label: i.label, instructions: i.instructions })) })
        .select('id')
      if (r.error?.code === '23505') throw new Error('A preset with that name already exists.')
      unwrap(r)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: presetsKey }),
  })
}

export function useDeletePreset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from('document_request_presets').delete().eq('id', id).select('id'))
      if (!rows.length) throw new Error('Only the person who saved it, or an owner or admin, can delete a preset.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: presetsKey }),
  })
}

export interface SendRequestInput {
  organizationId: string
  loanId: string
  borrower: ShareRecipient
  picked: PickedItem[]
  dueOn: string | null
  loName: string
  /** Which drafts to make. */
  text: boolean
  email: boolean
}

/**
 * Sends a request the safe way: makes the link (only its hash is saved),
 * adds or reuses the checklist rows on that link, and puts a draft text and
 * email with the link in the Action Queue. Nothing is sent from here.
 */
export async function sendDocumentRequest(v: SendRequestInput): Promise<{ url: string; plan: RequestPlan; drafts: number }> {
  const existing = unwrap<{ id: string; contact_id: string | null; rule_key: string; status: ItemStatus }[]>(await db().from('document_requests').select('id, contact_id, rule_key, status').eq('loan_id', v.loanId))
  const plan = planRequest(
    existing.map((e) => ({ id: e.id, contactId: e.contact_id, ruleKey: e.rule_key, status: e.status })),
    v.picked,
    v.borrower.contactId,
  )
  if (!plan.add.length && !plan.reuse.length) throw new Error(plan.skip.length ? 'Everything picked is already in. Nothing new to ask for.' : 'Pick at least one document.')

  const token = newToken()
  const link = unwrap<{ id: string }[]>(
    await db()
      .from('document_upload_links')
      .insert({ organization_id: v.organizationId, loan_id: v.loanId, contact_id: v.borrower.contactId, token_hash: await sha256Hex(token), due_on: v.dueOn })
      .select('id'),
  )[0]
  if (!link) throw new Error('The link could not be made.')
  const common = (i: PickedItem & { ruleKey: string }) => ({ instructions: i.instructions.trim() || null, catalog_key: i.key, condition_id: i.conditionId, link_id: link.id, due_on: v.dueOn })
  if (plan.add.length) {
    unwrap(
      await db()
        .from('document_requests')
        .insert(plan.add.map((i) => ({ organization_id: v.organizationId, loan_id: v.loanId, contact_id: v.borrower.contactId, rule_key: i.ruleKey, label: i.label.trim(), kind: i.kind, ...common(i) })))
        .select('id'),
    )
  }
  for (const r of plan.reuse) {
    unwrap(
      await db()
        .from('document_requests')
        .update({ ...common(r.item), label: r.item.label.trim(), status: 'requested', received_at: null, reviewed_at: null, reject_reason: null, rejected_at: null, requested_at: new Date().toISOString() })
        .eq('id', r.id)
        .select('id'),
    )
  }

  const url = uploadUrl(window.location.origin, token)
  const items = [...plan.add, ...plan.reuse.map((r) => r.item)].map((i) => ({ label: i.label.trim(), instructions: i.instructions.trim() }))
  const m = uploadMessages({ firstName: v.borrower.firstName, loName: v.loName, url, items, dueOn: v.dueOn })
  const drafts = [
    ...(v.text && v.borrower.phone && !v.borrower.smsOptedOutAt ? [{ channel: 'text', subject: null, body: m.text }] : []),
    ...(v.email && v.borrower.email && !v.borrower.emailOptedOutAt ? [{ channel: 'email', subject: m.subject, body: m.email }] : []),
  ]
  if (drafts.length) {
    unwrap(
      await db()
        .from('action_items')
        .insert(
          drafts.map((d) => ({
            organization_id: v.organizationId,
            loan_id: v.loanId,
            kind: 'draft_message',
            title: `Document request: ${v.borrower.name}`,
            payload: { channel: d.channel, to: d.channel === 'text' ? v.borrower.phone : v.borrower.email, subject: d.subject, body: d.body, contactId: v.borrower.contactId },
            sources: [],
            confidence: null,
            due_on: null,
            ai_run_id: null,
          })),
        )
        .select('id'),
    )
  }
  return { url, plan, drafts: drafts.length }
}

export function useSendDocumentRequest(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: sendDocumentRequest,
    onSettled: () => {
      for (const k of [keys.documentRequests(loanId), linksKey(loanId), keys.queue(loanId), keys.today]) queryClient.invalidateQueries({ queryKey: k })
    },
  })
}

export interface UploadLink {
  id: string
  contactId: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  dueOn: string | null
  firstOpenedAt: string | null
  lastOpenedAt: string | null
}

/** The file's upload links, newest first (empty before the script has run). */
export function useUploadLinks(loanId: string) {
  return useQuery({
    queryKey: linksKey(loanId),
    retry: false,
    queryFn: async (): Promise<UploadLink[]> => {
      const r = await db().from('document_upload_links').select('id, contact_id, created_at, expires_at, revoked_at, due_on, first_opened_at, last_opened_at').eq('loan_id', loanId).order('created_at', { ascending: false })
      if (r.error) return []
      return (r.data as Record<string, string | null>[]).map((l) => ({
        id: l.id!,
        contactId: l.contact_id!,
        createdAt: l.created_at!,
        expiresAt: l.expires_at!,
        revokedAt: l.revoked_at,
        dueOn: l.due_on,
        firstOpenedAt: l.first_opened_at,
        lastOpenedAt: l.last_opened_at,
      }))
    },
  })
}

export function useRevokeLink(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from('document_upload_links').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null).select('id'))
      if (!rows.length) throw new Error('This link could not be turned off.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linksKey(loanId) }),
  })
}

export interface ItemFile {
  id: string
  requestId: string
  fileName: string
  storagePath: string
  createdAt: string
}

/** Uploads made for the file's request items. */
export function useRequestFiles(loanId: string) {
  return useQuery({
    queryKey: itemFilesKey(loanId),
    retry: false,
    queryFn: async (): Promise<ItemFile[]> => {
      const r = await db().from('loan_documents').select('id, document_request_id, file_name, storage_path, created_at').eq('loan_id', loanId).not('document_request_id', 'is', null).order('created_at')
      if (r.error) return []
      return (r.data as { id: string; document_request_id: string; file_name: string; storage_path: string; created_at: string }[]).map((d) => ({ id: d.id, requestId: d.document_request_id, fileName: d.file_name, storagePath: d.storage_path, createdAt: d.created_at }))
    },
  })
}

/** A short-lived link to open an uploaded file. */
export async function openStoredFile(path: string) {
  const r = await db().storage.from('loan-files').createSignedUrl(path, 60)
  if (r.error || !r.data) throw new Error('The file could not be opened.')
  window.open(r.data.signedUrl, '_blank', 'noopener')
}

/** Accept an item, or reject it with a reason (it goes back on the borrower's page). */
export function useReviewItem(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, accept, reason }: { id: string; accept: boolean; reason?: string }) => {
      const now = new Date().toISOString()
      const changes = accept ? { status: 'reviewed', reviewed_at: now, reject_reason: null } : { status: 'rejected', rejected_at: now, reject_reason: reason?.trim() || 'Please upload this again.', reviewed_at: null }
      const rows = unwrap<{ id: string }[]>(await db().from('document_requests').update(changes).eq('id', id).select('id'))
      if (!rows.length) throw new Error('You do not have permission to change this item.')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.documentRequests(loanId) })
      queryClient.invalidateQueries({ queryKey: keys.conditions(loanId) })
    },
  })
}

/**
 * Overdue reminder drafts, made when Today opens (with the other reminder
 * drafts). The reminder points to the link already sent: only its hash is
 * saved, so it can't be repeated; "Send a new link" makes a fresh one.
 */
export async function makeUploadReminderDrafts(today: string): Promise<number> {
  const linksR = await db().from('document_upload_links').select('id, organization_id, loan_id, contact_id, due_on, expires_at, revoked_at, created_at').not('due_on', 'is', null).lt('due_on', today).is('revoked_at', null)
  if (linksR.error || !linksR.data?.length) return 0
  const links = linksR.data as { id: string; organization_id: string; loan_id: string; contact_id: string; due_on: string; expires_at: string; revoked_at: string | null; created_at: string }[]
  const items = unwrap<{ link_id: string | null; status: ItemStatus; label: string }[]>(await db().from('document_requests').select('link_id, status, label').in('link_id', links.map((l) => l.id)))
  const due = remindersDue(
    links.map((l) => ({ id: l.id, dueOn: l.due_on, expiresAt: l.expires_at, revokedAt: l.revoked_at })),
    items.map((i) => ({ linkId: i.link_id, status: i.status })),
    today,
  )
  if (!due.length) return 0
  const people = unwrap<{ id: string; first_name: string; last_name: string | null; phone: string | null; email: string | null; sms_opted_out_at: string | null; email_opted_out_at: string | null }[]>(
    await db().from('contacts').select('id, first_name, last_name, phone, email, sms_opted_out_at, email_opted_out_at').in('id', [...new Set(due.map((d) => links.find((l) => l.id === d.linkId)!.contact_id))]),
  )
  const rows = due.flatMap((d) => {
    const l = links.find((x) => x.id === d.linkId)!
    const p = people.find((x) => x.id === l.contact_id)
    if (!p) return []
    const waiting = items.filter((i) => i.link_id === l.id && (i.status === 'requested' || i.status === 'rejected')).map((i) => i.label)
    const sent = new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const text = `Hi ${p.first_name}, a quick reminder: I still need ${waiting.length === 1 ? waiting[0].toLowerCase() : `${waiting.length} documents`}. You can upload them with the link I sent on ${sent}. Photos or PDFs are fine. Thanks!`
    const channel = p.phone && !p.sms_opted_out_at ? 'text' : p.email && !p.email_opted_out_at ? 'email' : null
    if (!channel) return []
    return [
      {
        organization_id: l.organization_id,
        loan_id: l.loan_id,
        kind: 'draft_message',
        title: `Document reminder: ${[p.first_name, p.last_name].filter(Boolean).join(' ')}`,
        payload: { channel, to: channel === 'text' ? p.phone : p.email, subject: channel === 'email' ? 'Reminder: documents for your loan' : null, body: text, contactId: p.id },
        sources: [],
        confidence: null,
        due_on: today,
        ai_run_id: null,
        source_key: d.sourceKey,
      },
    ]
  })
  if (!rows.length) return 0
  return unwrap<{ id: string }[]>(await db().from('action_items').upsert(rows, { onConflict: 'organization_id,source_key', ignoreDuplicates: true }).select('id')).length
}
