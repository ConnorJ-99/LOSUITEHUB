// The final Closing Disclosure (Connor, 2026-11-19): upload it, have the
// assistant read it, review the figures, apply them (apply_closing_disclosure)
// and undo them (undo_closing_disclosure). Nothing on the file changes until
// Apply.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CD_FIELDS, type CdField, type CdTarget } from '../../../supabase/functions/assistant/closingDisclosure'
import { invokeAssistant } from './assistant'
import { db, keys, unwrap } from './client'
import { downloadDocument, LOAN_FILES_BUCKET, storagePathFor, uploadProblem } from './documents'
import { fetchLoanNumbers, loanNumbersKey } from './loanNumbers'
import type { CdChange } from '@/lib/closing/cdReview'

export const cdReadingKey = (loanId: string) => ['cd-reading', loanId] as const
const cdFileKey = (loanId: string) => ['cd-file', loanId] as const

export interface CdAppliedItem {
  key: string
  label: string
  target: CdTarget
  before: unknown
  after: unknown
}

export interface CdReadingRecord {
  id: string
  status: 'pending_review' | 'applied' | 'discarded'
  documentId: string | null
  fields: CdField[]
  notes: string | null
  unreadable: { key: string; text: string }[]
  applied: CdAppliedItem[]
  createdAt: string
  decidedAt: string | null
  undoneAt: string | null
}

