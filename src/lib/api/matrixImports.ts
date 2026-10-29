import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MatrixReading, ReadGrid, ReadProgram, ReadRule } from '../../../supabase/functions/assistant/matrix'
import type { ProgramNow, ReviewProgram } from '@/lib/products/matrixImport'
import { approvalPayload } from '@/lib/products/matrixImport'
import { blankProgram, gridsFromCells } from '@/lib/products/typedMatrix'
import type { MatrixCell } from '@/lib/products/types'
import { invokeAssistant } from './assistant'
import { linkUnlinkedDocuments } from './lenders'
import { db, keys, num, unwrap } from './client'

export interface MatrixImport {
  id: string
  lenderId: string
  lenderName: string
  documentId: string | null
  documentTitle: string | null
  storagePath: string | null
  status: 'pending_review' | 'approved' | 'discarded'
  /** 'manual' = typed or pasted by hand; 'ai' = read by the assistant. */
  source: 'ai' | 'manual'
  reading: MatrixReading
  createdAt: string
}

interface ImportRow {
  id: string
  lender_id: string
  document_id: string | null
  status: MatrixImport['status']
  source: MatrixImport['source']
  reading: MatrixReading
  created_at: string
  lender: { name: string } | null
  document: { title: string; storage_path: string | null } | null
}

const SELECT = 'id, lender_id, document_id, status, source, reading, created_at, lender:lenders(name), document:guideline_documents(title, storage_path)'
/** Readings saved before a grid could cover several income types had one docType per grid. */
const withGridDocTypes = (reading: MatrixReading): MatrixReading => ({
  ...reading,
  programs: reading.programs.map((p) => ({ ...p, grids: p.grids.map((g) => (Array.isArray(g.docTypes) ? g : { ...g, docTypes: [(g as unknown as { docType: ReadGrid['docTypes'][number] }).docType ?? 'full_doc'] })) })),
})

const toImport = (r: ImportRow): MatrixImport => ({ id: r.id, lenderId: r.lender_id, lenderName: r.lender?.name ?? '', documentId: r.document_id, documentTitle: r.document?.title ?? null, storagePath: r.document?.storage_path ?? null, status: r.status, source: r.source, reading: withGridDocTypes(r.reading), createdAt: r.created_at })

/** Asks the assistant to read a matrix PDF. The reading waits for review; nothing is searchable until approved. */
export async function readMatrix(documentId: string): Promise<string> {
  const r = await invokeAssistant<{ importId: string }>({ task: 'matrix_read', documentId }, 'The assistant could not read this matrix.')
  return r.importId
}

interface BatchSubmit {
  batchId: string | null
  queued: number
  skipped: { documentId: string; error: string }[]
  left: string[]
}

/**
 * Sends matrices to be read in the background: half price and no time limit, so long
 * matrices get read too. Takes as many calls as the PDFs need; each reading lands in
 * "Waiting for your review" once it's collected.
 */
export async function queueMatrixReads(documentIds: string[]): Promise<{ queued: number; skipped: BatchSubmit['skipped'] }> {
  let rest = documentIds
  let queued = 0
  const skipped: BatchSubmit['skipped'] = []
  while (rest.length > 0) {
    const r = await invokeAssistant<BatchSubmit>({ task: 'matrix_batch_submit', documentIds: rest.slice(0, 50) }, 'The assistant could not send these to be read.')
    queued += r.queued
    skipped.push(...r.skipped)
    rest = [...r.left, ...rest.slice(50)]
  }
  return { queued, skipped }
}

export interface BatchCollect {
  saved: number
  failed: number
  waiting: number
  more: boolean
}

/** Saves the background readings that are done (no AI cost: it only fetches finished results). */
export async function collectMatrixReads(): Promise<BatchCollect> {
  return invokeAssistant<BatchCollect>({ task: 'matrix_batch_collect' }, 'The assistant could not check the background readings.')
}

/** Documents being read in the background right now. */
export function useQueuedReads() {
  return useQuery({
    queryKey: ['batchReads'],
    queryFn: async () =>
      unwrap<{ input_ref: { documentId: string } }[]>(await db().from('ai_runs').select('input_ref').eq('task_type', 'matrix_read').eq('status', 'running').not('input_ref->>batchId', 'is', null)).map((r) => r.input_ref.documentId),
  })
}

/** While anything is being read in the background, saves finished readings every two minutes. */
export function useCollectReads(lenderId: string, queued: number) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['batchCollect', lenderId],
    enabled: queued > 0,
    refetchInterval: 2 * 60 * 1000,
    queryFn: async () => {
      const r = await collectMatrixReads()
      if (r.saved + r.failed > 0) for (const key of [['batchReads'], keys.lenderImports(lenderId)]) queryClient.invalidateQueries({ queryKey: key })
      return r
    },
  })
}

