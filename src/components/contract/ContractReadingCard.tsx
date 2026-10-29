import { useState } from 'react'
import { PencilIcon, SparklesIcon, TriangleAlertIcon, UndoIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { AiOffNote, AssistantLabel, Card, CurrencyInput, DateInput, NumberInput, Select, SourceQuote, ToggleChip, confirmAction } from '@/components/shared'
import { YesNo } from '@/components/urla/parts'
import { CONTRACT_FIELDS, type ContactRole, type ContractFieldKey } from '../../../supabase/functions/assistant/contract'
import { useAiStatus } from '@/lib/api/assistant'
import { useApplyReading, useDiscardReading, useLatestReading, useReadContract, type ContractReadingRecord } from '@/lib/api/contract'
import type { LoanProfile } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { formatIsoDate, relativeTime } from '@/lib/dates'
import { buildReview, defaultDecisions, displayValue, reviewChanges, reviewRecord, type Decision, type FileNow, type ReviewRow } from '@/lib/contract/review'

const ROLE_LABEL: Record<ContactRole, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  buyer_agent: "Buyer's agent",
  listing_agent: 'Listing agent',
  title: 'Title company',
  escrow_officer: 'Escrow officer',
}

type Decisions = Partial<Record<ContractFieldKey, Decision>>
type Value = number | string | boolean

/** Edits one term in its own units (days stay days; the deadline is worked out from them). */
function TermEditor({ row, onChange }: { row: ReviewRow; onChange: (v: Value) => void }) {
  const label = `${row.label} (as you read it)`
  switch (row.kind) {
    case 'money':
      return <CurrencyInput label={label} value={row.value as number} onChange={(v) => v !== null && onChange(v)} />
    case 'date':
      return <DateInput label={label} value={row.value as string} onChange={(v) => v && onChange(v)} />
    case 'days':
      return <NumberInput label={`${row.label} (days)`} value={row.value as number} onChange={(v) => v !== null && onChange(Math.max(0, Math.round(v)))} maxDecimals={0} />
    case 'choice': {
      const def = CONTRACT_FIELDS.find((f) => f.key === row.key)
      const options = ('choices' in def! ? def.choices : []).map((c) => ({ value: c, label: displayValue('choice', c) }))
      return <Select label={label} value={row.value as string} options={options} onChange={onChange} />
    }
    case 'yes_no':
      return <YesNo label={row.label} value={row.value as boolean} onChange={(v) => v !== null && onChange(v)} />
    default:
      return null
  }
}

