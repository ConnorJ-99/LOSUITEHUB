// The Loan Officer Assessment on the Borrower Profile (plan
// docs/plans/borrower-profile.md, Stage 2; `loan_assessments`). Anyone on the
// file reads and edits it; only the file's LO or an admin marks it reviewed
// (the database checks and records who and when; any later field change takes
// the review away). "Draft with AI" (assistant task borrower_assessment, Sonnet
// 5.5) fills only empty fields and marks them AI drafts until reviewed.
// Before the script has run, the read comes back null.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invokeAssistant } from './assistant'
import { db, unwrap } from './client'

export const ASSESSMENT_FIELDS = ['overview', 'strengths', 'concerns', 'strategy', 'underwriting', 'borrower_recommendations', 'outstanding_docs', 'next_steps'] as const
export type AssessmentField = (typeof ASSESSMENT_FIELDS)[number]

export const ASSESSMENT_LABEL: Record<AssessmentField, string> = {
  overview: 'Borrower overview',
  strengths: 'Financial strengths',
  concerns: 'Qualification concerns',
  strategy: 'Recommended financing strategy',
  underwriting: 'Internal underwriting considerations',
  borrower_recommendations: 'Borrower-facing recommendations',
  outstanding_docs: 'Outstanding documentation',
  next_steps: 'Next steps',
}

/** Never on a borrower-facing document. */
export const INTERNAL_ONLY: AssessmentField[] = ['underwriting', 'concerns']

export type AssessmentText = Record<AssessmentField, string>

export interface Assessment {
  text: AssessmentText
  aiFields: AssessmentField[]
  aiDraftedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  updatedAt: string | null
}

export const EMPTY_ASSESSMENT: Assessment = {
  text: Object.fromEntries(ASSESSMENT_FIELDS.map((f) => [f, ''])) as AssessmentText,
  aiFields: [],
  aiDraftedAt: null,
  reviewedBy: null,
  reviewedAt: null,
  updatedAt: null,
}

const key = (loanId: string) => ['loanAssessment', loanId] as const

export function useAssessment(loanId: string) {
  return useQuery({
    queryKey: key(loanId),
    retry: false,
    queryFn: async (): Promise<Assessment | null> => {
      const r = await db().from('loan_assessments').select('*').eq('loan_id', loanId).maybeSingle()
      if (r.error) return null
      const x = r.data as Record<string, unknown> | null
      if (!x) return EMPTY_ASSESSMENT
      return {
        text: Object.fromEntries(ASSESSMENT_FIELDS.map((f) => [f, (x[f] as string | null) ?? ''])) as AssessmentText,
        aiFields: (x.ai_fields as AssessmentField[] | null) ?? [],
        aiDraftedAt: (x.ai_drafted_at as string | null) ?? null,
        reviewedBy: (x.reviewed_by as string | null) ?? null,
        reviewedAt: (x.reviewed_at as string | null) ?? null,
        updatedAt: (x.updated_at as string | null) ?? null,
      }
    },
  })
}

const rowOf = (t: AssessmentText) => Object.fromEntries(ASSESSMENT_FIELDS.map((f) => [f, t[f].trim() || null]))

/** Saves the text (a change after a review takes the review away, by the database). */
export function useSaveAssessment(loanId: string, organizationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { text: AssessmentText; aiFields: AssessmentField[] }) => {
      unwrap(await db().from('loan_assessments').upsert({ loan_id: loanId, organization_id: organizationId, ...rowOf(v.text), ai_fields: v.aiFields }).select('loan_id'))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key(loanId) }),
  })
}

/** The file's LO or an admin marks it reviewed (the database records who and when, and clears the AI marks). */
export function useReviewAssessment(loanId: string, organizationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (text: AssessmentText) => {
      unwrap(await db().from('loan_assessments').upsert({ loan_id: loanId, organization_id: organizationId, ...rowOf(text), reviewed_at: new Date().toISOString() }).select('loan_id'))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key(loanId) }),
  })
}

/** An AI draft of all eight fields from the profile (nothing saved here). */
export const draftAssessment = (loanId: string, profile: unknown) =>
  invokeAssistant<{ draft: AssessmentText; runId: string }>({ task: 'borrower_assessment', loanId, profile }, 'The AI draft failed. Try again, or write it yourself.')

/** Puts the draft into the empty fields only, and marks those as AI drafts. */
export function mergeDraft(current: Assessment, draft: AssessmentText): { text: AssessmentText; aiFields: AssessmentField[]; filled: AssessmentField[] } {
  const text = { ...current.text }
  const filled: AssessmentField[] = []
  for (const f of ASSESSMENT_FIELDS) {
    if (!text[f].trim() && draft[f]?.trim()) {
      text[f] = draft[f].trim()
      filled.push(f)
    }
  }
  return { text, aiFields: [...new Set([...current.aiFields, ...filled])], filled }
}