/** Starts a matrix typed by hand (optionally beside one of the lender's PDFs). It's a draft until approved, like an AI reading. */
export function useStartTypedMatrix(lenderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ organizationId, documentId, program, editOf }: { organizationId: string; documentId: string | null; program?: ReadProgram; editOf?: string }) => {
      const reading: MatrixReading = { programs: [program ?? blankProgram()], effectiveDate: null, notes: null, dropped: [], ...(editOf && { editOf }) }
      const row = unwrap<{ id: string }>(await db().from('matrix_imports').insert({ organization_id: organizationId, lender_id: lenderId, document_id: documentId, source: 'manual', reading }).select('id').single())
      return row.id
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.lenderImports(lenderId) }),
  })
}

/** Saves a typed draft as it's edited, so nothing is lost if the page closes. */
export async function saveTypedDraft(importId: string, reading: MatrixReading) {
  const rows = unwrap<{ id: string }[]>(await db().from('matrix_imports').update({ reading }).eq('id', importId).eq('status', 'pending_review').eq('source', 'manual').select('id'))
  if (rows.length === 0) throw new Error('This draft was already approved or discarded, or only owners and admins can edit it.')
}

const CELL_COLUMNS = 'matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_min, loan_amount_max, max_ltv, max_cltv, offered, notes, source_page'
const RULE_COLUMNS = 'matrix_version_id, field, op, value, applies_when, severity, message, source_page, source_quote'

const toImportCell = (c: Record<string, unknown>) => ({
  occupancy: c.occupancy as MatrixCell['occupancy'],
  propertyTypes: c.property_types as MatrixCell['propertyTypes'],
  purposes: c.purposes as MatrixCell['purposes'],
  docType: c.doc_type as MatrixCell['docType'],
  unitsMin: c.units_min as number,
  unitsMax: c.units_max as number,
  ficoMin: c.fico_min as number,
  ficoMax: c.fico_max as number,
  loanAmountMin: num(c.loan_amount_min) ?? 0,
  loanAmountMax: num(c.loan_amount_max),
  maxLtv: num(c.max_ltv),
  maxCltv: num(c.max_cltv),
  offered: c.offered as boolean,
  notes: (c.notes as string | null) ?? null,
  sourcePage: (c.source_page as number | null) ?? null,
})

const toReadRule = (r: Record<string, unknown>) => ({ field: r.field, op: r.op, value: r.value, appliesWhen: r.applies_when ?? null, severity: r.severity, message: r.message, page: r.source_page ?? null, quote: r.source_quote ?? '' }) as ReadRule

/** A program's matrix in use as an editable reading ("Edit limits"), with the document it came from. */
export async function programAsReading(programId: string): Promise<{ program: ReadProgram; documentId: string | null }> {
  const p = unwrap<{ name: string; product_family: ReadProgram['family']; lien: ReadProgram['lien']; doc_types: ReadProgram['docTypes']; features: ReadProgram['features']; purposes: ReadProgram['purposes']; term_options: ReadProgram['termOptions'] | null; loan_amount_basis: ReadProgram['loanAmountBasis']; description: string | null; matrix_versions: { id: string; status: string; source_document_id: string | null }[] }>(
    await db().from('programs').select('name, product_family, lien, doc_types, features, purposes, term_options, loan_amount_basis, description, matrix_versions(id, status, source_document_id)').eq('id', programId).single(),
  )
  const v = p.matrix_versions.find((x) => x.status === 'approved')
  const [cells, rules] = v
    ? await Promise.all([
        unwrap<Record<string, unknown>[]>(await db().from('program_matrix_cells').select(CELL_COLUMNS).eq('matrix_version_id', v.id).limit(20000)),
        unwrap<Record<string, unknown>[]>(await db().from('program_rules').select(RULE_COLUMNS).eq('matrix_version_id', v.id)),
      ])
    : [[], []]
  return {
    documentId: v?.source_document_id ?? null,
    program: { name: p.name, family: p.product_family, lien: p.lien, docTypes: p.doc_types, features: p.features, purposes: p.purposes, termOptions: p.term_options ?? [], loanAmountBasis: p.loan_amount_basis, description: p.description, grids: gridsFromCells(cells.map(toImportCell), p.lien), rules: rules.map(toReadRule) },
  }
}

export function useMatrixImport(id: string) {
  return useQuery({ queryKey: keys.matrixImport(id), queryFn: async () => toImport(unwrap<ImportRow>(await db().from('matrix_imports').select(SELECT).eq('id', id).single())) })
}

