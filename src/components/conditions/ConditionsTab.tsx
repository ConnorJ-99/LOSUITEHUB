import { useState } from 'react'
import { ClipboardPasteIcon, FileUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { openRequestDocuments } from '@/components/documents/RequestDocumentsHost'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, EmptyState, TextArea, confirmAction } from '@/components/shared'
import { useAddConditions, useConditions, useDeleteCondition, useUpdateCondition, type ConditionChanges } from '@/lib/api/conditions'
import { useMarkStep } from '@/lib/api/loanfile'
import type { LoanProfile } from '@/lib/api/types'
import { todayIso } from '@/lib/dates'
import { CONDITION_PARTIES, CONDITION_STATUSES, conditionCounts, guessParty, splitConditions, type Condition, type ConditionParty, type ConditionStatus } from '@/lib/loanfile/conditions'
import type { StepResult } from '@/lib/loanfile/workflow'
import type { Flagged } from '@/lib/conditions/suggest'
import { FlaggedNote, SuggestedConditions, useConditionSuggestions } from './SuggestedConditions'

const STATUS_CLASS: Record<ConditionStatus, string> = {
  outstanding: 'border-amber-200 bg-amber-50 text-amber-900',
  requested: 'border-sky-200 bg-sky-50 text-sky-900',
  received: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  submitted: 'border-primary/30 bg-accent text-accent-foreground',
  cleared: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  waived: 'border-border bg-muted text-muted-foreground',
}
const control = 'h-8 rounded-md border px-2 text-xs focus:border-ring focus:outline-none'
const partyLabel = (p: ConditionParty) => CONDITION_PARTIES.find((x) => x.value === p)?.label ?? p

/**
 * Underwriting conditions on the file, tracked here (documents are handled
 * with the lender). Paste the lender's list to split it into rows. When every
 * condition is Submitted, Cleared or Waived, the Workflow's "Submit
 * conditions" step is marked done, the same as clicking it. Suggested
 * conditions (Phase 8) from the checklist rules sit above the list.
 */
export function ConditionsTab({ loan, step }: { loan: LoanProfile; step: StepResult | null }) {
  const conditions = useConditions(loan.id)
  const add = useAddConditions(loan.id, loan.organizationId)
  const update = useUpdateCondition(loan.id)
  const remove = useDeleteCondition(loan.id)
  const markStep = useMarkStep(loan.id, loan.organizationId)
  const [pasting, setPasting] = useState(false)
  const [draft, setDraft] = useState('')
  const list = conditions.data ?? []
  const counts = conditionCounts(list.map((c) => c.status))
  const lastPosition = list.reduce((m, c) => Math.max(m, c.position), 0)
  const onBorrower = list.filter((c) => c.party === 'borrower' && !['submitted', 'cleared', 'waived'].includes(c.status)).length
  const suggested = useConditionSuggestions(loan, conditions.data)
  const flagOf = new Map<string, Flagged>((suggested?.flagged ?? []).map((f) => [f.conditionId, f]))

  const change = (c: Condition, changes: ConditionChanges) =>
    update.mutate(
      { id: c.id, changes },
      {
        onSuccess: () => {
          if (changes.status === undefined || !step || step.status === 'done' || step.status === 'na') return
          const after = conditionCounts(list.map((x) => (x.id === c.id ? changes.status! : x.status)))
          if (after.allHandedIn)
            markStep.mutate({ step, status: 'done', doneOn: todayIso() }, { onSuccess: () => toast.success('Every condition is in: "Submit conditions" is done'), onError: (e) => toast.error(e.message) })
        },
        onError: (e) => toast.error(e.message),
      },
    )

  const addOne = () => {
    const body = draft.trim()
    if (!body) return
    add.mutate({ items: [{ body, party: guessParty(body) }], after: lastPosition }, { onSuccess: () => setDraft(''), onError: (e) => toast.error(e.message) })
  }

  return (
    <Card
      title="Conditions"
      description={list.length ? `${counts.cleared} of ${counts.total} cleared${onBorrower ? ` · ${onBorrower} still on the borrower` : ''}` : 'Track the lender’s conditions: who each is on and where it stands. No uploads here.'}
      action={
        <Button size="sm" variant="outline" onClick={() => setPasting(true)}>
          <ClipboardPasteIcon />
          Paste conditions
        </Button>
      }
    >
      {suggested && loan.stage !== 'closed' && <SuggestedConditions loan={loan} suggestions={suggested.suggestions} lastPosition={lastPosition} />}
      {conditions.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : conditions.error ? (
        <p className="text-sm text-destructive">{conditions.error.message}</p>
      ) : list.length === 0 ? (
        <EmptyState title="No conditions yet" description="Paste the lender's condition list, or add them one at a time below." />
      ) : (
        <ol className="divide-y">
          {list.map((c, i) => (
            <ConditionRow key={c.id} n={i + 1} c={c} flag={flagOf.get(c.id)} onRequestDocs={() => openRequestDocuments(loan.id, c.id)} busy={update.isPending} onChange={(changes) => change(c, changes)} onRemove={async () => (await confirmAction('Remove this condition?', { confirmLabel: 'Remove', destructive: true })) && remove.mutate(c.id, { onError: (e) => toast.error(e.message) })} />
          ))}
        </ol>
      )}

      <div className="mt-3 flex gap-2 border-t pt-3">
        <input
          aria-label="New condition"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addOne()}
          placeholder="Add a condition"
          className="h-9 min-w-0 flex-1 rounded-md border px-3 text-sm focus:border-ring focus:outline-none"
        />
        <Button size="sm" onClick={addOne} disabled={!draft.trim() || add.isPending}>
          <PlusIcon />
          Add
        </Button>
      </div>

      {pasting && <PasteDialog onClose={() => setPasting(false)} onAdd={(items) => add.mutate({ items, after: lastPosition }, { onSuccess: () => (toast.success(`Added ${items.length} condition${items.length === 1 ? '' : 's'}`), setPasting(false)), onError: (e) => toast.error(e.message) })} busy={add.isPending} />}
    </Card>
  )
}

