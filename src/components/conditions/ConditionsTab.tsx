import { useState, type ReactNode } from 'react'
import { ClipboardPasteIcon, FileUpIcon, ListPlusIcon, PlusIcon, SearchIcon, SendIcon, Trash2Icon } from 'lucide-react'
import { openRequestDocuments } from '@/components/documents/RequestDocumentsHost'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, EmptyState, Select, TextArea, ToggleChip, confirmAction } from '@/components/shared'
import { useAddConditions, useConditions, useDeleteCondition, useUpdateCondition, type ConditionChanges } from '@/lib/api/conditions'
import { useDocumentRequests, type DocumentRequest } from '@/lib/api/documentRules'
import { useLoanDocuments } from '@/lib/api/documents'
import { useShareRecipients } from '@/lib/api/estimateShares'
import { useMarkStep } from '@/lib/api/loanfile'
import type { LoanProfile } from '@/lib/api/types'
import { useDocumentCatalog, useRequestFiles } from '@/lib/api/uploadRequests'
import { catalogConditionBody, catalogConditionKey, linkItemsFor, requestsUnder } from '@/lib/conditions/catalog'
import { todayIso } from '@/lib/dates'
import { CATEGORY_LABEL, type CatalogCategory } from '@/lib/documents/uploadRequests'
import { CONDITION_PARTIES, CONDITION_STATUSES, conditionCounts, guessParty, splitConditions, type Condition, type ConditionParty, type ConditionStatus } from '@/lib/loanfile/conditions'
import type { StepResult } from '@/lib/loanfile/workflow'
import type { Flagged } from '@/lib/conditions/suggest'
import { FlaggedNote, SuggestedConditions, useConditionSuggestions } from './SuggestedConditions'
import { RequestRow, UploadLinks } from './ConditionDocuments'

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
const isOpen = (c: Condition) => c.status !== 'cleared' && c.status !== 'waived'
const WHOLE_FILE = '__file__'

/**
 * Docs & Conditions is conditions only (Connor, 2026-11-17): every document
 * asked for sits under its condition, with its files and Accept / Reject.
 * Add conditions from the document catalog, paste the lender's list, or type
 * one; tick conditions and "Send upload link" makes the link and the draft
 * text and email (nothing is sent from here). When every condition is
 * Submitted, Cleared or Waived, the Workflow's "Submit conditions" step is
 * marked done, the same as clicking it. Suggested conditions (Phase 8) from
 * the checklist rules sit above the list.
 */
