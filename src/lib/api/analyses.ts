// Upload analyses (Stage 3b, `20270118000000_document_analyses.sql`): what the
// assistant suggested for each uploaded document, with Re-run, accepting or
// dismissing the suggested type, and adding a new employer to the 1003. The
// AI never changes the file: each of these is Connor's click. Before the
// script has run, reads come back null and the screens hide it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocFlag, ReadField, ReadFieldKey } from '../../../supabase/functions/assistant/documentRead'
import type { DocumentKind } from './documents'
import { invokeAssistant } from './assistant'
import { db, keys, unwrap } from './client'

export type AnalysisStatus = 'queued' | 'analyzing' | 'ready' | 'needs_review' | 'failed'

export interface Analysis {
  id: string
  loanId: string
  documentId: string
  status: AnalysisStatus
  attempts: number
  nextTryAt: string
  lastError: string | null
  suggestedKind: DocumentKind | null
  kindConfidence: 'high' | 'medium' | 'low' | null
  fields: Partial<Record<ReadFieldKey, ReadField>>
  flags: DocFlag[]
  kindDecision: 'accepted' | 'dismissed' | null
  employerJobId: string | null
}

const toAnalysis = (r: Record<string, unknown>): Analysis => ({
  id: r.id as string,
  loanId: r.loan_id as string,
  documentId: r.document_id as string,
  status: r.status as AnalysisStatus,
  attempts: r.attempts as number,
  nextTryAt: r.next_try_at as string,
  lastError: (r.last_error as string | null) ?? null,
  suggestedKind: (r.suggested_kind as DocumentKind | null) ?? null,
  kindConfidence: (r.kind_confidence as Analysis['kindConfidence']) ?? null,
  fields: (r.fields as Analysis['fields']) ?? {},
  flags: (r.flags as DocFlag[]) ?? [],
  kindDecision: (r.kind_decision as Analysis['kindDecision']) ?? null,
  employerJobId: (r.employer_job_id as string | null) ?? null,
})

const analysesKey = (loanId: string) => ['analyses', loanId] as const

/** The file's analyses by document id; null before the script has run. Refreshes while any are waiting. */
export function useAnalyses(loanId: string) {
  return useQuery({
    queryKey: analysesKey(loanId),
    retry: false,
    refetchInterval: (q) => ((q.state.data as Map<string, Analysis> | null | undefined) && [...(q.state.data as Map<string, Analysis>).values()].some((a) => a.status === 'queued' || a.status === 'analyzing') ? 20_000 : false),
    queryFn: async (): Promise<Map<string, Analysis> | null> => {
      const r = await db().from('document_analyses').select('*').eq('loan_id', loanId)
      if (r.error) return null
      return new Map((r.data as Record<string, unknown>[]).map((x) => [x.document_id as string, toAnalysis(x)]))
    },
  })
}

/** Analyses that need Connor (failed, or needs review and not yet decided) across files he can see: Today. */
export function useAnalysesNeedingReview() {
  return useQuery({
    queryKey: ['analysesNeedingReview'],
    retry: false,
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ id: string; loanId: string; status: AnalysisStatus; fileName: string; problem: string | null }[]> => {
      const r = await db().from('document_analyses').select('id, loan_id, status, last_error, flags, document:loan_documents ( file_name )').in('status', ['failed', 'needs_review']).is('kind_decision', null).order('updated_at', { ascending: false }).limit(20)
      if (r.error) return []
      return (r.data as unknown as Record<string, unknown>[]).map((x) => ({
        id: x.id as string,
        loanId: x.loan_id as string,
        status: x.status as AnalysisStatus,
        fileName: (x.document as { file_name: string } | null)?.file_name ?? 'Upload',
        problem: (x.last_error as string | null) ?? ((x.flags as DocFlag[])[0]?.text ?? null),
      }))
    },
  })
}

function useAnalysisMutation<V>(loanId: string, fn: (v: V) => Promise<void>, extraKeys: readonly (readonly unknown[])[] = []) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      for (const k of [analysesKey(loanId), ['analysesNeedingReview'], ...extraKeys]) queryClient.invalidateQueries({ queryKey: k })
    },
  })
}

/** Re-run analysis: back in the queue; the timer reads it within a minute. */
export function useRerunAnalysis(loanId: string) {
  return useAnalysisMutation(loanId, async (id: string) => {
    unwrap(await db().from('document_analyses').update({ status: 'queued' }).eq('id', id).select('id'))
  })
}

/** Use the suggested type (the document's type changes) or dismiss it (nothing changes). */
export function useDecideKind(loanId: string) {
  return useAnalysisMutation(
    loanId,
    async (v: { analysis: Analysis; accept: boolean }) => {
      if (v.accept && v.analysis.suggestedKind) unwrap(await db().from('loan_documents').update({ kind: v.analysis.suggestedKind }).eq('id', v.analysis.documentId).select('id'))
      unwrap(await db().from('document_analyses').update({ kind_decision: v.accept ? 'accepted' : 'dismissed' }).eq('id', v.analysis.id).select('id'))
    },
    [keys.documents(loanId)],
  )
}

/** Adds the employer an upload named to the borrower's 1003 (a current job unless the upload says it ended). Connor's click is the acceptance. */
export function useAddEmployerFromUpload(loanId: string) {
  return useAnalysisMutation(
    loanId,
    async (v: { analysis: Analysis; organizationId: string; contactId: string; employer: string; current: boolean }) => {
      const job = unwrap<{ id: string }[]>(
        await db().from('employments').insert({ organization_id: v.organizationId, contact_id: v.contactId, employer_name: v.employer.trim(), status: v.current ? 'current' : 'previous', sort_order: 100 }).select('id'),
      )[0]
      if (!job) throw new Error('The job could not be added.')
      unwrap(await db().from('document_analyses').update({ employer_job_id: job.id }).eq('id', v.analysis.id).select('id'))
    },
    [keys.application(loanId)],
  )
}

/**
 * "Analyze" on the Income tab: reads one document now (the assistant
 * function, task document_read_now) instead of waiting for the timer. A
 * document with no analysis yet gets one.
 */
export function useAnalyzeNow(loanId: string) {
  return useAnalysisMutation(loanId, async (documentId: string) => {
    const r = await invokeAssistant<{ status: AnalysisStatus; error: string | null }>({ task: 'document_read_now', documentId }, 'The document could not be read.')
    if (r.error) throw new Error(r.error)
  })
}
