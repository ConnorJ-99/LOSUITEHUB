import { CheckIcon, MinusIcon } from 'lucide-react'
import { cn } from 'cn'
import type { AnswerField, AnswersView, SubmissionOutcome } from '@/lib/api/webForms'

/** Outcome chip colors: new leads red, returning clients blue, partners green. */
const OUTCOME_TONE: Record<SubmissionOutcome, string> = {
  new_lead: 'bg-urgent/10 text-urgent',
  existing_open_loan: 'bg-muted text-muted-foreground',
  new_loan_existing_person: 'bg-primary/10 text-primary',
  partner_inquiry: 'bg-nurture/10 text-nurture',
  form_update: 'bg-muted text-muted-foreground',
}

export function OutcomeChip({ outcome, label }: { outcome: SubmissionOutcome; label: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-[0.7rem] font-medium whitespace-nowrap', OUTCOME_TONE[outcome])}>{label}</span>
}

/** "MR" for Marcus Reyes. */
export function Initials({ name, partner }: { name: string; partner?: boolean }) {
  const letters = name
    .split(/\s+/)
    .filter((w) => /^[a-z]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
  return <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white', partner ? 'bg-nurture' : 'bg-navy')}>{letters || '?'}</span>
}

/** A label over a bold value; dollar amounts in gold. */
export function AnswerTile({ field, className }: { field: AnswerField; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-lg border bg-card px-3 py-2', className)}>
      <p className="truncate text-xs text-muted-foreground">{field.label}</p>
      <p className={cn('font-semibold break-words tabular-nums', field.money && 'text-money')}>{field.value}</p>
      {field.sub && <p className="text-xs text-muted-foreground">{field.sub}</p>}
    </div>
  )
}

export function TheirNote({ note }: { note: string }) {
  return (
    <div className="rounded-md border-l-[3px] border-money bg-money/10 px-3 py-2">
      <p className="text-[0.7rem] font-semibold tracking-wide text-money uppercase">Their note</p>
      <p className="text-sm whitespace-pre-line">{note}</p>
    </div>
  )
}

function SectionHead({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <p className="text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

/** The answers grouped by meaning: the loan, them, quick checks, their note, other. Empty groups are skipped. */
export function AnswerGroups({ view }: { view: AnswersView }) {
  const loan = view.sections.find((s) => s.id === 'loan')
  const rest = view.sections.filter((s) => s.id !== 'loan')
  const grid = (fields: AnswerField[]) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {fields.map((f) => (
        <AnswerTile key={f.key} field={f} />
      ))}
    </div>
  )
  if (!view.sections.length && !view.checks.length && !view.note) return <p className="text-sm text-muted-foreground">No other answers.</p>
  return (
    <div className="space-y-3">
      {loan && (
        <>
          <SectionHead title={loan.title} />
          {grid(loan.fields)}
        </>
      )}
      {rest
        .filter((s) => s.id === 'them')
        .map((s) => (
          <div key={s.id} className="space-y-3">
            <SectionHead title={s.title} />
            {grid(s.fields)}
          </div>
        ))}
      {view.checks.length > 0 && (
        <>
          <SectionHead title="Quick checks" />
          <div className="flex flex-wrap gap-2">
            {view.checks.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-sm">
                {c.ok ? <CheckIcon className="size-3.5 text-nurture" /> : <MinusIcon className="size-3.5 text-muted-foreground" />}
                {c.label}
              </span>
            ))}
          </div>
        </>
      )}
      {view.note && (
        <>
          <SectionHead title="Their note" />
          <TheirNote note={view.note} />
        </>
      )}
      {rest
        .filter((s) => s.id === 'other')
        .map((s) => (
          <div key={s.id} className="space-y-3">
            <SectionHead title={s.title} />
            {grid(s.fields)}
          </div>
        ))}
    </div>
  )
}
