import { useState } from 'react'
import { PencilIcon, SparklesIcon, TriangleAlertIcon, UndoIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { AiOffNote, AssistantLabel, Card, CurrencyInput, DateInput, Input, NumberInput, PercentInput, SourceQuote, TextArea, ToggleChip } from '@/components/shared'
import { NoteSavedButNotRead, useDecideNoteReading, useLatestCallNote, usePendingNoteReading, useSaveAndReadNote, useSaveCallNote, type NoteReadingRecord } from '@/lib/api/callNotes'
import { useAiStatus } from '@/lib/api/assistant'
import { useCreditEvents } from '@/lib/api/creditEvents'
import type { LoanProfile } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { relativeTime } from '@/lib/dates'
import type { PrequalDraft } from '@/lib/prequal/draft'
import { applyToDraft, buildNoteReview, defaultNoteDecisions, noteRecord, savedNow, type NoteDecisions, type NoteReviewFile, type NoteRow } from '@/lib/prequal/noteReview'

const DESTINATION_NOTE = { form: 'Fills the form', saved: 'Saved when applied', not_applied: "Can't be used yet" } as const

/** Edits the main value of an item, in its own units. */
function ItemEditor({ row, onChange }: { row: NoteRow; onChange: (edit: Record<string, unknown>) => void }) {
  const i = row.item
  switch (i.kind) {
    case 'credit_score':
      return <NumberInput label="Estimated credit score" value={i.value} onChange={(v) => v !== null && onChange({ value: Math.round(v) })} maxDecimals={0} />
    case 'purchase_price':
    case 'down_payment':
      return <CurrencyInput label={row.label} value={i.value} onChange={(v) => v !== null && onChange({ value: v })} />
    case 'down_payment_pct':
      return <PercentInput label="Down payment" value={i.value} onChange={(v) => v !== null && onChange({ value: v })} />
    case 'job':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <CurrencyInput label="Monthly income" value={i.monthly} onChange={(v) => onChange({ monthly: v })} />
          <DateInput label={i.selfEmployed ? 'Self-employed since' : 'Started'} value={i.startDate} onChange={(v) => onChange({ startDate: v })} />
        </div>
      )
    case 'other_income':
      return <CurrencyInput label="Monthly amount" value={i.monthly} onChange={(v) => v !== null && onChange({ monthly: v })} />
    case 'debt':
      return <CurrencyInput label="Monthly payment" value={i.monthlyPayment} onChange={(v) => v !== null && onChange({ monthlyPayment: v })} />
    case 'savings':
      return <CurrencyInput label="Amount" value={i.amount} onChange={(v) => v !== null && onChange({ amount: v })} />
    case 'home':
      return <CurrencyInput label="Worth" value={i.value} onChange={(v) => onChange({ value: v })} />
    case 'credit_event':
      return <DateInput label="Date" value={i.date} onChange={(v) => onChange({ date: v })} />
    case 'timeline':
      return <Input label="Timeline" value={i.value} onChange={(v) => onChange({ value: v })} />
    default:
      return null
  }
}

