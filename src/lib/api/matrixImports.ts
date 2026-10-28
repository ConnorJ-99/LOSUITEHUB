import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MatrixReading, ReadGrid, ReadProgram } from '../../../supabase/functions/assistant/matrix'
import type { ReviewProgram } from '@/lib/products/matrixImport'
import { approvalPayload } from '@/lib/products/matrixImport'
import { blankProgram } from '@/lib/products/typedMatrix'
import type { MatrixCell } from '@/lib/products/types'
import { invokeAssistant } from './assistant'
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

/** Starts a matrix typed by hand (optionally beside one of the lender's PDFs). It's a draft until approved, like an AI reading. */
export function useStartTypedMatrix(lenderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ organizationId, documentId, program }: { organizationId: string; documentId: string | null; program?: ReadProgram }) => {
      const reading: MatrixReading = { programs: [program ?? blankProgram()], effectiveDate: null, notes: null, dropped: [] }
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

export interface ExistingProgram {
  id: string
  name: string
  /** The approved version's cells (for the "what changes" list). */
  cells: Pick<MatrixCell, 'occupancy' | 'propertyTypes' | 'purposes' | 'docType' | 'unitsMin' | 'unitsMax' | 'ficoMin' | 'ficoMax' | 'loanAmountMin' | 'loanAmountMax' | 'maxLtv' | 'maxCltv' | 'offered'>[]
  version: number | null
}

/** The lender's programs and the cells of the matrix each one uses now. */
export function useExistingPrograms(lenderId: string) {
  return useQuery({
    queryKey: keys.lenderPrograms(`${lenderId}:cells`),
    queryFn: async (): Promise<ExistingProgram[]> => {
      const programs = unwrap<{ id: string; name: string; matrix_versions: { id: string; version: number; status: string }[] }[]>(await db().from('programs').select('id, name, matrix_versions(id, version, status)').eq('lender_id', lenderId))
      const approved = programs.flatMap((p) => p.matrix_versions.filter((v) => v.status === 'approved').map((v) => ({ programId: p.id, versionId: v.id, version: v.version })))
      const cells = approved.length
        ? unwrap<Record<string, unknown>[]>(
            await db()
              .from('program_matrix_cells')
              .select('matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_min, loan_amount_max, max_ltv, max_cltv, offered')
              .in('matrix_version_id', approved.map((a) => a.versionId))
              .limit(10000),
          )
        : []
      return programs.map((p) => {
        const v = approved.find((a) => a.programId === p.id)
        return {
          id: p.id,
          name: p.name,
          version: v?.version ?? null,
          cells: cells
            .filter((c) => c.matrix_version_id === v?.versionId)
            .map((c) => ({
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
            })),
        }
      })
    },
  })
}

export function useApproveImport(importId: string, lenderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ programs, effectiveDate }: { programs: ReviewProgram[]; effectiveDate: string | null }) =>
      unwrap<{ programs: number; cells: number; rules: number }>(await db().rpc('approve_matrix_import', { p_import_id: importId, p_programs: approvalPayload(programs), p_effective_date: effectiveDate })),
    onSuccess: () => {
      for (const key of [keys.matrixImport(importId), keys.lenderImports(lenderId), keys.lenderPrograms(lenderId), keys.lenderPrograms(`${lenderId}:cells`), keys.lenderDocuments(lenderId), keys.lenders, keys.catalog]) queryClient.invalidateQueries({ queryKey: key })
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
