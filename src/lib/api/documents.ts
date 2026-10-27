import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, keys, unwrap } from './client'

/** The private storage bucket for files on a borrower file. */
export const LOAN_FILES_BUCKET = 'loan-files'
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic']

/** What a document is. Grouped for pickers; the order is the order shown. */
export const DOCUMENT_KIND_GROUPS = [
  { label: 'Income', kinds: [['paystub', 'Pay stub'], ['w2', 'W-2'], ['form_1099', '1099'], ['tax_return', 'Tax return'], ['business_return', 'Business tax return'], ['profit_loss', 'Profit and loss'], ['award_letter', 'Award letter'], ['divorce_decree', 'Divorce decree or support order']] },
  { label: 'Money', kinds: [['bank_statement', 'Bank statement'], ['investment_statement', 'Investment or retirement statement'], ['gift_letter', 'Gift letter']] },
  { label: 'Credit and ID', kinds: [['photo_id', 'Photo ID'], ['bankruptcy_papers', 'Bankruptcy papers'], ['explanation_letter', 'Letter of explanation']] },
  { label: 'Property', kinds: [['purchase_contract', 'Purchase contract'], ['contract_addendum', 'Addendum'], ['mortgage_statement', 'Mortgage statement'], ['insurance_declarations', 'Insurance declarations'], ['lease', 'Lease'], ['appraisal', 'Appraisal'], ['title_commitment', 'Title commitment']] },
  { label: 'Made in LOSuite', kinds: [['fee_worksheet', 'Fee Worksheet'], ['loan_comparison', 'Loan comparison'], ['preapproval_letter', 'Pre-approval letter']] },
  { label: 'Other', kinds: [['other', 'Other']] },
] as const

export type DocumentKind = (typeof DOCUMENT_KIND_GROUPS)[number]['kinds'][number][0]

export const DOCUMENT_KIND_LABEL = Object.fromEntries(DOCUMENT_KIND_GROUPS.flatMap((g) => g.kinds.map(([k, l]) => [k, l]))) as Record<DocumentKind, string>

export interface LoanDocument {
  id: string
  kind: DocumentKind
  /** Whose document it is (a borrower), if set. */
  contactId: string | null
  /** The home it's for, if set. */
  propertyId: string | null
  fileName: string
  storagePath: string
  contentType: string | null
  sizeBytes: number | null
  createdAt: string
}

interface DocumentRow {
  id: string
  kind: DocumentKind
  contact_id: string | null
  property_id: string | null
  file_name: string
  storage_path: string
  content_type: string | null
  size_bytes: number | null
  created_at: string
}

/** A file's uploaded documents, newest first, optionally only some kinds. */
export function useLoanDocuments(loanId: string, kinds?: DocumentKind[]) {
  return useQuery({
    queryKey: keys.documents(loanId),
    queryFn: async () =>
      unwrap<DocumentRow[]>(await db().from('loan_documents').select('id, kind, contact_id, property_id, file_name, storage_path, content_type, size_bytes, created_at').eq('loan_id', loanId).order('created_at', { ascending: false })).map(
        (r): LoanDocument => ({ id: r.id, kind: r.kind, contactId: r.contact_id, propertyId: r.property_id, fileName: r.file_name, storagePath: r.storage_path, contentType: r.content_type, sizeBytes: r.size_bytes, createdAt: r.created_at }),
      ),
    select: kinds ? (docs: LoanDocument[]) => docs.filter((d) => kinds.includes(d.kind)) : undefined,
  })
}

/** Why a file can't be uploaded, or null if it's fine. */
export function uploadProblem(file: { name: string; size: number; type: string }): string | null {
  if (file.size === 0) return `${file.name} is empty.`
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is over 25 MB.`
  if (!ACCEPTED_TYPES.includes(file.type)) return `${file.name} isn't a PDF or photo.`
  return null
}

/** Storage path: <organization>/<loan>/<random>-<cleaned file name>. */
export function storagePathFor(organizationId: string, loanId: string, fileName: string, id: string = crypto.randomUUID()): string {
  const clean = fileName.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(-80) || 'file'
  return `${organizationId}/${loanId}/${id}-${clean}`
}