export function ConditionsTab({ loan, step }: { loan: LoanProfile; step: StepResult | null }) {
  const conditions = useConditions(loan.id)
  const requests = useDocumentRequests(loan.id)
  const files = useRequestFiles(loan.id)
  const docs = useLoanDocuments(loan.id)
  const people = useShareRecipients(loan.id)
  const catalog = useDocumentCatalog()
  const add = useAddConditions(loan.id, loan.organizationId)
  const update = useUpdateCondition(loan.id)
  const remove = useDeleteCondition(loan.id)
  const markStep = useMarkStep(loan.id, loan.organizationId)
  const [pasting, setPasting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [draft, setDraft] = useState('')
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const list = conditions.data ?? []
  const asked = requests.data ?? []
  const counts = conditionCounts(list.map((c) => c.status))
  const lastPosition = list.reduce((m, c) => Math.max(m, c.position), 0)
  const onBorrower = list.filter((c) => c.party === 'borrower' && !['submitted', 'cleared', 'waived'].includes(c.status)).length
  const suggested = useConditionSuggestions(loan, conditions.data)
  const flagOf = new Map<string, Flagged>((suggested?.flagged ?? []).map((f) => [f.conditionId, f]))
  const whoName = (contactId: string | null) => (contactId === null ? 'Whole file' : ((people.data ?? []).find((p) => p.contactId === contactId)?.name ?? 'Someone no longer on the file'))
  const showWho = (people.data ?? []).length > 1
  // Requests under no condition: from before the conditions-only script, or whose condition was removed.
  const placed = new Set(list.flatMap((c) => requestsUnder(c, asked).map((r) => r.id)))
  const loose = asked.filter((r) => !placed.has(r.id))
  const chosen = list.filter((c) => ticked.has(c.id) && isOpen(c))

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

  const sendLink = () => {
    const { items, contactId } = linkItemsFor(chosen, asked, catalog.data ?? [])
    openRequestDocuments(loan.id, null, { items, contactId })
    setTicked(new Set())
  }

  const docsUnder = (rs: DocumentRequest[]) =>
    rs.length > 0 && (
      <ul className="divide-y rounded-md border bg-muted/30 px-2">
        {rs.map((r) => (
          <RequestRow key={r.id} request={r} requests={asked} docs={docs.data ?? []} loanId={loan.id} files={(files.data ?? []).filter((f) => f.requestId === r.id)} who={showWho || r.contactId === null ? whoName(r.contactId) : null} />
        ))}
      </ul>
    )

  return (
    <Card
      title="Conditions"
      description={list.length ? `${counts.cleared} of ${counts.total} cleared${onBorrower ? ` · ${onBorrower} still on the borrower` : ''}` : 'What this file needs: who each is on, where it stands, and the documents that came in.'}
      action={
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" disabled={chosen.length === 0} onClick={sendLink} title={chosen.length ? 'Make an upload link for the ticked conditions' : 'Tick the conditions to ask the borrower for'}>
            <SendIcon />
            Send upload link{chosen.length ? ` (${chosen.length})` : ''}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
            <ListPlusIcon />
            Add conditions
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPasting(true)}>
            <ClipboardPasteIcon />
            Paste conditions
          </Button>
        </div>
      }
    >
      {suggested && loan.stage !== 'closed' && <SuggestedConditions loan={loan} suggestions={suggested.suggestions} lastPosition={lastPosition} />}
      {conditions.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : conditions.error ? (
        <p className="text-sm text-destructive">{conditions.error.message}</p>
      ) : list.length === 0 ? (
        <EmptyState title="No conditions yet" description='Click "Add conditions" to pick from your list (ID, pay stubs, W-2s…), paste the lender’s list, or type one below.' />
      ) : (
        <>
          {list.some(isOpen) && (
            <div className="mb-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span>Tick the conditions you need from the borrower, then Send upload link.</span>
              {ticked.size > 0 && (
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => setTicked(new Set())}>
                  Clear ticks
                </button>
              )}
            </div>
          )}
          <ol className="divide-y">
            {list.map((c, i) => (
              <ConditionRow
                key={c.id}
                n={i + 1}
                c={c}
                flag={flagOf.get(c.id)}
                ticked={ticked.has(c.id)}
                onTick={(on) => setTicked((s) => { const n = new Set(s); if (on) n.add(c.id); else n.delete(c.id); return n })}
                onRequestDocs={() => openRequestDocuments(loan.id, c.id)}
                busy={update.isPending}
                onChange={(changes) => change(c, changes)}
                onRemove={async () => (await confirmAction('Remove this condition? Documents asked for under it stay on the file.', { confirmLabel: 'Remove', destructive: true })) && remove.mutate(c.id, { onError: (e) => toast.error(e.message) })}
              >
                {docsUnder(requestsUnder(c, asked))}
              </ConditionRow>
            ))}
          </ol>
        </>
      )}

      {loose.length > 0 && (
        <section className="mt-3 border-t pt-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Asked for, not under a condition ({loose.length})</h3>
          <p className="mb-1 text-xs text-muted-foreground">These get their own condition once the conditions-only script has run in Supabase.</p>
          {docsUnder(loose)}
        </section>
      )}

      <div className="mt-3 flex gap-2 border-t pt-3">
        <input
          aria-label="New condition"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addOne()}
          placeholder="Type a condition"
          className="h-9 min-w-0 flex-1 rounded-md border px-3 text-sm focus:border-ring focus:outline-none"
        />
        <Button size="sm" onClick={addOne} disabled={!draft.trim() || add.isPending}>
          <PlusIcon />
          Add
        </Button>
      </div>

      <UploadLinks loanId={loan.id} requests={asked} whoName={whoName} />

      {pasting && <PasteDialog onClose={() => setPasting(false)} onAdd={(items) => add.mutate({ items, after: lastPosition }, { onSuccess: () => (toast.success(`Added ${items.length} condition${items.length === 1 ? '' : 's'}`), setPasting(false)), onError: (e) => toast.error(e.message) })} busy={add.isPending} />}
      {picking && <CatalogDialog loan={loan} conditions={list} lastPosition={lastPosition} onClose={() => setPicking(false)} />}
    </Card>
  )
}

