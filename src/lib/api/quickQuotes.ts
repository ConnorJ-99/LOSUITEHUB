import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import type { QuoteOption, QuoteScenario } from '@/lib/quickquote/quote'
import { BRAND_BUCKET, brandFileProblem } from './brandFiles'
import { db, unwrap } from './client'
import { saveLoanDetails } from './loans'
import type { LoanDetails } from './types'

// Quick quotes (20261211000000_quick_quotes.sql): loan options put in front of
// a borrower before a full pre-qual. The scenario and options are saved as
// typed; the figures are worked out again in code each time.

export interface QuickQuote {
  id: string
  loUserId: string | null
  contactId: string | null
  loanId: string | null
  scenario: QuoteScenario
  options: QuoteOption[]
  note: string
  validThrough: string
  documentId: string | null
  sentAt: string | null
  createdAt: string
  updatedAt: string
}

interface QuoteRow {
  id: string
  lo_user_id: string | null
  contact_id: string | null
  loan_id: string | null
  scenario: QuoteScenario
  options: QuoteOption[]
  note: string | null
  valid_through: string
  document_id: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

const SELECT = 'id, lo_user_id, contact_id, loan_id, scenario, options, note, valid_through, document_id, sent_at, created_at, updated_at'

const toQuote = (r: QuoteRow): QuickQuote => ({
  id: r.id,
  loUserId: r.lo_user_id,
  contactId: r.contact_id,
  loanId: r.loan_id,
  scenario: r.scenario,
  options: r.options,
  note: r.note ?? '',
  validThrough: r.valid_through,
  documentId: r.document_id,
  sentAt: r.sent_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export const quoteKeys = {
  all: ['quickQuotes'] as const,
  recent: (userId: string) => ['quickQuotes', 'recent', userId] as const,
  one: (id: string) => ['quickQuotes', 'one', id] as const,
  loExtras: (userId: string) => ['quickQuotes', 'loExtras', userId] as const,
}

const missingScript = (message: string) =>
  /quick_quotes|photo_path|booking_url|schema cache/.test(message) ? 'Run the quick quotes script (20261211000000_quick_quotes.sql) in Supabase first.' : message

/** Your latest quotes, newest first. */
export function useRecentQuotes() {
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : ''
  return useQuery({
    queryKey: quoteKeys.recent(me),
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await db().from('quick_quotes').select(SELECT).eq('lo_user_id', me).order('updated_at', { ascending: false }).limit(12)
      if (error) throw new Error(missingScript(error.message))
      return (data as QuoteRow[]).map(toQuote)
    },
  })
}

export function useQuickQuote(id: string | null) {
  return useQuery({
    queryKey: quoteKeys.one(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db().from('quick_quotes').select(SELECT).eq('id', id!).maybeSingle()
      if (error) throw new Error(missingScript(error.message))
      return data ? toQuote(data as QuoteRow) : null
    },
  })
}

export interface QuoteSave {
  id: string | null
  contactId: string | null
  loanId: string | null
  scenario: QuoteScenario
  options: QuoteOption[]
  note: string
  validThrough: string
  documentId?: string | null
  sentAt?: string | null
}

/** Adds the quote, or saves changes to it. Returns its id. */
export function useSaveQuote() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (q: QuoteSave): Promise<string> => {
      if (!orgId) throw new Error('Your login is not part of an organization yet.')
      const row = {
        contact_id: q.contactId,
        loan_id: q.loanId,
        scenario: q.scenario,
        options: q.options,
        note: q.note.trim() || null,
        valid_through: q.validThrough,
        ...(q.documentId !== undefined && { document_id: q.documentId }),
        ...(q.sentAt !== undefined && { sent_at: q.sentAt }),
      }
      const saved = q.id
        ? await db().from('quick_quotes').update(row).eq('id', q.id).select('id')
        : await db().from('quick_quotes').insert({ ...row, organization_id: orgId }).select('id')
      if (saved.error) throw new Error(missingScript(saved.error.message))
      const rows = saved.data as { id: string }[]
      if (!rows.length) throw new Error('You can only change your own quotes, or quotes on files you can see.')
      return rows[0].id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: quoteKeys.all })
      queryClient.invalidateQueries({ queryKey: quoteKeys.one(id) })
    },
  })
}

export function useDeleteQuote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from('quick_quotes').delete().eq('id', id).select('id'))
      if (!rows.length) throw new Error('Only the loan officer who made a quote (or an admin) can delete it.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quoteKeys.all }),
  })
}