/** Uploads a file to the private bucket, then records it on the loan. */
export function useUploadDocument(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, kind, contactId = null }: { file: File; kind: DocumentKind; contactId?: string | null }) => {
      const problem = uploadProblem(file)
      if (problem) throw new Error(problem)
      const path = storagePathFor(organizationId, loanId, file.name)
      const upload = await db().storage.from(LOAN_FILES_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
      if (upload.error) throw new Error(`Upload failed: ${upload.error.message}`)
      const row = await db()
        .from('loan_documents')
        .insert({ organization_id: organizationId, loan_id: loanId, kind, contact_id: contactId, file_name: file.name, storage_path: path, content_type: file.type, size_bytes: file.size })
        .select('id')
      if (row.error) {
        // Don't leave a file behind that the loan doesn't list.
        await db().storage.from(LOAN_FILES_BUCKET).remove([path])
        throw new Error(row.error.message)
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.documents(loanId) }),
  })
}

export interface GeneratedPdf {
  file: Blob
  fileName: string
  kind: DocumentKind
  /** The home it's for (shows on that property), if any. */
  propertyId: string | null
  pricingScenarioId?: string | null
  /** Which template made it, e.g. "fee-worksheet v1". */
  templateVersion: string
}

/** Saves a PDF LOSuite made to the file's Documents, tagged with its property and scenario. Returns the document id. */
export async function saveGeneratedPdf(loanId: string, organizationId: string, pdf: GeneratedPdf): Promise<string> {
  const path = storagePathFor(organizationId, loanId, pdf.fileName)
  const upload = await db().storage.from(LOAN_FILES_BUCKET).upload(path, pdf.file, { contentType: 'application/pdf', upsert: false })
  if (upload.error) throw new Error(`Saving the PDF failed: ${upload.error.message}`)
  const row = await db()
    .from('loan_documents')
    .insert({
      organization_id: organizationId,
      loan_id: loanId,
      kind: pdf.kind,
      file_name: pdf.fileName,
      storage_path: path,
      content_type: 'application/pdf',
      size_bytes: pdf.file.size,
      property_id: pdf.propertyId,
      pricing_scenario_id: pdf.pricingScenarioId ?? null,
      template_version: pdf.templateVersion,
    })
    .select('id')
  if (row.error) {
    await db().storage.from(LOAN_FILES_BUCKET).remove([path])
    throw new Error(row.error.message.includes('template_version') || row.error.message.includes('enum') ? 'Run the generated documents script in Supabase first.' : row.error.message)
  }
  return (row.data as { id: string }[])[0].id
}

/** Changes what a document is, or whose it is. */
export function useUpdateDocument(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, kind, contactId }: { id: string; kind?: DocumentKind; contactId?: string | null }) => {
      const changes = { ...(kind ? { kind } : {}), ...(contactId !== undefined ? { contact_id: contactId } : {}) }
      unwrap(await db().from('loan_documents').update(changes).eq('id', id).select('id'))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.documents(loanId) }),
  })
}

/** Deletes the file from storage and its record from the loan. */
export function useDeleteDocument(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (doc: LoanDocument) => {
      const removed = await db().storage.from(LOAN_FILES_BUCKET).remove([doc.storagePath])
      if (removed.error) throw new Error(removed.error.message)
      unwrap(await db().from('loan_documents').delete().eq('id', doc.id).select('id'))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.documents(loanId) }),
  })
}

/** Opens a document in a new tab through a link that works for one minute. */
export async function openDocument(doc: LoanDocument) {
  // Open the tab first so the browser doesn't treat it as a pop-up.
  const tab = window.open('', '_blank')
  const { data, error } = await db().storage.from(LOAN_FILES_BUCKET).createSignedUrl(doc.storagePath, 60)
  if (error || !data) {
    tab?.close()
    throw new Error(error?.message ?? 'Could not open the file.')
  }
  if (tab) tab.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}
