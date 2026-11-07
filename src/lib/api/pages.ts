// Pages data (Connor, 2026-11-06; 20261228000000_pages.sql): the list, one
// page for the builder, saves, publishing, submissions and proposed updates.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, unwrap } from './client'
import { useAuth } from '@/lib/auth/context'
import { supabase } from '@/lib/supabase'
import type { PageType } from '@/lib/pages/templates'
import type { Block, DataRow, PageSettings, UploadedFile } from '../../../supabase/functions/page-submit/blocks'
import { finalBody, type Signer } from '../../../supabase/functions/assistant/followUp'

export type PageStatus = 'draft' | 'published' | 'archived' | 'template'

export interface PageRecord {
  id: string
  organizationId: string
  ownerId: string | null
  ownerName: string | null
  type: PageType
  title: string
  slug: string
  status: PageStatus
  blocks: Block[]
  settings: PageSettings
  property: Record<string, unknown> | null
  viewCount: number
  views30: number
  submissionCount: number
  submissions30: number
  newLeads30: number
  publishedAt: string | null
  updatedAt: string
}

export const pageKeys = {
  list: ['pages'] as const,
  page: (id: string) => ['pages', id] as const,
  submissions: (pageId: string) => ['pageSubmissions', pageId] as const,
  loanSubmissions: (loanId: string) => ['pageSubmissions', 'loan', loanId] as const,
}

/** A friendly message when the database script hasn't been run yet. */
const explain = (message: string) => (/page_submissions|pages|get_public_page|schema cache/.test(message) && /does not exist|schema cache|Could not find/.test(message) ? 'Run the pages script (20261228000000_pages.sql) in Supabase first.' : message)

interface PageRow {
  id: string
  organization_id: string
  owner_id: string | null
  type: PageType
  title: string
  slug: string
  status: PageStatus
  blocks: Block[]
  settings: PageSettings
  property: Record<string, unknown> | null
  view_count: number
  published_at: string | null
  updated_at: string
  owner: { full_name: string | null; email: string } | null
}

const PAGE_SELECT = 'id, organization_id, owner_id, type, title, slug, status, blocks, settings, property, view_count, published_at, updated_at, owner:profiles!pages_owner_id_fkey ( full_name, email )'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function toPage(r: PageRow, extra?: { views30: number; submissionCount: number; submissions30: number; newLeads30: number }): PageRecord {
  return {
    id: r.id,
    organizationId: r.organization_id,
    ownerId: r.owner_id,
    ownerName: r.owner?.full_name ?? r.owner?.email ?? null,
    type: r.type,
    title: r.title,
    slug: r.slug,
    status: r.status,
    blocks: Array.isArray(r.blocks) ? r.blocks : [],
    settings: r.settings ?? {},
    property: r.property,
    viewCount: r.view_count,
    views30: extra?.views30 ?? 0,
    submissionCount: extra?.submissionCount ?? 0,
    submissions30: extra?.submissions30 ?? 0,
    newLeads30: extra?.newLeads30 ?? 0,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
  }
}

/** Your pages (an admin sees all), newest first, with views and submissions; archived pages and your templates included (the list filters them). */
export function usePages() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: pageKeys.list,
    enabled: !!orgId,
    queryFn: async () => {
      const pages = await db().from('pages').select(PAGE_SELECT).order('updated_at', { ascending: false })
      if (pages.error) throw new Error(explain(pages.error.message))
      const rows = (pages.data ?? []) as unknown as PageRow[]
      if (!rows.length) return []
      const ids = rows.map((r) => r.id)
      const since = daysAgo(30)
      const [subs, views] = await Promise.all([
        db().from('page_submissions').select('page_id, outcome, created_at').in('page_id', ids),
        db().from('page_view_days').select('page_id, views').in('page_id', ids).gte('day', since.slice(0, 10)),
      ])
      const s = unwrap<{ page_id: string; outcome: string; created_at: string }[]>(subs)
      const v = unwrap<{ page_id: string; views: number }[]>(views)
      return rows.map((r) =>
        toPage(r, {
          views30: v.filter((x) => x.page_id === r.id).reduce((a, x) => a + x.views, 0),
          submissionCount: s.filter((x) => x.page_id === r.id).length,
          submissions30: s.filter((x) => x.page_id === r.id && x.created_at >= since).length,
          newLeads30: s.filter((x) => x.page_id === r.id && x.created_at >= since && (x.outcome === 'new_lead' || x.outcome === 'new_loan_existing_person')).length,
        }),
      )
    },
  })
}

export function usePage(id: string | undefined) {
  return useQuery({
    queryKey: pageKeys.page(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const r = await db().from('pages').select(PAGE_SELECT).eq('id', id!).maybeSingle()
      if (r.error) throw new Error(explain(r.error.message))
      return r.data ? toPage(r.data as unknown as PageRow) : null
    },
  })
}