function ConditionRow({ n, c, flag, busy, ticked, onTick, onChange, onRemove, onRequestDocs, children }: { n: number; c: Condition; flag: Flagged | undefined; busy: boolean; ticked: boolean; onTick: (on: boolean) => void; onChange: (changes: ConditionChanges) => void; onRemove: () => void; onRequestDocs: () => void; children: ReactNode }) {
  const open = isOpen(c)
  return (
    <li className="grid gap-2 py-3 md:grid-cols-[2.75rem_minmax(0,1fr)_auto]">
      <label className="flex items-start gap-1.5 pt-1.5">
        {open ? <input type="checkbox" aria-label={`Ask for condition ${n}`} checked={ticked} onChange={(e) => onTick(e.target.checked)} className="mt-0.5 size-4 accent-primary" /> : <span className="size-4" />}
        <span className="text-xs text-muted-foreground tabular-nums">{n}.</span>
      </label>
      <div className="min-w-0 space-y-2">
        <textarea
          key={c.body}
          aria-label={`Condition ${n}`}
          defaultValue={c.body}
          rows={1}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.body && onChange({ body: e.target.value })}
          className={cn('field-sizing-content w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-1 text-sm hover:border-border focus:border-ring focus:outline-none', !open && 'text-muted-foreground line-through decoration-muted-foreground/40')}
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
        {children}
      </div>
      <div className="flex items-start gap-1 justify-self-end">
        {open && (
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

/** Add conditions by ticking items from the document catalog (Settings → Document catalog), for one borrower or the whole file. */
function CatalogDialog({ loan, conditions, lastPosition, onClose }: { loan: LoanProfile; conditions: Condition[]; lastPosition: number; onClose: () => void }) {
  const catalog = useDocumentCatalog()
  const people = useShareRecipients(loan.id)
  const add = useAddConditions(loan.id, loan.organizationId)
  const [who, setWho] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const borrowers = people.data ?? []
  const contactId = who === WHOLE_FILE ? null : (who ?? borrowers[0]?.contactId ?? null)
  const person = borrowers.find((p) => p.contactId === contactId) ?? null
  const items = (catalog.data ?? []).filter((c) => c.active)
  const q = search.trim().toLowerCase()
  const shown = q ? items.filter((c) => `${c.label} ${c.instructions}`.toLowerCase().includes(q)) : items
  const groups = (Object.keys(CATEGORY_LABEL) as CatalogCategory[]).map((cat) => ({ cat, items: shown.filter((c) => c.category === cat) })).filter((g) => g.items.length)
  const onFile = new Set(conditions.map((c) => c.sourceKey).filter(Boolean))
  const has = (key: string) => onFile.has(catalogConditionKey(key, contactId))
  const chosen = items.filter((c) => picked.has(c.key) && !has(c.key))

  const save = () =>
    add.mutate(
      {
        items: chosen.map((c) => ({ body: catalogConditionBody(c.label, borrowers.length > 1 && person ? person.firstName : null), party: 'borrower' as const, sourceKey: catalogConditionKey(c.key, contactId) })),
        after: lastPosition,
      },
      {
        onSuccess: () => {
          toast.success(`Added ${chosen.length} condition${chosen.length === 1 ? '' : 's'}. Tick them and Send upload link to ask for them.`)
          onClose()
        },
        onError: (e) => toast.error(/source_key/.test(e.message) ? 'Run the suggested conditions script (20270112000000) in Supabase first.' : e.message),
      },
    )

  return (
    <Dialog open onOpenChange={(o) => !o && !add.isPending && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add conditions</DialogTitle>
          <DialogDescription>Tick what you need to gather. Each one becomes a condition on this file. The list is Settings → Document catalog.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="For"
            value={contactId ?? WHOLE_FILE}
            onChange={(v) => (setWho(v), setPicked(new Set()))}
            options={[...borrowers.map((b) => ({ value: b.contactId, label: `${b.name}${b.role === 'co_borrower' ? ' (co-borrower)' : ''}` })), { value: WHOLE_FILE, label: 'Whole file' }]}
          />
          <div className="relative self-end">
            <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the list" aria-label="Search the list" className="h-9 w-full rounded-md border pr-3 pl-8 text-sm focus:border-ring focus:outline-none" />
          </div>
        </div>
        <div className="max-h-[55svh] space-y-3 overflow-y-auto pr-1">
          {catalog.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">The document catalog is empty. Add items in Settings → Document catalog, or type a condition on the tab.</p>
          ) : (
            groups.map((g) => (
              <section key={g.cat}>
                <h3 className="text-[0.65rem] font-semibold tracking-wide text-muted-foreground uppercase">{CATEGORY_LABEL[g.cat]}</h3>
                <ul className="mt-1 space-y-1">
                  {g.items.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 text-sm" title={c.instructions}>
                        {c.label}
                        {c.period && <span className="text-xs text-muted-foreground"> · {c.period}</span>}
                      </span>
                      {has(c.key) ? (
                        <span className="text-xs text-muted-foreground">On the file</span>
                      ) : (
                        <ToggleChip label={picked.has(c.key) ? 'Picked' : 'Pick'} pressed={picked.has(c.key)} onChange={(on) => setPicked((s) => { const n = new Set(s); if (on) n.add(c.key); else n.delete(c.key); return n })} />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={chosen.length === 0 || add.isPending}>
            {add.isPending ? 'Adding…' : `Add ${chosen.length || ''} condition${chosen.length === 1 ? '' : 's'}`.replace('  ', ' ')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
