import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, keys, unwrap } from './client'

/** The private storage bucket for files on a borrower file. */
export const LOAN_FILES_BUCKET = 'loan-files'
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic']

export type DocumentKind = 'purchase_contract' | 'contract_addendum' | 'other'

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  purchase_contract: 'Purchase contract',
  contract_addendum: 'Addendum',
  other: 'Other',
}

export interface LoanDocument {
  id: string
  kind: DocumentKind
  fileName: string
  storagePath: string
  contentType: string | null
  sizeBytes: number | null
  createdAt: string
}

interface DocumentRow {
  id: string
  kind: DocumentKind
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
      unwrap<DocumentRow[]>(await db().from('loan_documents').select('id, kind, file_name, storage_path, content_type, size_bytes, created_at').eq('loan_id', loanId).order('created_at', { ascending: false })).map(
        (r): LoanDocument => ({ id: r.id, kind: r.kind, fileName: r.file_name, storagePath: r.storage_path, contentType: r.content_type, sizeBytes: r.size_bytes, createdAt: r.created_at }),
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
    mutationFn: async ({ file, kind }: { file: File; kind: DocumentKind }) => {
      const problem = uploadProblem(file)
      if (problem) throw new Error(problem)
      const path = storagePathFor(organizationId, loanId, file.name)
      const upload = await db().storage.from(LOAN_FILES_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
      if (upload.error) throw new Error(`Upload failed: ${upload.error.message}`)
      const row = await db()
        .from('loan_documents')
        .insert({ organization_id: organizationId, loan_id: loanId, kind, file_name: file.name, storage_path: path, content_type: file.type, size_bytes: file.size })
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

export function useUpdateDocumentKind(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: DocumentKind }) => {
      unwrap(await db().from('loan_documents').update({ kind }).eq('id', id).select('id'))
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