/** The person on a new lead (create_lead returns only the loan). */
export async function primaryContactOf(loanId: string): Promise<string> {
  const rows = unwrap<{ contact_id: string }[]>(await db().from('loan_borrowers').select('contact_id').eq('loan_id', loanId).order('created_at').limit(1))
  if (!rows.length) throw new Error('The new lead has no borrower.')
  return rows[0].contact_id
}

/** Writes the quote's deal into the file, and the credit range as the borrower's estimated score. */
export async function saveQuoteToLoan(loanId: string, contactId: string, facts: Partial<LoanDetails>, creditScore: number | null): Promise<void> {
  await saveLoanDetails(loanId, facts)
  if (creditScore != null) {
    unwrap(await db().from('loan_borrowers').update({ estimated_credit_score: creditScore }).eq('loan_id', loanId).eq('contact_id', contactId).select('contact_id'))
  }
}

/** A borrower's estimated credit score on a file (for a quote started there). */
export function useEstimatedScore(loanId: string | null, contactId: string | null) {
  return useQuery({
    queryKey: ['quickQuotes', 'score', loanId ?? '', contactId ?? ''],
    enabled: !!loanId && !!contactId,
    queryFn: async () => {
      const rows = unwrap<{ estimated_credit_score: number | null }[]>(await db().from('loan_borrowers').select('estimated_credit_score').eq('loan_id', loanId!).eq('contact_id', contactId!).limit(1))
      return rows[0]?.estimated_credit_score ?? null
    },
  })
}

// ---------------------------------------------------------------------------
// The loan officer's photo and booking link (Settings → My profile), for the
// quote's loan officer block and QR code. Kept apart from useProfile so other
// screens keep working before the script is run.
// ---------------------------------------------------------------------------

export interface LoExtras {
  photoPath: string | null
  bookingUrl: string | null
}

export function useLoExtras(userId: string | null | undefined) {
  return useQuery({
    queryKey: quoteKeys.loExtras(userId ?? ''),
    enabled: !!userId,
    // A missing column won't fix itself; fail at once so the PDF is made without the photo and link.
    retry: false,
    queryFn: async (): Promise<LoExtras> => {
      const { data, error } = await db().from('profiles').select('photo_path, booking_url').eq('id', userId!).maybeSingle()
      if (error) throw new Error(missingScript(error.message))
      const r = data as { photo_path: string | null; booking_url: string | null } | null
      return { photoPath: r?.photo_path ?? null, bookingUrl: r?.booking_url ?? null }
    },
  })
}

export function useSaveBookingUrl(userId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (url: string | null) => {
      const { data, error } = await db().from('profiles').update({ booking_url: url }).eq('id', userId).select('id')
      if (error) throw new Error(missingScript(error.message))
      if (!data?.length) throw new Error('You can only change your own profile.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quoteKeys.loExtras(userId) }),
  })
}

/** Uploads a new photo into your own folder of brand-files, points your profile at it, then removes the old one. */
export function useUploadPhoto(organizationId: string, userId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, current }: { file: File; current: string | null }) => {
      const problem = brandFileProblem(file)
      if (problem) throw new Error(problem)
      const ext = /\.jpe?g$/i.test(file.name) || file.type === 'image/jpeg' ? 'jpg' : 'png'
      const path = `${organizationId}/signatures/${userId}/photo-${crypto.randomUUID()}.${ext}`
      const up = await db().storage.from(BRAND_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
      if (up.error) throw new Error(`Upload failed: ${up.error.message}`)
      const saved = await db().from('profiles').update({ photo_path: path }).eq('id', userId).select('id')
      if (saved.error || !saved.data?.length) {
        await db().storage.from(BRAND_BUCKET).remove([path])
        throw new Error(missingScript(saved.error?.message ?? 'You can only change your own photo.'))
      }
      if (current) await db().storage.from(BRAND_BUCKET).remove([current])
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quoteKeys.loExtras(userId) }),
  })
}

export function useRemovePhoto(userId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (current: string | null) => {
      if (!current) return
      const { error } = await db().from('profiles').update({ photo_path: null }).eq('id', userId).select('id')
      if (error) throw new Error(missingScript(error.message))
      await db().storage.from(BRAND_BUCKET).remove([current])
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quoteKeys.loExtras(userId) }),
  })
}
