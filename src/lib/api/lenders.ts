import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import { pdfPages, sha256Hex } from '@/lib/documents/pdfText'
import { guessDocument, type DocGuess } from '@/lib/products/docGuess'
import { splitIntoPassages, type ExtractedPassage } from '@/lib/products/passages'
import { termMonths, type DocType, type Feature, type LenderChannel, type LenderStatus, type Lien, type MatrixPurpose, type ProductFamily, type ProgramTerm } from '@/lib/products/taxonomy'
import type { GuidelineDocument } from './products'
import { db, keys, unwrap } from './client'

// ---------------------------------------------------------------------------
// Lenders
// ---------------------------------------------------------------------------

export interface Lender {
  id: string
  name: string
  shortName: string | null
  status: LenderStatus
  channel: LenderChannel
  aeName: string | null
  aePhone: string | null
  aeEmail: string | null
  portalUrl: string | null
  compNotes: string | null
  states: string[] | null
  notes: string | null
  programs: { id: string; name: string; active: boolean; lastVerifiedOn: string | null }[]
  documentCount: number
}

interface LenderRow {
  id: string
  name: string
  short_name: string | null
  status: LenderStatus
  channel: LenderChannel
  ae_name: string | null
  ae_phone: string | null
  ae_email: string | null
  portal_url: string | null
  comp_notes: string | null
  states: string[] | null
  notes: string | null
  programs: { id: string; name: string; active: boolean; last_verified_on: string | null }[]
  guideline_documents: { count: number }[]
}

export function useLenders() {
  return useQuery({
    queryKey: keys.lenders,
    queryFn: async () =>
      unwrap<LenderRow[]>(
        await db().from('lenders').select('id, name, short_name, status, channel, ae_name, ae_phone, ae_email, portal_url, comp_notes, states, notes, programs(id, name, active, last_verified_on), guideline_documents(count)').order('name'),
      ).map(
        (r): Lender => ({
          id: r.id,
          name: r.name,
          shortName: r.short_name,
          status: r.status,
          channel: r.channel,
          aeName: r.ae_name,
          aePhone: r.ae_phone,
          aeEmail: r.ae_email,
          portalUrl: r.portal_url,
          compNotes: r.comp_notes,
          states: r.states,
          notes: r.notes,
          programs: r.programs.map((p) => ({ id: p.id, name: p.name, active: p.active, lastVerifiedOn: p.last_verified_on })).sort((a, b) => a.name.localeCompare(b.name)),
          documentCount: r.guideline_documents[0]?.count ?? 0,
        }),
      ),
  })
}

export type LenderDraft = Omit<Lender, 'id' | 'programs' | 'documentCount'> & { id: string | null }

export const blankLender = (): LenderDraft => ({ id: null, name: '', shortName: null, status: 'not_signed_up', channel: 'wholesale', aeName: null, aePhone: null, aeEmail: null, portalUrl: null, compNotes: null, states: ['TX'], notes: null })

const invalidateCatalog = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: keys.lenders })
  queryClient.invalidateQueries({ queryKey: keys.catalog })
}

export function useSaveLender() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (l: LenderDraft): Promise<string> => {
      if (!l.name.trim()) throw new Error('The lender needs a name.')
      const states = (l.states ?? []).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s))
      const row = {
        name: l.name.trim(),
        short_name: l.shortName?.trim() || null,
        status: l.status,
        channel: l.channel,
        ae_name: l.aeName?.trim() || null,
        ae_phone: l.aePhone?.trim() || null,
        ae_email: l.aeEmail?.trim() || null,
        portal_url: l.portalUrl?.trim() || null,
        comp_notes: l.compNotes?.trim() || null,
        states: states.length ? states : null,
        notes: l.notes?.trim() || null,
      }
      const result = l.id ? await db().from('lenders').update(row).eq('id', l.id).select('id') : await db().from('lenders').insert({ ...row, organization_id: orgId }).select('id')
      if (result.error?.code === '23505') throw new Error('A lender with that name already exists.')
      const rows = unwrap<{ id: string }[]>(result)
      if (rows.length === 0) throw new Error('Only owners and admins can change lenders.')
      return rows[0].id
    },
    onSuccess: () => invalidateCatalog(queryClient),
  })
}

// ---------------------------------------------------------------------------
// Programs (the basics; matrices come from the import in step 6)
// ---------------------------------------------------------------------------

export interface LenderProgram {
  id: string
  name: string
  family: ProductFamily
  lien: Lien
  docTypes: DocType[]
  features: Feature[]
  purposes: MatrixPurpose[]
  termOptions: ProgramTerm[]
  loanAmountBasis: 'this_lien' | 'combined'
  active: boolean
  lastVerifiedOn: string | null
  hasApprovedMatrix: boolean
}

