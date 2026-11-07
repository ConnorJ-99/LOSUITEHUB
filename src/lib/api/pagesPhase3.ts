// Pages Phase 3 data (Connor, 2026-11-07; 20261230000000_pages_phase3.sql):
// views by day for analytics, personal links from a file, and duplicate /
// archive / save as my template.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, unwrap } from './client'
import { freeSlug, pageKeys, type PageRecord } from './pages'
import { useAuth } from '@/lib/auth/context'
import { blankProperty, readProperty } from '@/lib/pages/openHouse'
import { newBlockId } from '@/lib/pages/templates'
import { finalBody, type Signer } from '../../../supabase/functions/assistant/followUp'
import { slugify } from '../../../supabase/functions/page-submit/blocks'

const explain = (m: string) => (/page_links|schema cache|template/.test(m) && /does not exist|schema cache|Could not find|check constraint/.test(m) ? 'Run the pages Phase 3 script (20261230000000_pages_phase3.sql) in Supabase first.' : m)

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export function usePageViewDays(pageId: string | undefined) {
  return useQuery({
    queryKey: ['pageViewDays', pageId ?? ''],
    enabled: !!pageId,
    queryFn: async () => {
      const since = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10)
      return unwrap<{ day: string; views: number }[]>(await db().from('page_view_days').select('day, views').eq('page_id', pageId!).gte('day', since))
    },
  })
}

// ---------------------------------------------------------------------------
// Personal links
// ---------------------------------------------------------------------------

export interface PageLink {
  id: string
  pageId: string
  pageTitle: string
  pageSlug: string
  contactId: string
  url: string
  createdAt: string
  expiresAt: string
  lastOpenedAt: string | null
  submittedAt: string | null
  revokedAt: string | null
}

export type PageLinkState = 'submitted' | 'opened' | 'sent' | 'off' | 'expired'

export function linkState(l: Pick<PageLink, 'submittedAt' | 'lastOpenedAt' | 'revokedAt' | 'expiresAt'>, now = new Date()): PageLinkState {
  if (l.revokedAt) return 'off'
  if (l.submittedAt) return 'submitted'
  if (Date.parse(l.expiresAt) <= now.getTime()) return 'expired'
  return l.lastOpenedAt ? 'opened' : 'sent'
}

export const linkUrl = (slug: string, token: string) => `${window.location.origin}/p/${slug}?t=${token}`

const linkKeys = (loanId: string) => ['pageLinks', loanId] as const

/** Links sent from this file, newest first. Empty when the Phase 3 script hasn't run. */
export function usePageLinks(loanId: string) {
  return useQuery({
    queryKey: linkKeys(loanId),
    queryFn: async () => {
      const r = await db()
        .from('page_links')
        .select('id, page_id, contact_id, token, created_at, expires_at, last_opened_at, submitted_at, revoked_at, page:pages!page_links_page_id_fkey ( title, slug )')
        .eq('loan_id', loanId)
        .order('created_at', { ascending: false })
      if (r.error) return []
      return (r.data as unknown as { id: string; page_id: string; contact_id: string; token: string; created_at: string; expires_at: string; last_opened_at: string | null; submitted_at: string | null; revoked_at: string | null; page: { title: string; slug: string } | null }[]).map(
        (x): PageLink => ({
          id: x.id,
          pageId: x.page_id,
          pageTitle: x.page?.title ?? 'Page',
          pageSlug: x.page?.slug ?? '',
          contactId: x.contact_id,
          url: x.page ? linkUrl(x.page.slug, x.token) : '',
          createdAt: x.created_at,
          expiresAt: x.expires_at,
          lastOpenedAt: x.last_opened_at,
          submittedAt: x.submitted_at,
          revokedAt: x.revoked_at,
        }),
      )
    },
  })
}

export function useCreatePageLink(loanId: string) {
  const qc = useQueryClient()
  const { state } = useAuth()
  return useMutation({
    mutationFn: async (p: { organizationId: string; page: PageRecord; contactId: string }) => {
      if (state.status !== 'signedIn') throw new Error('Sign in first.')
      const r = await db()
        .from('page_links')
        .insert({ organization_id: p.organizationId, page_id: p.page.id, contact_id: p.contactId, loan_id: loanId, created_by: state.user.id })
        .select('id, token')
        .single()
      if (r.error) throw new Error(explain(r.error.message))
      const row = r.data as { id: string; token: string }
      return { id: row.id, url: linkUrl(p.page.slug, row.token) }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: linkKeys(loanId) }),
  })
}