function ItemRow({ row, use, onUse, onEdit, onReset }: { row: NoteRow; use: boolean; onUse: (u: boolean) => void; onEdit: (e: Record<string, unknown>) => void; onReset: () => void }) {
  const [editing, setEditing] = useState(false)
  const usable = row.destination !== 'not_applied' && !row.same
  const low = row.item.confidence === 'low'
  const editable = !['loan_type', 'first_time_buyer', 'doc_type'].includes(row.item.kind)
  return (
    <li className={cn('space-y-2 rounded-md border p-2.5', low && usable && 'border-amber-300 bg-amber-50/50', !usable && 'bg-muted/30')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {row.label}
              {row.person && ` · ${row.person}`}
            </span>
            {row.item.confidence !== 'high' && <AssistantLabel confidence={row.item.confidence} />}
            {row.edited && <span className="text-[0.7rem] font-medium text-primary">Edited</span>}
            {usable && <span className="text-[0.7rem] text-muted-foreground">{DESTINATION_NOTE[row.destination]}</span>}
          </div>
          {row.same ? (
            <p className="text-sm">
              {row.proposedLabel} <span className="text-xs text-muted-foreground">· already on file</span>
            </p>
          ) : (
            <p className="text-sm">
              {row.currentLabel !== '—' && (
                <>
                  <span className="text-muted-foreground line-through decoration-muted-foreground/50">{row.currentLabel}</span>
                  <span className="mx-1.5 text-muted-foreground">→</span>
                </>
              )}
              <span className="font-medium">{row.proposedLabel}</span>
            </p>
          )}
          {row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
          {!row.item.quoteFound && <p className="text-xs text-amber-800">This quote isn't in the note word for word; check it.</p>}
          <SourceQuote sources={row.item.quote ? [{ label: 'From your notes', quote: row.item.quote }] : []} />
        </div>
        {usable && (
          <div className="flex shrink-0 items-center gap-1.5">
            {editable && (
              <Button size="icon-sm" variant="ghost" aria-label={`Edit ${row.label}`} onClick={() => setEditing((e) => !e)}>
                <PencilIcon />
              </Button>
            )}
            {/* The label says what happens, so clicking it to "accept" can't quietly turn it off. */}
            <ToggleChip label={use ? 'Using' : 'Skipped'} pressed={use} onChange={onUse} />
          </div>
        )}
      </div>
      {editing && (
        <div className="flex flex-wrap items-end gap-2 border-t pt-2">
          <div className="min-w-48 flex-1">
            <ItemEditor row={row} onChange={onEdit} />
          </div>
          {row.edited && (
            <Button size="sm" variant="ghost" onClick={onReset}>
              <UndoIcon />
              Back to what was read
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function NoteReview({ loan, reading, draft, file, onApply }: { loan: LoanProfile; reading: NoteReadingRecord; draft: PrequalDraft; file: NoteReviewFile; onApply: (next: PrequalDraft) => void }) {
  const [decisions, setDecisions] = useState<NoteDecisions>(() => defaultNoteDecisions(reading.items, draft, file))
  const decide = useDecideNoteReading(loan.id, loan.organizationId)
  const rows = buildNoteReview(reading.items, draft, file, decisions)
  const using = rows.filter((r) => decisions[r.item.id]?.use && r.destination !== 'not_applied' && !r.same)
  const set = (id: string, d: NoteDecisions[string]) => setDecisions((s) => ({ ...s, [id]: d }))

  const apply = () => {
    const record = noteRecord(rows, decisions)
    const next = applyToDraft(draft, rows, decisions)
    decide.mutate(
      { reading, status: 'applied', items: record.items, outcome: record.outcome, saveNow: savedNow(rows, decisions) },
      {
        onSuccess: () => {
          onApply(next)
          toast.success(using.some((r) => r.destination === 'form') ? 'Filled in the form. Check the results, then Save.' : 'Saved.')
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <Card title="Review the call notes reading" description={`Read ${relativeTime(reading.createdAt)}. Nothing changes until you apply it. Check each quote against your notes. Items marked Using are applied; click one to skip it.`} action={<AssistantLabel />}>
      <div className="space-y-3">
        {reading.notes && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <p className="whitespace-pre-wrap">{reading.notes}</p>
          </div>
        )}
        <ul className="space-y-2">
          {rows.map((r) => (
            <ItemRow
              key={r.item.id}
              row={r}
              use={!!decisions[r.item.id]?.use}
              onUse={(u) => set(r.item.id, { ...decisions[r.item.id], use: u })}
              onEdit={(e) => set(r.item.id, { use: true, edited: { ...decisions[r.item.id]?.edited, ...e } })}
              onReset={() => set(r.item.id, { use: decisions[r.item.id]?.use ?? true })}
            />
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          <Button variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ reading, status: 'discarded', outcome: 'dismissed' }, { onSuccess: () => toast.success('Reading set aside'), onError: (e) => toast.error(e.message) })}>
            Set aside
          </Button>
          <Button onClick={apply} disabled={decide.isPending || using.length === 0}>
            {decide.isPending ? 'Applying…' : `Apply ${using.length} item${using.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </Card>
  )
}

/**
 * Call notes at the top of the Prequal tab: type or paste notes from the
 * call, the assistant reads them, and the review fills in the form below.
 */
export function CallNotes({ loan, app, draft, onApply }: { loan: LoanProfile; app: Application; draft: PrequalDraft; onApply: (next: PrequalDraft) => void }) {
  const primary = app.borrowers.find((b) => b.role === 'primary') ?? app.borrowers[0]
  const pending = usePendingNoteReading(loan.id)
  const latest = useLatestCallNote(primary.contactId)
  const events = useCreditEvents(loan.id, app.borrowers.map((b) => b.contactId))
  const read = useSaveAndReadNote(loan.id, loan.organizationId, primary.contactId)
  const save = useSaveCallNote(loan.id, loan.organizationId, primary.contactId)
  const ai = useAiStatus()
  const aiOff = ai.data?.ready === false
  const [text, setText] = useState('')

  const file: NoteReviewFile = {
    isPurchase: loan.purpose === 'purchase',
    details: { incomeDocType: loan.details.incomeDocType, timeline: loan.details.timeline },
    creditEvents: events.data ?? [],
    ownedPast3Years: Object.fromEntries(app.borrowers.map((b) => [b.contactId, b.declarations.ownedPropertyPast3Years])),
  }
  const start = (input: { body?: string; noteId?: string }) =>
    read.mutate(input, {
      onSuccess: () => {
        setText('')
        toast.success('Notes read. Review them below.')
      },
      onError: (e) => {
        if (e instanceof NoteSavedButNotRead) setText('')
        toast.error(e.message)
      },
    })

  return (
    <div className="space-y-4">
      <Card title="Call notes" description="Type or paste your notes from the call. They're saved as a call note; the assistant reads them and you choose what to use." action={<AssistantLabel />}>
        <div className="space-y-2">
          <TextArea label="Notes" value={text} onChange={setText} rows={4} placeholder="e.g. Marcus, landscaping biz 6 yrs, ~$9,800/mo, house worth 467, owes 282, 652 credit, one late on truck 2024" />
          {aiOff && <AiOffNote what="Reading call notes into the Prequal form" reason={ai.data?.reason} instead="Until then, save the note here and fill in the Prequal form below by hand." />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {aiOff ? (
                'Saved as a call note on the borrower.'
              ) : latest.data && !text.trim() ? (
                <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={read.isPending} onClick={() => start({ noteId: latest.data!.id })}>
                  Read the last call note ({relativeTime(latest.data.created_at)}) again
                </button>
              ) : (
                'The note is sent to Claude (Anthropic) to read. No SSNs or account numbers.'
              )}
            </p>
            {aiOff ? (
              <Button onClick={() => save.mutate(text, { onSuccess: () => (setText(''), toast.success('Call note saved')), onError: (e) => toast.error(e.message) })} disabled={save.isPending || !text.trim()}>
                {save.isPending ? 'Saving…' : 'Save note'}
              </Button>
            ) : (
              <Button onClick={() => start({ body: text })} disabled={read.isPending || !text.trim()}>
                <SparklesIcon />
                {read.isPending ? 'Reading…' : 'Save note and read'}
              </Button>
            )}
          </div>
        </div>
      </Card>
      {pending.data && <NoteReview key={pending.data.id} loan={loan} reading={pending.data} draft={draft} file={file} onApply={onApply} />}
    </div>
  )
}