export function useLenderPrograms(lenderId: string) {
  return useQuery({
    queryKey: keys.lenderPrograms(lenderId),
    queryFn: async () =>
      unwrap<{ id: string; name: string; product_family: ProductFamily; lien: Lien; doc_types: DocType[]; features: Feature[]; purposes: MatrixPurpose[]; term_options: ProgramTerm[] | null; loan_amount_basis: 'this_lien' | 'combined'; active: boolean; last_verified_on: string | null; matrix_versions: { status: string }[] }[]>(
        await db().from('programs').select('id, name, product_family, lien, doc_types, features, purposes, term_options, loan_amount_basis, active, last_verified_on, matrix_versions(status)').eq('lender_id', lenderId).order('name'),
      ).map(
        (p): LenderProgram => ({ id: p.id, name: p.name, family: p.product_family, lien: p.lien, docTypes: p.doc_types, features: p.features, purposes: p.purposes, termOptions: p.term_options ?? [], loanAmountBasis: p.loan_amount_basis, active: p.active, lastVerifiedOn: p.last_verified_on, hasApprovedMatrix: p.matrix_versions.some((v) => v.status === 'approved') }),
      ),
  })
}

export type ProgramEdit = Pick<LenderProgram, 'id' | 'name' | 'family' | 'lien' | 'docTypes' | 'features' | 'purposes' | 'termOptions'>

/** Changes a program's product details and term options (owners and admins). Its matrix is changed only through a new matrix. */
export function useEditProgram(lenderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (p: ProgramEdit) => {
      if (!p.name.trim()) throw new Error('Give the program a name.')
      if (!p.docTypes.length || !p.purposes.length) throw new Error('Pick at least one doc type and one purpose.')
      const result = await db()
        .from('programs')
        .update({ name: p.name.trim(), product_family: p.family, lien: p.lien, doc_types: p.docTypes, features: p.features, purposes: p.purposes, term_options: p.termOptions, terms_months: [...new Set(p.termOptions.map(termMonths))] })
        .eq('id', p.id)
        .select('id')
      if (result.error?.code === '23505') throw new Error('This lender already has a program with that name.')
      if (unwrap<{ id: string }[]>(result).length === 0) throw new Error('Only owners and admins can change programs.')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.lenderPrograms(lenderId) })
      queryClient.invalidateQueries({ queryKey: keys.lenders })
      invalidateCatalog(queryClient)
    },
  })
}

export function useSetProgramActive(lenderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      if (unwrap<{ id: string }[]>(await db().from('programs').update({ active }).eq('id', id).select('id')).length === 0) throw new Error('Only owners and admins can change programs.')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.lenderPrograms(lenderId) })
      invalidateCatalog(queryClient)
    },
  })
}

// ---------------------------------------------------------------------------
// Guideline documents
// ---------------------------------------------------------------------------

export interface LenderDocument extends GuidelineDocument {
  uploadedAt: string
  programIds: string[]
  passageCount: number
}

export function useLenderDocuments(lenderId: string) {
  return useQuery({
    queryKey: keys.lenderDocuments(lenderId),
    queryFn: async () =>
      unwrap<
        { id: string; title: string; doc_type: GuidelineDocument['docType']; version_label: string | null; effective_date: string | null; page_count: number | null; storage_path: string | null; current: boolean; uploaded_at: string; guideline_document_programs: { program_id: string }[]; guideline_passages: { count: number }[] }[]
      >(
        await db()
          .from('guideline_documents')
          .select('id, title, doc_type, version_label, effective_date, page_count, storage_path, current, uploaded_at, guideline_document_programs(program_id), guideline_passages(count)')
          .eq('lender_id', lenderId)
          .order('uploaded_at', { ascending: false }),
      ).map(
        (d): LenderDocument => ({
          id: d.id,
          title: d.title,
          docType: d.doc_type,
          versionLabel: d.version_label,
          effectiveDate: d.effective_date,
          pageCount: d.page_count,
          storagePath: d.storage_path,
          current: d.current,
          uploadedAt: d.uploaded_at,
          programIds: d.guideline_document_programs.map((l) => l.program_id),
          passageCount: d.guideline_passages[0]?.count ?? 0,
        }),
      ),
  })
}

/** A PDF read in the browser before upload: its text, searchable passages and what it looks like (no AI). */
export interface PreparedFile {
  file: File
  sha256: string
  pageCount: number
  passages: ExtractedPassage[]
  guess: DocGuess
  /** The title of the same file already uploaded for this lender, if any. */
  duplicateOf: string | null
}

