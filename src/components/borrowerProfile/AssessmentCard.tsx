// The Loan Officer Assessment on the Borrower Profile (Stage 2, Connor
// 2026-11-24). Eight fields anyone on the file can edit; "Draft with AI"
// fills only the empty ones from the profile and marks them "AI draft"; the
// file's loan officer or an admin presses "Mark reviewed" (recorded by the
// database). Editing after a review means it needs a review again. Only a
// reviewed assessment goes on a finished PDF (Stage 3).
import { useState } from 'react'
import { CheckCircle2Icon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, TextArea, confirmAction } from '@/components/shared'
import { ASSESSMENT_FIELDS, ASSESSMENT_LABEL, INTERNAL_ONLY, draftAssessment, mergeDraft, useAssessment, useReviewAssessment, useSaveAssessment, type Assessment, type AssessmentField } from '@/lib/api/assessment'
import { useFileRole } from '@/lib/api/fileRole'
import { useProfile } from '@/lib/api/settings'
import type { LoanProfile } from '@/lib/api/types'
import { formatIsoDate } from '@/lib/dates'

const HINT: Partial<Record<AssessmentField, string>> = {
  underwriting: 'Internal only. Never on a borrower-facing document.',
  concerns: 'Internal only.',
  borrower_recommendations: 'Written to the borrower; can go on the Pre-Qualification Report.',
  outstanding_docs: 'One per line.',
  next_steps: 'Numbered steps toward pre-approval.',
}

export function AssessmentCard({ loan, profile }: { loan: LoanProfile; profile: unknown }) {
  const saved = useAssessment(loan.id)
  if (saved.isLoading) return null
  if (saved.data === null)
    return (
      <Card title="Loan officer assessment">
        <p className="text-sm text-muted-foreground">Run the assessment script (20270309000000_loan_assessments.sql) to use the assessment.</p>
      </Card>
    )
  return <Form key={saved.data!.updatedAt ?? 'new'} loan={loan} saved={saved.data!} profile={profile} />
}

function Form({ loan, saved, profile }: { loan: LoanProfile; saved: Assessment; profile: unknown }) {
  const [text, setText] = useState(saved.text)
  const [aiFields, setAiFields] = useState(saved.aiFields)
  const [drafting, setDrafting] = useState(false)
  const save = useSaveAssessment(loan.id, loan.organizationId)
  const review = useReviewAssessment(loan.id, loan.organizationId)
  const role = useFileRole(loan.id)
  const reviewer = useProfile(saved.reviewedBy)
  const canReview = role.role === 'lo' || role.role === 'admin'
  const dirty = JSON.stringify(text) !== JSON.stringify(saved.text) || JSON.stringify(aiFields) !== JSON.stringify(saved.aiFields)
  const empty = ASSESSMENT_FIELDS.filter((f) => !text[f].trim())
  const reviewed = !!saved.reviewedAt && !dirty

  const draft = async () => {
    setDrafting(true)
    try {
      const r = await draftAssessment(loan.id, profile)
      const merged = mergeDraft({ ...saved, text, aiFields }, r.draft)
      if (!merged.filled.length) return toast.info('Every field already has text; nothing was replaced.')
      setText(merged.text)
      setAiFields(merged.aiFields)
      save.mutate({ text: merged.text, aiFields: merged.aiFields }, { onError: (e) => toast.error(e.message) })
      toast.success(`AI drafted ${merged.filled.length} field${merged.filled.length === 1 ? '' : 's'}. Review before using them.`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDrafting(false)
    }
  }
  const markReviewed = async () => {
    if (aiFields.length && !(await confirmAction(`${aiFields.length} field${aiFields.length === 1 ? ' is' : 's are'} still an AI draft. Mark the whole assessment reviewed?`, { confirmLabel: 'Mark reviewed' }))) return
    review.mutate(text, { onSuccess: () => toast.success('Assessment reviewed'), onError: (e) => toast.error(e.message) })
  }

  return (
    <Card
      title="Loan officer assessment"
      description={
        reviewed
          ? undefined
          : 'Edit any field. AI drafts are marked until you review them; only a reviewed assessment goes on a finished document.'
      }
      action={
        <Button size="sm" variant="outline" disabled={drafting || empty.length === 0} onClick={() => void draft()} title={empty.length ? 'Fills the empty fields only' : 'Every field has text'}>
          <SparklesIcon /> {drafting ? 'Drafting…' : 'Draft with AI'}
        </Button>
      }
    >
      <p className={cn('mb-3 flex items-center gap-1.5 text-sm', reviewed ? 'text-emerald-700' : 'text-amber-800')}>
        {reviewed ? (
          <>
            <CheckCircle2Icon className="size-4" /> Reviewed by {reviewer.data?.fullName ?? 'the loan officer'} on {formatIsoDate(saved.reviewedAt!.slice(0, 10))}
          </>
        ) : saved.reviewedAt && dirty ? (
          'Changed since the review: save and review again.'
        ) : (
          'Not reviewed yet.'
        )}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {ASSESSMENT_FIELDS.map((f) => (
          <div key={f} className={cn(f === 'overview' && 'md:col-span-2')}>
            <TextArea
              label={`${ASSESSMENT_LABEL[f]}${aiFields.includes(f) ? ' · AI draft' : ''}${INTERNAL_ONLY.includes(f) ? ' · internal' : ''}`}
              value={text[f]}
              rows={f === 'overview' ? 3 : 4}
              maxLength={4000}
              hint={HINT[f]}
              onChange={(v) => setText((t) => ({ ...t, [f]: v }))}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {dirty && (
          <>
            <Button size="sm" variant="outline" onClick={() => (setText(saved.text), setAiFields(saved.aiFields))}>
              Discard
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ text, aiFields }, { onSuccess: () => toast.success('Assessment saved'), onError: (e) => toast.error(e.message) })}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        )}
        {canReview && !reviewed && (
          <Button size="sm" variant={dirty ? 'outline' : 'default'} disabled={review.isPending || ASSESSMENT_FIELDS.every((f) => !text[f].trim())} onClick={() => void markReviewed()}>
            <CheckCircle2Icon /> {dirty ? 'Save and mark reviewed' : 'Mark reviewed'}
          </Button>
        )}
      </div>
      {!canReview && role.ready && <p className="mt-2 text-xs text-muted-foreground">The file's loan officer or an admin marks the assessment reviewed.</p>}
    </Card>
  )
}
