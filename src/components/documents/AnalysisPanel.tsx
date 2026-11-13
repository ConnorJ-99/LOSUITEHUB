// Under each uploaded document on the Documents tab (Stage 3b): the analysis
// status, the suggested type (Use it / Dismiss), flags against the 1003, "Add
// this employer", what was read (with the words it came from) and Re-run.
// The AI only suggests; every change here is Connor's click.
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { incomeKindOf } from '@/lib/income/fromDocuments'
import { FEATURES } from '@/lib/features'
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, Loader2Icon, RotateCcwIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { confirmAction } from '@/components/shared'
import { useAddEmployerFromUpload, useAnalyses, useDecideKind, useRerunAnalysis, type Analysis } from '@/lib/api/analyses'
import type { LoanDocument } from '@/lib/api/documents'
import type { LoanProfile } from '@/lib/api/types'
import { formatCurrency } from '@/lib/format'
import { KIND_LABEL, READ_FIELDS, type ReadKind } from '../../../supabase/functions/assistant/documentRead'

const STATUS: Record<Analysis['status'], { label: string; tone: string }> = {
  queued: { label: 'Queued', tone: 'bg-muted text-muted-foreground' },
  analyzing: { label: 'Analyzing…', tone: 'bg-primary/10 text-primary' },
  ready: { label: 'Ready', tone: 'bg-emerald-50 text-emerald-700' },
  needs_review: { label: 'Needs review', tone: 'bg-amber-50 text-amber-800' },
  failed: { label: 'Failed', tone: 'bg-red-50 text-red-700' },
}

export function AnalysisPanel({ loan, doc }: { loan: LoanProfile; doc: LoanDocument }) {
  const analyses = useAnalyses(loan.id)
  const rerun = useRerunAnalysis(loan.id)
  const decide = useDecideKind(loan.id)
  const addJob = useAddEmployerFromUpload(loan.id)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const a = analyses.data?.get(doc.id)
  if (!a || !FEATURES.uploadReview) return null
  const fail = (e: Error) => toast.error(e.message)
  const s = STATUS[a.status]
  const waitingKey = a.status === 'queued' && a.lastError?.startsWith('Waiting for the AI key')
  const suggested = a.suggestedKind && a.suggestedKind !== doc.kind && a.kindDecision === null ? (a.suggestedKind as ReadKind) : null
  const employerFlag = a.flags.find((f) => f.code === 'employer_not_on_1003' && f.employer)
  const shownFlags = a.flags.filter((f) => f.code !== 'type_mismatch' || !suggested)
  const read = READ_FIELDS.filter((f) => a.fields[f.key])

  const addEmployer = async () => {
    if (!employerFlag?.employer || !doc.contactId) return
    if (!(await confirmAction(`Add ${employerFlag.employer} to this borrower's jobs on the 1003? Fill in the dates and income there afterwards.`, { confirmLabel: 'Add job' }))) return
    addJob.mutate({ analysis: a, organizationId: loan.organizationId, contactId: doc.contactId, employer: employerFlag.employer, current: true }, { onSuccess: () => toast.success(`${employerFlag.employer} added to the 1003 jobs`), onError: fail })
  }

  return (
    <div className="mt-1 ml-6 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', s.tone)}>
          {a.status === 'analyzing' ? <Loader2Icon className="size-3 animate-spin" /> : <SparklesIcon className="size-3" />}
          {waitingKey ? 'Waiting for the AI key' : s.label}
        </span>
        {a.status === 'queued' && a.lastError && !waitingKey && <span className="text-muted-foreground">Retrying: {a.lastError}</span>}
        {a.status === 'failed' && <span className="text-red-700">{a.lastError}</span>}
        {suggested && (
          <span className="inline-flex flex-wrap items-center gap-1">
            <span className="text-muted-foreground">
              Looks like a <span className="font-medium text-foreground">{KIND_LABEL[suggested] ?? suggested}</span>
              {a.kindConfidence && ` (${a.kindConfidence})`}
            </span>
            <Button size="xs" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ analysis: a, accept: true }, { onSuccess: () => toast.success('Type changed'), onError: fail })}>
              <CheckIcon />
              Use it
            </Button>
            <Button size="xs" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ analysis: a, accept: false }, { onError: fail })}>
              Dismiss
            </Button>
          </span>
        )}
        {!suggested && a.status === 'needs_review' && a.kindDecision === null && (
          <Button size="xs" variant="outline" disabled={decide.isPending} title="Takes it off Today's list; the flags stay here" onClick={() => decide.mutate({ analysis: a, accept: false }, { onSuccess: () => toast.success('Marked reviewed'), onError: fail })}>
            <CheckIcon />
            Mark reviewed
          </Button>
        )}
        {(a.status === 'ready' || a.status === 'needs_review' || a.status === 'failed') && (
          <Button size="xs" variant="ghost" disabled={rerun.isPending} onClick={() => rerun.mutate(a.id, { onSuccess: () => toast.success('Queued again. It runs within a minute.'), onError: fail })}>
            <RotateCcwIcon />
            Re-run analysis
          </Button>
        )}
        {FEATURES.incomeReview && (a.status === 'ready' || a.status === 'needs_review') && doc.contactId && incomeKindOf(doc.kind !== 'other' ? doc.kind : (a.suggestedKind ?? 'other')) && (
          <Button size="xs" variant="outline" title="Draft the income worksheet from this borrower's analyzed documents of this kind" onClick={() => navigate(`/loans/${loan.id}?tab=income&calculate=${incomeKindOf(doc.kind !== 'other' ? doc.kind : (a.suggestedKind ?? 'other'))}&contact=${doc.contactId}`)}>
            <SparklesIcon />
            Calculate income
          </Button>
        )}
        {read.length > 0 && (
          <button type="button" className="inline-flex items-center gap-0.5 text-primary hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            What it read ({read.length})
            <ChevronDownIcon className={cn('size-3 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {shownFlags.length > 0 && (
        <ul className="space-y-0.5">
          {shownFlags.map((f, i) => (
            <li key={i} className="flex items-start gap-1 text-amber-800">
              <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
              <span>
                {f.text}
                {f.code === 'employer_not_on_1003' && !a.employerJobId && (
                  <Button size="xs" variant="link" className="h-auto px-1 py-0 text-xs" disabled={!doc.contactId || addJob.isPending} title={doc.contactId ? undefined : 'Pick whose document this is first'} onClick={() => void addEmployer()}>
                    Add to the 1003
                  </Button>
                )}
                {f.code === 'employer_not_on_1003' && a.employerJobId && <span className="ml-1 text-emerald-700">Added to the 1003</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md border bg-muted/30 p-2">
          {read.map((f) => {
            const v = a.fields[f.key]!
            const shown = f.type === 'money' && typeof v.value === 'number' ? formatCurrency(v.value) : f.type === 'last4' ? `••${v.value}` : String(v.value)
            return (
              <div key={f.key} className="contents">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd>
                  {shown}
                  {v.quote && f.type !== 'last4' && <span className="text-muted-foreground"> · "{v.quote}"</span>}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </div>
  )
}