function ConditionRow({ n, c, flag, busy, onChange, onRemove, onRequestDocs }: { n: number; c: Condition; flag: Flagged | undefined; busy: boolean; onChange: (changes: ConditionChanges) => void; onRemove: () => void; onRequestDocs: () => void }) {
  return (
    <li className="grid gap-2 py-3 md:grid-cols-[1.5rem_minmax(0,1fr)_auto]">
      <span className="pt-1.5 text-xs text-muted-foreground tabular-nums">{n}.</span>
      <div className="min-w-0 space-y-2">
        <textarea
          key={c.body}
          aria-label={`Condition ${n}`}
          defaultValue={c.body}
          rows={1}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.body && onChange({ body: e.target.value })}
          className={cn('field-sizing-content w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-1 text-sm hover:border-border focus:border-ring focus:outline-none', (c.status === 'cleared' || c.status === 'waived') && 'text-muted-foreground line-through decoration-muted-foreground/40')}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Status" value={c.status} disabled={busy} onChange={(e) => onChange({ status: e.target.value as ConditionStatus })} className={cn(control, 'font-medium', STATUS_CLASS[c.status])}>
            {CONDITION_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select aria-label="Who it's on" value={c.party} onChange={(e) => onChange({ party: e.target.value as ConditionParty })} className={cn(control, 'bg-card')}>
            {CONDITION_PARTIES.map((p) => (
              <option key={p.value} value={p.value}>
                On {p.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Due
            <input type="date" aria-label="Due date" value={c.dueOn ?? ''} onChange={(e) => onChange({ dueOn: e.target.value || null })} className={cn(control, 'bg-card text-foreground')} />
          </label>
          <input
            key={c.notes ?? ''}
            aria-label="Notes"
            defaultValue={c.notes ?? ''}
            placeholder="Notes"
            onBlur={(e) => e.target.value.trim() !== (c.notes ?? '') && onChange({ notes: e.target.value })}
            className={cn(control, 'min-w-40 flex-1 bg-card')}
          />
        </div>
        <FlaggedNote flag={flag} />
      </div>
      <div className="flex items-start gap-1 justify-self-end">
        {c.status !== 'cleared' && c.status !== 'waived' && (
          <Button size="xs" variant="outline" onClick={onRequestDocs} title="Ask the borrower for documents for this condition">
            <FileUpIcon />
            Request docs
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" aria-label={`Remove condition ${n}`} className="text-muted-foreground hover:text-destructive" onClick={onRemove}>
          <Trash2Icon />
        </Button>
      </div>
    </li>
  )
}

/** Paste the lender's list; each condition becomes a row, with a guess at who it's on (changeable before adding). */
function PasteDialog({ onClose, onAdd, busy }: { onClose: () => void; onAdd: (items: { body: string; party: ConditionParty }[]) => void; busy: boolean }) {
  const [text, setText] = useState('')
  const [parties, setParties] = useState<Record<number, ConditionParty>>({})
  const items = splitConditions(text).map((c, i) => ({ ...c, party: parties[i] ?? c.party }))
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste conditions</DialogTitle>
          <DialogDescription>Copy the condition list from the approval or the lender's portal and paste it here. Each numbered or bulleted item becomes one condition; numbers and bullets are taken off.</DialogDescription>
        </DialogHeader>
        <TextArea label="Condition list" value={text} onChange={(v) => (setText(v), setParties({}))} rows={8} placeholder={'1. Letter of explanation for the deposit on 9/14\n2. Updated title commitment\n3. Two most recent paystubs'} />
        {items.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-medium">
              {items.length} condition{items.length === 1 ? '' : 's'} found
            </p>
            <ol className="max-h-72 divide-y overflow-y-auto rounded-md border">
              {items.map((c, i) => (
                <li key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <span className="text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="min-w-0 flex-1">{c.body}</span>
                  <select aria-label={`Who condition ${i + 1} is on`} value={c.party} onChange={(e) => setParties((p) => ({ ...p, [i]: e.target.value as ConditionParty }))} className={cn(control, 'bg-card')} title={`Guessed: ${partyLabel(c.party)}`}>
                    {CONDITION_PARTIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ol>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onAdd(items)} disabled={!items.length || busy}>
            {busy ? 'Adding…' : `Add ${items.length || ''} condition${items.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