interface ReadingRow {
  id: string
  status: CdReadingRecord['status']
  document_id: string | null
  reading: unknown
  applied: unknown
  created_at: string
  decided_at: string | null
  undone_at: string | null
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const KEYS = new Set<string>(CD_FIELDS.map((f) => f.key))

/** Keeps only well-formed saved figures. */
export function readCdRecord(r: ReadingRow): CdReadingRecord {
  const reading = isObject(r.reading) ? r.reading : {}
  const fields = (Array.isArray(reading.fields) ? reading.fields : []).filter(
    (f): f is CdField => isObject(f) && KEYS.has(String(f.key)) && ['number', 'string'].includes(typeof f.value) && ['high', 'medium', 'low'].includes(String(f.confidence)),
  )
  const unreadable = (Array.isArray(reading.unreadable) ? reading.unreadable : []).filter((u): u is { key: string; text: string } => isObject(u) && typeof u.key === 'string' && typeof u.text === 'string')
  const applied = (Array.isArray(r.applied) ? r.applied : []).filter((a): a is CdAppliedItem => isObject(a) && typeof a.target === 'string' && typeof a.label === 'string')
  return {
    id: r.id,
    status: r.status,
    documentId: r.document_id,
    fields,
    notes: typeof reading.notes === 'string' ? reading.notes : null,
    unreadable,
    applied,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    undoneAt: r.undone_at,
  }
}

/** The file's newest Closing Disclosure reading, if any. */
export function useCdReading(loanId: string) {
  return useQuery({
    queryKey: cdReadingKey(loanId),
    queryFn: async () => {
      const rows = unwrap<ReadingRow[]>(
        await db().from('closing_disclosure_readings').select('id, status, document_id, reading, applied, created_at, decided_at, undone_at').eq('loan_id', loanId).order('created_at', { ascending: false }).limit(1),
      )
      return rows[0] ? readCdRecord(rows[0]) : null
    },
  })
}

export interface CdFileValues {
  values: Partial<Record<CdTarget, number | string | null>>
  hasHome: boolean
  lenderId: string | null
  programLenderId: string | null
  lenderNameTyped: string | null
}

const num = (v: unknown) => (v == null || v === '' ? null : Number(v))

/** What the file has now in every place a CD figure can fill. */
export function useCdFileValues(loanId: string) {
  return useQuery({
    queryKey: cdFileKey(loanId),
    queryFn: async (): Promise<CdFileValues> => {
      const l = unwrap<Record<string, unknown> | null>(
        await db()
          .from('loans')
          .select('loan_amount, note_rate, term_months, closing_date, funding_date, first_payment_date, monthly_payment, lender_credits, seller_credits, discount_points_amount, prepaid_items_amount, lender_loan_number, lender_id, subject_property_id')
          .eq('id', loanId)
          .maybeSingle(),
      )
      if (!l) throw new Error('Loan not found.')
      const homeId = l.subject_property_id as string | null
      const home = homeId ? unwrap<{ annual_taxes: unknown; annual_insurance: unknown } | null>(await db().from('properties').select('annual_taxes, annual_insurance').eq('id', homeId).maybeSingle()) : null
      const numbers = await fetchLoanNumbers(loanId)
      const values: CdFileValues['values'] = {
        'loans.loan_amount': num(l.loan_amount),
        'loans.note_rate': num(l.note_rate),
        'loans.term_months': num(l.term_months),
        'loans.closing_date': (l.closing_date as string | null) ?? null,
        'loans.funding_date': (l.funding_date as string | null) ?? null,
        'loans.first_payment_date': (l.first_payment_date as string | null) ?? null,
        'loans.monthly_payment': num(l.monthly_payment),
        'loans.lender_credits': num(l.lender_credits),
        'loans.seller_credits': num(l.seller_credits),
        'loans.discount_points_amount': num(l.discount_points_amount),
        'loans.prepaid_items_amount': num(l.prepaid_items_amount),
        'loans.lender_loan_number': (l.lender_loan_number as string | null) ?? null,
        'loans.lender_id': (l.lender_id as string | null) ?? null,
        'properties.annual_taxes': home ? num(home.annual_taxes) : null,
        'properties.annual_insurance': home ? num(home.annual_insurance) : null,
      }
      return { values, hasHome: !!home, lenderId: numbers.lenderId, programLenderId: numbers.programLenderId, lenderNameTyped: numbers.lenderNameTyped }
    },
  })
}

/** The PDF's own text, page by page, to check the quotes (a scan or a photo has none). */
export function useCdPdfText(doc: { id: string; storagePath: string; contentType: string | null } | null) {
  return useQuery({
    queryKey: ['cd-pdf-text', doc?.id],
    enabled: !!doc,
    staleTime: Infinity,
    queryFn: async () => {
      if (!doc || doc.contentType !== 'application/pdf') return null
      const { pdfPages } = await import('@/lib/documents/pdfText')
      return pdfPages(await (await downloadDocument(doc)).arrayBuffer())
    },
  })
}

function useRefresh(loanId: string) {
  const queryClient = useQueryClient()
  return () => {
    for (const key of [cdReadingKey(loanId), cdFileKey(loanId), keys.loan(loanId), keys.properties(loanId), keys.documents(loanId), loanNumbersKey(loanId), keys.pipeline]) void queryClient.invalidateQueries({ queryKey: key })
  }
}

/** Uploads the CD as a Closing Disclosure, then has the assistant read it. */
export function useUploadAndReadCd(loanId: string, organizationId: string) {
  const refresh = useRefresh(loanId)
  return useMutation({
    mutationFn: async ({ file, documentId }: { file?: File; documentId?: string }) => {
      let id = documentId ?? null
      if (file) {
        const problem = uploadProblem(file)
        if (problem) throw new Error(problem)
        if (file.type === 'image/heic') throw new Error('The assistant reads PDFs, JPGs and PNGs. Save the CD as a PDF and upload that.')
        const path = storagePathFor(organizationId, loanId, file.name)
        const up = await db().storage.from(LOAN_FILES_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
        if (up.error) throw new Error(`Upload failed: ${up.error.message}`)
        const row = await db()
          .from('loan_documents')
          .insert({ organization_id: organizationId, loan_id: loanId, kind: 'closing_disclosure', file_name: file.name, storage_path: path, content_type: file.type, size_bytes: file.size })
          .select('id')
        if (row.error) {
          await db().storage.from(LOAN_FILES_BUCKET).remove([path])
          throw new Error(row.error.message)
        }
        id = (row.data as { id: string }[])[0]?.id ?? null
      }
      if (!id) throw new Error('Pick the Closing Disclosure to read.')
      return invokeAssistant<{ readingId: string }>({ task: 'closing_disclosure_read', loanId, documentId: id }, 'The assistant could not read the Closing Disclosure.')
    },
    onSettled: refresh,
  })
}

/** Saves the picked figures to the file in one step; returns what changed (with the values before). */
export function useApplyCd(loanId: string) {
  const refresh = useRefresh(loanId)
  return useMutation({
    mutationFn: async ({ readingId, changes }: { readingId: string; changes: CdChange[] }) =>
      unwrap<CdAppliedItem[]>(await db().rpc('apply_closing_disclosure', { p_reading_id: readingId, p_changes: changes })),
    onSettled: refresh,
  })
}

/** Puts the file back as it was before Apply, except values changed again since (named in `skipped`). */
export function useUndoCd(loanId: string) {
  const refresh = useRefresh(loanId)
  return useMutation({
    mutationFn: async (readingId: string) => unwrap<{ restored: number; skipped: string[] }>(await db().rpc('undo_closing_disclosure', { p_reading_id: readingId })),
    onSettled: refresh,
  })
}

/** Sets a reading aside without changing the file. */
export function useDiscardCd(loanId: string) {
  const refresh = useRefresh(loanId)
  return useMutation({
    mutationFn: async (readingId: string) => {
      unwrap(await db().from('closing_disclosure_readings').update({ status: 'discarded' }).eq('id', readingId).eq('status', 'pending_review').select('id'))
    },
    onSettled: refresh,
  })
}
