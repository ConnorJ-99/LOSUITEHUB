import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangleIcon, CheckIcon, FileUpIcon, InfoIcon, SparklesIcon, UndoIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, confirmAction, TextArea } from '@/components/shared'
import { openRequestDocuments } from '@/components/documents/RequestDocumentsHost'
import { useAiStatus } from '@/lib/api/assistant'
import { useAcceptIntake, useReturnIntake, useWriteIntakeSummary, type Intake } from '@/lib/api/intake'
import { summarizeIntake, type IntakeSummary } from '@/lib/intake/review'
import { doneSections, SECTIONS } from '@/lib/intake/sections'

const usd = (n: number | null) => (n == null ? '—' : n >= 10_000 ? `~$${Math.round(n / 1000)}k` : `$${Math.round(n).toLocaleString('en-US')}`)
const GOAL: Record<string, string> = { purchase: 'Purchase', refinance: 'Refinance', equity: 'Equity / cash out', other: 'Other' }

/**
 * The loan officer's review of a submitted intake (LO Assistant step 5, Connor 2026-11-17):
 * the AI summary (when the assistant is on), the numbers and flags worked out in code, missing
 * docs with Request via document gatherer, and Accept / Send back / Open full answers.
 */
export function IntakeReview({ intake, borrowerName, borrowerId, interviewerFirst, onOpenAnswers }: { intake: Intake; borrowerName: string; borrowerId: string | null; interviewerFirst: string; onOpenAnswers: () => void }) {
  const navigate = useNavigate()
  const ai = useAiStatus()
  const writeSummary = useWriteIntakeSummary(intake.loanId)
  const accept = useAcceptIntake()
  const sendBack = useReturnIntake(intake.loanId)
  const [returning, setReturning] = useState(false)
  const [question, setQuestion] = useState('')

  // The numbers and flags are always worked out from the answers; the paragraph comes from the saved summary.
  const facts = summarizeIntake(intake.answers)
  const saved = (intake.summary ?? null) as Partial<IntakeSummary> | null
  const paragraph = saved?.summary_paragraph ?? null
  const headline = saved?.headline || facts.headline
  const k = facts.key_numbers
  const decided = intake.status !== 'submitted'
  const goal = GOAL[String((intake.answers.goal as Record<string, unknown> | undefined)?.goal ?? '')]

  const doAccept = async () => {
    if (!(await confirmAction(`Accept this intake? Its answers fill the file's blank fields (nothing you've typed is replaced)${facts.flags.length ? `, and the ${facts.flags.length} flag(s) stay for you to work` : ''}. A new lead moves to Contacted.`, { confirmLabel: 'Accept → Pre-qual' }))) return
    accept.mutate(
      { intake, note: null },
      {
        onSuccess: (r) => {
          const added = [r.jobs && `${r.jobs} job(s)`, r.otherIncome && `${r.otherIncome} other income`, r.assets && `${r.assets} account(s)`, r.debts && `${r.debts} debt(s)`, r.realtor && 'the realtor'].filter(Boolean)
          toast.success(`Intake accepted${added.length ? `. Added: ${added.join(', ')}` : ''}${r.movedToContacted ? '. Moved to Contacted.' : '.'}`)
          navigate(`/loans/${intake.loanId}?tab=1003`)
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  const kpis: [string, string, string | null][] = [
    ['Price (reported)', usd(k.price), null],
    ['Down', usd(k.down_payment), null],
    ['Target payment', k.target_payment != null ? `≤ ${usd(k.target_payment)}` : '—', k.current_housing != null ? `rent now ${usd(k.current_housing)}` : null],
    ['Score (self-reported)', k.reported_score != null ? `~${k.reported_score}` : '—', null],
    ['Monthly income', usd(k.monthly_income_reported), facts.breakdown.income.length ? `${facts.breakdown.income.length} stream(s)` : null],
    ['Monthly debts', usd(k.monthly_debts_reported), null],
  ]
  const rows: [string, string | string[]][] = [
    ['Goal & property', facts.breakdown.goal_property],
    ['Income', facts.breakdown.income],
    ['Debts', facts.breakdown.debts],
    ['Assets & funds', facts.breakdown.assets_funds],
    ['Credit events', facts.breakdown.credit_events],
    ['Realtor / source', facts.breakdown.realtor_source],
    ['Borrower concerns', facts.breakdown.borrower_concerns],
  ]

  return (
    <>
      <div className="mb-4">
        <h2 className="text-lg font-bold tracking-tight">
          {borrowerName} — intake from {interviewerFirst || 'your assistant'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {intake.submittedAt ? `Submitted ${new Date(intake.submittedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Not submitted'} · {doneSections(intake.answers).length} of {SECTIONS.length} sections
          {intake.partialReason && ` · partial: ${intake.partialReason}`}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {goal && <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{goal}</span>}
          <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', facts.urgency.level === 'time_sensitive' ? 'bg-amber-100 text-amber-900' : 'bg-muted text-muted-foreground')}>
            {facts.urgency.level === 'time_sensitive' ? `Time-sensitive${facts.urgency.reason ? ` · ${facts.urgency.reason}` : ''}` : 'Routine'}
          </span>
          {intake.status === 'accepted' && <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Accepted</span>}
          {intake.status === 'returned' && <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">Sent back: {intake.reviewNote}</span>}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map(([label, value, sub]) => (
          <div key={label} className="rounded-lg border bg-card px-3 py-2">
            <p className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card
            title="Summary for you"
            description={paragraph ? `Generated from ${interviewerFirst || 'the'}'s answers` : undefined}
            action={
              !paragraph && ai.data?.ready ? (
                <Button size="xs" variant="outline" disabled={writeSummary.isPending} onClick={() => writeSummary.mutate({ intake, aiReady: true }, { onSuccess: (r) => (r.aiError ? toast.error(r.aiError) : toast.success('Summary written')), onError: (e) => toast.error(e.message) })}>
                  <SparklesIcon />
                  {writeSummary.isPending ? 'Writing…' : 'Write summary'}
                </Button>
              ) : undefined
            }
          >
            <p className="font-medium">{headline}</p>
            {paragraph ? (
              <p className="mt-2 text-sm">{paragraph}</p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{ai.data?.ready ? 'No AI summary yet. The facts below are worked out from the answers.' : 'The AI summary turns on once the assistant key is added. The facts below are worked out from the answers.'}</p>
            )}
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">{facts.rough_dti_note}</p>
          </Card>

          <Card title="Breakdown">
            <dl className="divide-y text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="grid gap-1 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{Array.isArray(value) ? value.length ? value.map((v) => <p key={v}>{v}</p>) : '—' : value || '—'}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Flags for your review">
            {facts.flags.length ? (
              <ul className="space-y-1.5 text-sm">
                {facts.flags.map((f) => (
                  <li key={f.text} className="flex gap-2">
                    {f.severity === 'review' ? <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                    {f.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None from the answers.</p>
            )}
          </Card>
          <Card title="Missing docs">
            {facts.missing_docs.length ? (
              <ul className="list-inside list-disc text-sm">
                {facts.missing_docs.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None recorded.</p>
            )}
            {facts.open_questions.length > 0 && (
              <>
                <p className="mt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Open questions</p>
                <ul className="list-inside list-disc text-sm">
                  {facts.open_questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </>
            )}
            {facts.missing_docs.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                onClick={() => openRequestDocuments(intake.loanId, null, { items: facts.missing_docs.map((label) => ({ key: null, label, instructions: '', kind: 'other', conditionId: null })), contactId: borrowerId })}
              >
                <FileUpIcon />
                Request via document gatherer
              </Button>
            )}
          </Card>
          <Card title="Your decision">
            <div className="space-y-2">
              {!decided && (
                <>
                  <Button className="w-full" disabled={accept.isPending} onClick={() => void doAccept()}>
                    <CheckIcon />
                    {accept.isPending ? 'Accepting…' : 'Accept → move to Pre-qual'}
                  </Button>
                  <Button className="w-full" variant="outline" onClick={() => setReturning(true)}>
                    <UndoIcon />
                    Send back to {interviewerFirst || 'the interviewer'} with a question
                  </Button>
                </>
              )}
              <Button className="w-full" variant="ghost" onClick={onOpenAnswers}>
                Open full answers
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={returning} onOpenChange={setReturning}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send back to {interviewerFirst || 'the interviewer'}</DialogTitle>
            <DialogDescription>They get it on their Today page and a notification, and the intake opens for edits again.</DialogDescription>
          </DialogHeader>
          <TextArea label="Your question" value={question} onChange={setQuestion} rows={3} placeholder="e.g. How much is the gift, and from whom?" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReturning(false)}>
              Cancel
            </Button>
            <Button
              disabled={!question.trim() || sendBack.isPending}
              onClick={() =>
                sendBack.mutate(
                  { id: intake.id, note: question.trim() },
                  {
                    onSuccess: () => {
                      toast.success(`Sent back to ${interviewerFirst || 'the interviewer'}`)
                      setReturning(false)
                    },
                    onError: (e) => toast.error(e.message),
                  },
                )
              }
            >
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