/** A slug nobody has yet: "prequal", else "prequal-2", "prequal-3"… (other people's pages count too). */
export async function freeSlug(base: string): Promise<string> {
  const root = base || 'page'
  for (let i = 1; i < 50; i++) {
    const slug = i === 1 ? root : `${root.slice(0, 56)}-${i}`
    const taken = await db().rpc('get_public_page', { p_slug: slug, p_count_view: false })
    const mine = await db().from('pages').select('id').eq('slug', slug).maybeSingle()
    if (!taken.data && !mine.data) return slug
  }
  return `${root.slice(0, 50)}-${Math.random().toString(36).slice(2, 7)}`
}

export function useCreatePage() {
  const qc = useQueryClient()
  const { state } = useAuth()
  return useMutation({
    mutationFn: async (p: { type: PageType; title: string; slug: string; blocks: Block[]; settings: PageSettings; property?: Record<string, unknown> | null }) => {
      if (state.status !== 'signedIn' || !state.user.organizationId) throw new Error('Sign in first.')
      const r = await db()
        .from('pages')
        .insert({ organization_id: state.user.organizationId, owner_id: state.user.id, type: p.type, title: p.title, slug: p.slug, blocks: p.blocks, settings: p.settings, property: p.property ?? null })
        .select('id')
        .single()
      if (r.error) throw new Error(/pages_slug_key/.test(r.error.message) ? 'That web address is taken. Pick another.' : explain(r.error.message))
      return (r.data as { id: string }).id
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pageKeys.list }),
  })
}

export type PagePatch = Partial<{ title: string; slug: string; status: PageStatus; blocks: Block[]; settings: PageSettings; ownerId: string | null; type: PageType; property: Record<string, unknown> | null }>

export function useSavePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: PagePatch }) => {
      const row: Record<string, unknown> = {}
      if (patch.title !== undefined) row.title = patch.title
      if (patch.slug !== undefined) row.slug = patch.slug
      if (patch.status !== undefined) row.status = patch.status
      if (patch.blocks !== undefined) row.blocks = patch.blocks
      if (patch.settings !== undefined) row.settings = patch.settings
      if (patch.ownerId !== undefined) row.owner_id = patch.ownerId
      if (patch.type !== undefined) row.type = patch.type
      if (patch.property !== undefined) row.property = patch.property
      const r = await db().from('pages').update(row).eq('id', id).select('updated_at').single()
      if (r.error) throw new Error(/pages_slug_key/.test(r.error.message) ? 'That web address is taken. Pick another.' : explain(r.error.message))
      return (r.data as { updated_at: string }).updated_at
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: pageKeys.list })
      if (v.patch.status !== undefined || v.patch.ownerId !== undefined) qc.invalidateQueries({ queryKey: pageKeys.page(v.id) })
    },
  })
}

export function useDeletePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await db().from('pages').delete().eq('id', id)
      if (r.error) throw new Error(/foreign key|page_submissions/.test(r.error.message) ? 'This page has submissions, so it is kept. Unpublish it instead.' : r.error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pageKeys.list }),
  })
}

// ---------------------------------------------------------------------------
// Images (public page-assets bucket) and the owner's headshot
// ---------------------------------------------------------------------------

export const PAGE_ASSETS = 'page-assets'
export const publicAssetUrl = (path: string) => supabase?.storage.from(PAGE_ASSETS).getPublicUrl(path).data.publicUrl ?? ''