/** Readings of this lender's matrices waiting for review. */
export function usePendingImports(lenderId: string) {
  return useQuery({
    queryKey: keys.lenderImports(lenderId),
    queryFn: async () => unwrap<ImportRow[]>(await db().from('matrix_imports').select(SELECT).eq('lender_id', lenderId).eq('status', 'pending_review').order('created_at', { ascending: false })).map(toImport),
  })
}

export interface ExistingProgram extends ProgramNow {
  family: ReadProgram['family']
  lien: ReadProgram['lien']
  /** The approved matrix version in use, if any. */
  version: number | null
}

/** The lender's programs with what each has now (matrix cells, rules, terms, income types), to compare against or merge into. */
export function useExistingPrograms(lenderId: string) {
  return useQuery({
    queryKey: keys.lenderPrograms(`${lenderId}:cells`),
    queryFn: async (): Promise<ExistingProgram[]> => {
      const programs = unwrap<
        { id: string; name: string; product_family: ReadProgram['family']; lien: ReadProgram['lien']; doc_types: ProgramNow['docTypes']; purposes: ProgramNow['purposes']; features: ProgramNow['features']; term_options: ProgramNow['termOptions'] | null; description: string | null; matrix_versions: { id: string; version: number; status: string; source_document_id: string | null }[] }[]
      >(await db().from('programs').select('id, name, product_family, lien, doc_types, purposes, features, term_options, description, matrix_versions(id, version, status, source_document_id)').eq('lender_id', lenderId))
      const approved = programs.flatMap((p) => p.matrix_versions.filter((v) => v.status === 'approved').map((v) => ({ programId: p.id, versionId: v.id, version: v.version, sourceDocumentId: v.source_document_id })))
      const ids = approved.map((a) => a.versionId)
      const [cells, rules] = ids.length
        ? await Promise.all([
            unwrap<Record<string, unknown>[]>(await db().from('program_matrix_cells').select(CELL_COLUMNS).in('matrix_version_id', ids).limit(20000)),
            unwrap<Record<string, unknown>[]>(await db().from('program_rules').select(RULE_COLUMNS).in('matrix_version_id', ids)),
          ])
        : [[], []]
      return programs.map((p): ExistingProgram => {
        const v = approved.find((x) => x.programId === p.id)
        return {
          id: p.id,
          name: p.name,
          family: p.product_family,
          lien: p.lien,
          version: v?.version ?? null,
          sourceDocumentId: v?.sourceDocumentId ?? null,
          docTypes: p.doc_types,
          purposes: p.purposes,
          features: p.features,
          termOptions: p.term_options ?? [],
          description: p.description,
          cells: cells.filter((c) => c.matrix_version_id === v?.versionId).map(toImportCell),
          rules: rules
            .filter((r) => r.matrix_version_id === v?.versionId)
            .map(toReadRule),
        }
      })
    },
  })
}

export function useApproveImport(importId: string, lenderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ programs, existing, effectiveDate }: { programs: ReviewProgram[]; existing: ProgramNow[]; effectiveDate: string | null }) =>
      unwrap<{ programs: number; cells: number; rules: number }>(await db().rpc('approve_matrix_import', { p_import_id: importId, p_programs: approvalPayload(programs, existing), p_effective_date: effectiveDate })),
    onSuccess: async () => {
      // Guideline and overlay PDFs no program covers yet join the programs they're about.
      await linkUnlinkedDocuments(lenderId).catch(() => 0)
      for (const key of [keys.matrixImport(importId), keys.lenderImports(lenderId), keys.lenderPrograms(lenderId), keys.lenderPrograms(`${lenderId}:cells`), keys.lenderDocuments(lenderId), keys.lenders, keys.catalog, ['programGuidelines']]) queryClient.invalidateQueries({ queryKey: key })
    },
  })
}

export function useDiscardImport(importId: string, lenderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const rows = unwrap<{ id: string }[]>(await db().from('matrix_imports').update({ status: 'discarded', decided_at: new Date().toISOString() }).eq('id', importId).eq('status', 'pending_review').select('id'))
      if (rows.length === 0) throw new Error('Only owners and admins can discard a reading, and only while it waits for review.')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.matrixImport(importId) })
      queryClient.invalidateQueries({ queryKey: keys.lenderImports(lenderId) })
    },
  })
}

/** A short-lived link to the stored PDF, for the side-by-side view. */
export function useSignedPdf(storagePath: string | null) {
  return useQuery({
    queryKey: ['signedPdf', storagePath],
    enabled: !!storagePath,
    staleTime: 8 * 60_000,
    queryFn: async () => {
      const { data, error } = await db().storage.from('guideline-files').createSignedUrl(storagePath!, 600)
      if (error || !data) throw new Error(error?.message ?? 'Could not open the PDF.')
      return data.signedUrl
    },
  })
}