function TermRow({ row, decision, onDecision }: { row: ReviewRow; decision: Decision | undefined; onDecision: (d: Decision) => void }) {
  const [editing, setEditing] = useState(false)
  const use = !!decision?.use && row.applicable && !row.same
  const low = row.field.confidence === 'low'
  return (
    <li className={cn('space-y-2 rounded-md border p-2.5', low && 'border-amber-300 bg-amber-50/50', !use && !low && 'bg-muted/30')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
            {row.field.confidence !== 'high' && <AssistantLabel confidence={row.field.confidence} />}
            {row.edited && <span className="text-[0.7rem] font-medium text-primary">Edited</span>}
          </div>
          {row.same ? (
            <p className="text-sm">
              {row.proposedLabel} <span className="text-xs text-muted-foreground">· already on file</span>
            </p>
          ) : row.key === 'property_address' ? (
            <p className="text-sm">
              {row.proposedLabel} <span className="text-xs text-muted-foreground">· file: {row.currentLabel}</span>
            </p>
          ) : (
            <p className="text-sm">
              <span className="text-muted-foreground line-through decoration-muted-foreground/50">{row.currentLabel === '—' ? 'empty' : row.currentLabel}</span>
              <span className="mx-1.5 text-muted-foreground">→</span>
              <span className="font-medium">{row.proposedLabel}</span>
            </p>
          )}
          {row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
          <SourceQuote sources={row.field.quote ? [{ label: `Contract says "${row.field.text}"`, quote: row.field.quote, page: row.field.page }] : []} />
        </div>
        {row.applicable && !row.same && (
          <div className="flex shrink-0 items-center gap-1.5">
            {row.kind !== 'text' && (
              <Button size="icon-sm" variant="ghost" aria-label={`Edit ${row.label}`} onClick={() => setEditing((e) => !e)}>
                <PencilIcon />
              </Button>
            )}
            {/* The label says what happens, so clicking it to "accept" can't quietly turn it off. */}
            <ToggleChip label={use ? 'Using' : 'Skipped'} pressed={use} onChange={(p) => onDecision({ ...decision, use: p })} />
          </div>
        )}
      </div>
      {editing && (
        <div className="flex flex-wrap items-end gap-2 border-t pt-2">
          <div className="min-w-48 flex-1">
            <TermEditor row={row} onChange={(v) => onDecision({ use: true, edited: v === row.field.value ? undefined : v })} />
          </div>
          {row.edited && (
            <Button size="sm" variant="ghost" onClick={() => onDecision({ use: decision?.use ?? true })}>
              <UndoIcon />
              Back to what was read
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function Review({ loan, app, reading, now }: { loan: LoanProfile; app: Application; reading: ContractReadingRecord; now: FileNow }) {
  const [decisions, setDecisions] = useState<Decisions>(() => defaultDecisions(reading.fields, now))
  const apply = useApplyReading(loan.id)
  const discard = useDiscardReading(loan.id)
  const rows = buildReview(reading.fields, now, decisions)
  const changes = reviewChanges(rows, decisions)
  const count = Object.keys(changes.details).length + (changes.earnestMoney !== undefined ? 1 : 0)
  const skipped = rows.filter((r) => r.applicable && !r.same).length - count
  const busy = apply.isPending || discard.isPending

  const submit = async () => {
    if (count === 0 && skipped > 0 && !(await confirmAction(`Nothing will be saved to the file: all ${skipped} change${skipped === 1 ? ' is' : 's are'} marked Skipped. Mark this reading reviewed anyway?`, { confirmLabel: 'Mark reviewed' }))) return
    const record = reviewRecord(rows, decisions)
    apply.mutate(
      { reading, app, ...changes, fields: record.fields, outcome: record.outcome },
      { onSuccess: () => toast.success(count ? `Saved ${count} contract term${count === 1 ? '' : 's'} to the file` : 'Reading reviewed; nothing changed'), onError: (e) => toast.error(e.message) },
    )
  }

  return (
    <Card
      title="Review the contract reading"
      description={`Read ${relativeTime(reading.createdAt)}. Nothing changes on the file until you apply it. Check each quote against the contract. Terms marked Using are saved when you apply; click one to skip it.`}
      action={<AssistantLabel />}
    >
      <div className="space-y-4">
        {reading.notes && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <p className="whitespace-pre-wrap">{reading.notes}</p>
          </div>
        )}
        <ul className="space-y-2">
          {rows.map((r) => (
            <TermRow key={r.key} row={r} decision={decisions[r.key]} onDecision={(d) => setDecisions((s) => ({ ...s, [r.key]: d }))} />
          ))}
        </ul>
        {reading.contacts.length > 0 && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <UsersIcon className="size-3.5" />
              People in the contract
            </p>
            <ul className="divide-y rounded-md border text-sm">
              {reading.contacts.map((c, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-x-3 px-3 py-1.5">
                  <span>
                    <span className="text-muted-foreground">{ROLE_LABEL[c.role]}: </span>
                    {c.name}
                    {c.company && <span className="text-muted-foreground"> · {c.company}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{[c.email, c.phone].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Adding these people to the file's team comes in the next part.</p>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={() => discard.mutate(reading, { onSuccess: () => toast.success('Reading set aside'), onError: (e) => toast.error(e.message) })} disabled={busy}>
            Set aside
          </Button>
          <Button onClick={submit} disabled={busy}>
            {apply.isPending ? 'Saving…' : count ? `Apply ${count} change${count === 1 ? '' : 's'}` : 'Mark reviewed'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

/**
 * The assistant's reading of the uploaded contract: a button to start one,
 * then the field-by-field review until it's applied or set aside.
 */
export function ContractReadingCard({ loan, app, now, hasDocuments }: { loan: LoanProfile; app: Application; now: FileNow; hasDocuments: boolean }) {
  const latest = useLatestReading(loan.id)
  const read = useReadContract(loan.id)
  const ai = useAiStatus()
  const reading = latest.data

  if (reading?.status === 'pending_review') return <Review key={reading.id} loan={loan} app={app} reading={reading} now={now} />
  if (ai.data?.ready === false)
    return (
      <Card title="Read the contract with the assistant" action={<AssistantLabel />}>
        <AiOffNote what="Reading contracts" reason={ai.data.reason} instead="Until then, type the terms into the Contract section on this tab; the checks and deadline tasks work the same." />
      </Card>
    )

  const start = () =>
    read.mutate(undefined, {
      onSuccess: () => toast.success('Contract read. Review it below.'),
      onError: (e) => toast.error(e.message),
    })
  return (
    <Card title="Read the contract with the assistant" description="It reads the uploaded contract and addenda and lists every term with a quote and page, for you to check before anything is saved." action={<AssistantLabel />}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {!hasDocuments
            ? 'Upload the executed contract first.'
            : reading
              ? `Last reading ${reading.status === 'applied' ? 'applied' : 'set aside'} ${reading.decidedAt ? formatIsoDate(reading.decidedAt.slice(0, 10)) : ''}.`
              : 'Takes about a minute. The documents are sent to Claude (Anthropic) to read.'}
        </p>
        <Button onClick={start} disabled={!hasDocuments || read.isPending}>
          <SparklesIcon />
          {read.isPending ? 'Reading… (about a minute)' : reading ? 'Read again' : 'Read contract'}
        </Button>
      </div>
    </Card>
  )
}