export async function uploadPageImage(organizationId: string, pageId: string, file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG or WebP image.')
  if (file.size > 5 * 1024 * 1024) throw new Error('Images can be up to 5 MB.')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${organizationId}/pages/${pageId}/${crypto.randomUUID().slice(0, 8)}.${ext}`
  const r = await db().storage.from(PAGE_ASSETS).upload(path, file, { contentType: file.type })
  if (r.error) throw new Error(explain(r.error.message))
  return publicAssetUrl(path)
}

/**
 * Copies the owner's Settings photo (private brand-files) to the public
 * headshot the page's LO card shows. Quietly does nothing without a photo.
 */
export async function publishHeadshot(organizationId: string, userId: string): Promise<boolean> {
  const prof = await db().from('profiles').select('photo_path').eq('id', userId).maybeSingle()
  const photoPath = (prof.data as { photo_path: string | null } | null)?.photo_path
  if (prof.error || !photoPath) return false
  const file = await db().storage.from('brand-files').download(photoPath)
  if (file.error || !file.data) return false
  const ext = file.data.type === 'image/png' ? 'png' : 'jpg'
  const other = ext === 'png' ? 'jpg' : 'png'
  await db().storage.from(PAGE_ASSETS).remove([`${organizationId}/headshots/${userId}.${other}`])
  const up = await db().storage.from(PAGE_ASSETS).upload(`${organizationId}/headshots/${userId}.${ext}`, file.data, { contentType: file.data.type || 'image/jpeg', upsert: true })
  return !up.error
}

// ---------------------------------------------------------------------------
// The public page and its submit function
// ---------------------------------------------------------------------------

export interface PublicPage {
  id: string
  type: PageType
  title: string
  slug: string
  blocks: Block[]
  settings: PageSettings
  property: Record<string, unknown> | null
  owner: { name: string | null; nmls: string | null; phone: string | null; email: string | null; bookingUrl: string | null; photoPath: string | null } | null
  /** Open houses: the listing agent from Partners. */
  agent?: { name: string; company: string | null; phone: string | null; email: string | null } | null
  company: { name: string; nmls: string } | null
}

export async function fetchPublicPage(slug: string, countView: boolean): Promise<PublicPage | null> {
  const r = await db().rpc('get_public_page', { p_slug: slug, p_count_view: countView })
  if (r.error) throw new Error(r.error.message)
  return (r.data as PublicPage | null) ?? null
}

async function callPageSubmit(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await db().functions.invoke('page-submit', { body })
  if (error) {
    // The function's own message (400/404/429) is in the response body.
    const ctx = (error as { context?: Response }).context
    const detail = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    const e = new Error((detail as { error?: string } | null)?.error ?? 'Could not send. Check your connection and try again.') as Error & { fields?: Record<string, string> }
    e.fields = (detail as { errors?: Record<string, string> } | null)?.errors
    throw e
  }
  return data as Record<string, unknown>
}

export async function uploadVisitorFile(slug: string, submissionId: string, blockId: string, file: File): Promise<UploadedFile> {
  const link = await callPageSubmit({ action: 'upload', slug, submissionId, blockId, fileName: file.name, size: file.size, type: file.type })
  const up = await db().storage.from('page-uploads').uploadToSignedUrl(String(link.path), String(link.token), file, { contentType: file.type })
  if (up.error) throw new Error('The file could not be uploaded. Try again.')
  return { path: String(link.path), name: file.name, size: file.size, type: file.type }
}

export async function submitPage(body: { slug: string; submissionId: string; answers: Record<string, unknown>; files: Record<string, UploadedFile[]>; consent: boolean; source: Record<string, string>; website: string; t?: string | null }) {
  return (await callPageSubmit({ action: 'submit', ...body })) as { ok: boolean; successTitle: string | null; successMessage: string | null; redirectUrl: string | null }
}

// ---------------------------------------------------------------------------
// Submissions and proposed updates
// ---------------------------------------------------------------------------

export interface ProposedUpdate {
  key: string
  label: string
  value: string
  current: string | null
  status: 'pending' | 'accepted' | 'rejected'
}

export interface PageSubmission {
  id: string
  pageId: string
  pageTitle: string
  data: DataRow[]
  files: (UploadedFile & { blockId: string })[]
  contactId: string | null
  loanId: string | null
  partnerId: string | null
  personName: string | null
  outcome: string
  source: Record<string, string>
  tags: string[]
  proposed: ProposedUpdate[]
  ghlResult: string | null
  createdAt: string
}

interface SubmissionRow {
  id: string
  page_id: string
  data: DataRow[]
  files: (UploadedFile & { blockId: string })[]
  contact_id: string | null
  loan_id: string | null
  partner_id: string | null
  outcome: string
  source: Record<string, string>
  tags: string[]
  proposed: ProposedUpdate[]
  ghl_result: string | null
  created_at: string
  page: { title: string } | null
  contact: { first_name: string; last_name: string } | null
  partner: { name: string } | null
}

const SUB_SELECT =
  'id, page_id, data, files, contact_id, loan_id, partner_id, outcome, source, tags, proposed, ghl_result, created_at, page:pages!page_submissions_page_id_fkey ( title ), contact:contacts!page_submissions_contact_id_fkey ( first_name, last_name ), partner:partners!page_submissions_partner_id_fkey ( name )'

const toSubmission = (r: SubmissionRow): PageSubmission => ({
  id: r.id,
  pageId: r.page_id,
  pageTitle: r.page?.title ?? 'Page',
  data: r.data ?? [],
  files: r.files ?? [],
  contactId: r.contact_id,
  loanId: r.loan_id,
  partnerId: r.partner_id,
  personName: r.contact ? `${r.contact.first_name} ${r.contact.last_name}`.trim() : (r.partner?.name ?? null),
  outcome: r.outcome,
  source: r.source ?? {},
  tags: r.tags ?? [],
  proposed: r.proposed ?? [],
  ghlResult: r.ghl_result,
  createdAt: r.created_at,
})

export function usePageSubmissions(pageId: string | undefined) {
  return useQuery({
    queryKey: pageKeys.submissions(pageId ?? ''),
    enabled: !!pageId,
    queryFn: async () => {
      const r = await db().from('page_submissions').select(SUB_SELECT).eq('page_id', pageId!).order('created_at', { ascending: false })
      if (r.error) throw new Error(explain(r.error.message))
      return ((r.data ?? []) as unknown as SubmissionRow[]).map(toSubmission)
    },
  })
}

/** Page submissions on a file (for "Proposed updates from [page]"). Empty when the script hasn't run. */
export function useLoanPageSubmissions(loanId: string | undefined) {
  return useQuery({
    queryKey: pageKeys.loanSubmissions(loanId ?? ''),
    enabled: !!loanId,
    queryFn: async () => {
      const r = await db().from('page_submissions').select(SUB_SELECT).eq('loan_id', loanId!).order('created_at', { ascending: false })
      if (r.error) return []
      return ((r.data ?? []) as unknown as SubmissionRow[]).map(toSubmission)
    },
  })
}

export function useDecidePageUpdate(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ submissionId, key, accept }: { submissionId: string; key: string; accept: boolean }) => {
      const r = await db().rpc('decide_page_update', { p_submission: submissionId, p_key: key, p_accept: accept })
      if (r.error) throw new Error(r.error.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pageKeys.loanSubmissions(loanId) })
      // The file's numbers and notes may have changed.
      qc.invalidateQueries({ queryKey: ['loan', loanId] })
      qc.invalidateQueries({ queryKey: ['loanFile', loanId] })
      qc.invalidateQueries({ queryKey: ['notes'] })
    },
  })
}

/** A short-lived link to open a visitor's file. */
export async function uploadUrl(path: string): Promise<string> {
  const r = await db().storage.from('page-uploads').createSignedUrl(path, 300)
  if (r.error) throw new Error(r.error.message)
  return r.data.signedUrl
}

export const OUTCOME_LABEL: Record<string, string> = {
  new_lead: 'New lead',
  new_loan_existing_person: 'Past client · new file',
  existing_open_loan: 'Added to open file',
  personal_link: 'Personal link',
  form_update: 'Added to open file',
  partner_inquiry: 'Partner',
}

// ---------------------------------------------------------------------------
// After the open house: "thanks for coming" drafts (Action Queue only)
// ---------------------------------------------------------------------------

/**
 * One draft per sign-in that went to a file: a text when they gave a phone
 * (and haven't opted out), else an email. Pressing it again adds only new
 * sign-ins (each has its own source key). Nothing is sent.
 */
export function useDraftOpenHouseThanks(pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ subs, address, signer }: { subs: PageSubmission[]; address: string; signer: Signer }) => {
      const { thanksEmail, thanksFacts, thanksKey, thanksText } = await import('@/lib/pages/openHouseFollowUp')
      const onFile = subs.filter((s) => s.contactId && s.loanId)
      if (!onFile.length) return { drafted: 0, skipped: subs.length }
      const people = unwrap<{ id: string; organization_id: string; first_name: string; email: string | null; phone: string | null; sms_opted_out_at: string | null; email_opted_out_at: string | null }[]>(
        await db().from('contacts').select('id, organization_id, first_name, email, phone, sms_opted_out_at, email_opted_out_at').in('id', [...new Set(onFile.map((s) => s.contactId!))]),
      )
      const loFirst = signer.loName ? signer.loName.split(/\s+/)[0] : null
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
      const rows = onFile.flatMap((s) => {
        const p = people.find((x) => x.id === s.contactId)
        if (!p) return []
        const f = thanksFacts(s.data, p.first_name, address, loFirst, signer.companyName.replace(/ LLC$/, ''))
        const text = p.phone && !p.sms_opted_out_at
        const email = !text && p.email && !p.email_opted_out_at
        if (!text && !email) return []
        const e = thanksEmail(f)
        const payload = text
          ? { channel: 'text', to: p.phone, subject: null, body: thanksText(f), contactId: p.id, pageId, submissionId: s.id }
          : { channel: 'email', to: p.email, subject: e.subject, body: finalBody('email', e.body, signer), contactId: p.id, pageId, submissionId: s.id }
        return [{ organization_id: p.organization_id, loan_id: s.loanId, kind: 'draft_message', title: `Thank ${p.first_name} for visiting ${address}`, payload, sources: [], confidence: null, due_on: today, ai_run_id: null, source_key: thanksKey(s.id) }]
      })
      if (!rows.length) return { drafted: 0, skipped: subs.length }
      const saved = unwrap<{ id: string }[]>(await db().from('action_items').upsert(rows, { onConflict: 'organization_id,source_key', ignoreDuplicates: true }).select('id'))
      return { drafted: saved.length, skipped: subs.length - saved.length }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today'] })
      qc.invalidateQueries({ queryKey: ['queue'] })
    },
  })
}