export function useRevokePageLink(loanId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await db().from('page_links').update({ revoked_at: new Date().toISOString() }).eq('id', id).select('id'))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: linkKeys(loanId) }),
  })
}

/** What a personal link fills in, or null when it's expired or switched off. */
export async function fetchPageLink(slug: string, token: string): Promise<{ values: Record<string, string>; submitted: boolean } | null> {
  const r = await db().rpc('get_page_link', { p_slug: slug, p_token: token })
  if (r.error) return null
  return (r.data as { values: Record<string, string>; submitted: boolean } | null) ?? null
}

/**
 * An email with the link, drafted into the file's Action Queue (emails only:
 * texts never carry a link). Sends only through Send on Today, like every draft.
 */
export async function draftLinkEmail(p: { organizationId: string; loanId: string; contactId: string; email: string; firstName: string; pageTitle: string; url: string; linkId: string; signer: Signer }) {
  const body = [
    `Hi ${p.firstName || 'there'},`,
    '',
    `Here's a short form for your file: ${p.pageTitle}. It already has what I have on file, so you only need to check it and fill in the rest.`,
    '',
    p.url,
    '',
    'The link is just for you and works for 30 days.',
    '',
    'Thank you,',
  ].join('\n')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  unwrap(
    await db()
      .from('action_items')
      .upsert(
        [
          {
            organization_id: p.organizationId,
            loan_id: p.loanId,
            kind: 'draft_message',
            title: `Email ${p.firstName || 'the borrower'} the ${p.pageTitle} form`,
            payload: { channel: 'email', to: p.email, subject: `${p.pageTitle}: a quick form for your file`, body: finalBody('email', body, p.signer), contactId: p.contactId },
            sources: [],
            confidence: null,
            due_on: today,
            ai_run_id: null,
            source_key: `page-link:${p.linkId}`,
          },
        ],
        { onConflict: 'organization_id,source_key', ignoreDuplicates: true },
      )
      .select('id'),
  )
}

// ---------------------------------------------------------------------------
// Duplicate, archive, save as my template
// ---------------------------------------------------------------------------

/** An open house template keeps the rates, times and programs, not the home. */
function templateProperty(raw: Record<string, unknown> | null): Record<string, unknown> {
  const p = readProperty(raw)
  return { ...blankProperty(), startTime: p.startTime, endTime: p.endTime, financing: p.financing.map((o) => ({ ...o, figures: null })), ratesAsOf: p.ratesAsOf } as unknown as Record<string, unknown>
}

/** A copy of a page as a new Draft, or as your own template. Block ids are new; views and submissions start at zero. */
export function useCopyPage() {
  const qc = useQueryClient()
  const { state } = useAuth()
  return useMutation({
    mutationFn: async ({ page, as }: { page: PageRecord; as: 'draft' | 'template' }) => {
      if (state.status !== 'signedIn' || !state.user.organizationId) throw new Error('Sign in first.')
      const title = as === 'template' ? page.title.replace(/ \(copy\)$/, '') : page.status === 'template' ? page.title : `${page.title} (copy)`
      // A template gets a private placeholder address; a copy gets one from its title (or the original's).
      const base = as === 'template' ? `template-${Math.random().toString(36).slice(2, 10)}` : (page.status === 'template' ? slugify(page.title) : page.slug).slice(0, 50) || 'page'
      const r = await db()
        .from('pages')
        .insert({
          organization_id: state.user.organizationId,
          owner_id: state.user.id,
          type: page.type,
          title,
          slug: as === 'template' ? base : await freeSlug(base),
          status: as,
          blocks: page.blocks.map((b) => ({ ...b, id: newBlockId() })),
          settings: page.settings,
          // A template keeps the home's layout but not its listing; a duplicate keeps everything.
          property: as === 'template' && page.type === 'open_house' ? templateProperty(page.property) : page.property,
        })
        .select('id')
        .single()
      if (r.error) throw new Error(explain(r.error.message))
      return (r.data as { id: string }).id
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pageKeys.list }),
  })
}

export function useSetPageStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'draft' | 'archived' }) => {
      const r = await db().from('pages').update({ status }).eq('id', id).select('id')
      if (r.error) throw new Error(explain(r.error.message))
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: pageKeys.list })
      qc.invalidateQueries({ queryKey: pageKeys.page(v.id) })
    },
  })
}