/** Reads a PDF in the browser: checks it, hashes it, pulls its text into passages and guesses what it is. Nothing is saved. */
export async function prepareGuidelineFile(lenderId: string, file: File): Promise<PreparedFile> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new Error(`${file.name} isn't a PDF.`)
  if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} is over 50 MB.`)
  const sha256 = await sha256Hex(await file.arrayBuffer())
  const same = unwrap<{ title: string }[]>(await db().from('guideline_documents').select('title').eq('lender_id', lenderId).eq('sha256', sha256))
  const pages = await pdfPages(await file.arrayBuffer())
  return { file, sha256, pageCount: pages.length, passages: splitIntoPassages(pages), guess: guessDocument({ fileName: file.name, pages }), duplicateOf: same[0]?.title ?? null }
}

/** Guesses what an already-uploaded document is from its title and first passages (no AI), to set up its program. */
export async function guessStoredDocument(d: Pick<LenderDocument, 'id' | 'title'>): Promise<DocGuess> {
  const rows = unwrap<{ page: number; body: string }[]>(await db().from('guideline_passages').select('page, body').eq('document_id', d.id).order('position').limit(60))
  const pages: string[][] = []
  for (const r of rows) (pages[r.page - 1] ??= []).push(r.body)
  return guessDocument({ fileName: d.title, pages: Array.from(pages, (p) => p ?? []) })
}

export interface UploadInput {
  lenderId: string
  prepared: PreparedFile
  docType: GuidelineDocument['docType']
  title: string
  versionLabel: string | null
  effectiveDate: string | null
  programIds: string[]
  /** An older document this one replaces (marked superseded). */
  replacesId: string | null
}

const safeName = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'document.pdf'

/** Stores a prepared PDF with its passages and links it to programs. Undoes the upload if a later step fails. */
export async function uploadGuidelineDocument(organizationId: string, u: UploadInput): Promise<{ documentId: string; pages: number; passages: number }> {
  const { file, sha256, passages, pageCount } = u.prepared
  if (u.prepared.duplicateOf) throw new Error(`This exact file is already uploaded as "${u.prepared.duplicateOf}".`)
  const path = `${organizationId}/${u.lenderId}/${crypto.randomUUID().slice(0, 8)}-${safeName(file.name)}`
  const stored = await db().storage.from('guideline-files').upload(path, file, { contentType: 'application/pdf', upsert: false })
  if (stored.error) throw new Error(stored.error.message)

  let documentId: string | null = null
  try {
    documentId = unwrap<{ id: string }>(
      await db()
        .from('guideline_documents')
        .insert({ organization_id: organizationId, lender_id: u.lenderId, doc_type: u.docType, title: u.title.trim() || file.name, version_label: u.versionLabel, effective_date: u.effectiveDate, page_count: pageCount, sha256, storage_path: path })
        .select('id')
        .single(),
    ).id
    for (let i = 0; i < passages.length; i += 500) {
      unwrap(await db().from('guideline_passages').insert(passages.slice(i, i + 500).map((p) => ({ organization_id: organizationId, document_id: documentId, position: p.position, page: p.page, section_number: p.sectionNumber, heading: p.heading, body: p.body }))).select('id'))
    }
    if (u.programIds.length) unwrap(await db().from('guideline_document_programs').insert(u.programIds.map((program_id) => ({ document_id: documentId, program_id, organization_id: organizationId }))).select('document_id'))
    if (u.replacesId) unwrap(await db().from('guideline_documents').update({ current: false }).eq('id', u.replacesId).select('id'))
  } catch (e) {
    if (documentId) await db().from('guideline_documents').delete().eq('id', documentId)
    await db().storage.from('guideline-files').remove([path])
    throw e
  }
  return { documentId: documentId!, pages: pageCount, passages: passages.length }
}

export function useUploadGuidelineDocument(lenderId: string) {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: (u: UploadInput) => {
      if (!orgId) throw new Error('Not signed in to a company.')
      return uploadGuidelineDocument(orgId, u)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.lenderDocuments(lenderId) })
      queryClient.invalidateQueries({ queryKey: keys.lenders })
      queryClient.invalidateQueries({ queryKey: ['programGuidelines'] })
    },
  })
}

/** Which programs a document covers, and whether it's the current version. */
export function useUpdateLenderDocument(lenderId: string) {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async ({ id, current, programIds }: { id: string; current?: boolean; programIds?: string[] }) => {
      if (current !== undefined && unwrap<{ id: string }[]>(await db().from('guideline_documents').update({ current }).eq('id', id).select('id')).length === 0) throw new Error('Only owners and admins can change documents.')
      if (programIds) {
        unwrap(await db().from('guideline_document_programs').delete().eq('document_id', id).select('document_id'))
        if (programIds.length) unwrap(await db().from('guideline_document_programs').insert(programIds.map((program_id) => ({ document_id: id, program_id, organization_id: orgId }))).select('document_id'))
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.lenderDocuments(lenderId) })
      queryClient.invalidateQueries({ queryKey: ['programGuidelines'] })
    },
  })
}

export function useDeleteLenderDocument(lenderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (d: Pick<LenderDocument, 'id' | 'storagePath'>) => {
      const rows = unwrap<{ id: string }[]>(await db().from('guideline_documents').delete().eq('id', d.id).select('id'))
      if (rows.length === 0) throw new Error('Only owners and admins can delete documents.')
      if (d.storagePath) await db().storage.from('guideline-files').remove([d.storagePath])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.lenderDocuments(lenderId) })
      queryClient.invalidateQueries({ queryKey: keys.lenders })
      queryClient.invalidateQueries({ queryKey: ['programGuidelines'] })
    },
  })
}
