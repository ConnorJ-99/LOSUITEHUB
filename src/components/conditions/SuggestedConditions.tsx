import { useMemo, useState } from 'react'
import { ChevronDownIcon, LightbulbIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, TextArea, confirmAction } from '@/components/shared'
import { useAddConditions, useConditionDismissals, useDismissSuggestion, useSelectedProgram } from '@/lib/api/conditions'
import { useCreditEvents } from '@/lib/api/creditEvents'
import { useDocumentRequests, useDocumentRules } from '@/lib/api/documentRules'
import { useProperties } from '@/lib/api/properties'
import type { LoanProfile } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { fileFactsFrom } from '@/lib/conditions/facts'
import { FEATURES } from '@/lib/features'
import { documentSuggestions, type AnalyzedDoc } from '@/lib/conditions/fromDocuments'
import { useAnalyses } from '@/lib/api/analyses'
import { useLoanDocuments } from '@/lib/api/documents'
import { suggestConditions, type Flagged, type Suggestion } from '@/lib/conditions/suggest'
import { CONDITION_PARTIES, type Condition, type ConditionParty } from '@/lib/loanfile/conditions'
import { todayIso } from '@/lib/dates'

const STAGE_LABEL = { application: 'At application', processing: 'In processing', before_closing: 'Before closing' } as const
const partyLabel = (p: string) => CONDITION_PARTIES.find((x) => x.value === p)?.label ?? p

/**
 * The file's suggested conditions (build plan Phase 8), worked out from the
 * company rules and the profile, and the conditions that no longer fit. Each
 * can be added with one click, edited first, or dismissed (undo in the toast).
 * Nothing is sent from here.
 */
export function useConditionSuggestions(loan: LoanProfile, conditions: Condition[] | undefined) {
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  const events = useCreditEvents(loan.id, app.data?.borrowers.map((b) => b.contactId) ?? [])
  const rules = useDocumentRules()
  const requests = useDocumentRequests(loan.id)
  const dismissed = useConditionDismissals(loan.id)
  const program = useSelectedProgram(loan.details.programId)
  // Stage 3c: flags on analyzed uploads (null before the analyses script has run, then nothing is added).
  const analyses = useAnalyses(loan.id)
  const docs = useLoanDocuments(loan.id)
  const ready = !!app.data && !!properties.data && !!rules.data && !!requests.data && !!dismissed.data && !!conditions && (events.data !== undefined || (app.data?.borrowers.length ?? 0) === 0) && (!loan.details.programId || program.data !== undefined)
  return useMemo(() => {
    if (!ready) return null
    const facts = fileFactsFrom(loan, app.data!, properties.data!, events.data ?? [], program.data ?? null, new Date().getFullYear(), todayIso())
    const analyzed: AnalyzedDoc[] = [...(analyses.data?.values() ?? [])].flatMap((a) => {
      const d = docs.data?.find((x) => x.id === a.documentId)
      return d && (a.status === 'ready' || a.status === 'needs_review') ? [{ documentId: d.id, contactId: d.contactId, fileName: d.fileName, kind: a.suggestedKind, fields: a.fields, flags: a.flags }] : []
    })
    return suggestConditions(facts, rules.data!, {
      conditions: conditions!.map((c) => ({ id: c.id, sourceKey: c.sourceKey ?? null, status: c.status })),
      requests: requests.data!.map((r) => ({ id: r.id, contactId: r.contactId, ruleKey: r.ruleKey, status: r.status })),
      dismissed: dismissed.data!,
    }, FEATURES.uploadReview ? documentSuggestions(analyzed) : [])
  }, [ready, loan, app.data, properties.data, events.data, program.data, rules.data, requests.data, dismissed.data, conditions, analyses.data, docs.data])
}

export function SuggestedConditions({ loan, suggestions, lastPosition }: { loan: LoanProfile; suggestions: Suggestion[]; lastPosition: number }) {
  const add = useAddConditions(loan.id, loan.organizationId)
  const dismiss = useDismissSuggestion(loan.id, loan.organizationId)
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState<Suggestion | null>(null)
  if (suggestions.length === 0) return null

  const addItems = (items: Suggestion[], edited?: { body: string; party: ConditionParty }) =>
    add.mutate(
      {
        items: items.map((s) => ({ body: edited?.body ?? s.body, party: edited?.party ?? s.party, sourceKey: s.key, documentRequestId: s.request?.id ?? null })),
        after: lastPosition,
      },
      {
        onSuccess: () => {
          toast.success(items.length === 1 ? 'Condition added' : `Added ${items.length} conditions`)
          setEditing(null)
        },
        onError: (e) => toast.error(/source_key|document_request_id/.test(e.message) ? 'Run the suggested conditions script (20270112000000) in Supabase first.' : e.message),
      },
    )
  const addAll = async () => {
    if (!(await confirmAction(`Add all ${suggestions.length} suggested conditions to this file?`, { confirmLabel: `Add ${suggestions.length}` }))) return
    addItems(suggestions)
  }
  const skip = (s: Suggestion) =>
    dismiss.mutate(
      { key: s.key },
      {
        onSuccess: () => toast('Dismissed', { action: { label: 'Undo', onClick: () => dismiss.mutate({ key: s.key, undo: true }, { onError: (e) => toast.error(e.message) }) } }),
        onError: (e) => toast.error(e.message),
      },
    )

  return (
    <section className="mb-4 rounded-lg border border-primary/20 bg-primary/5">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-sm font-semibold" aria-expanded={open}>
          <ChevronDownIcon className={cn('size-4 transition-transform', !open && '-rotate-90')} />
          <LightbulbIcon className="size-4 text-primary" />
          Suggested ({suggestions.length})
        </button>
        <span className="text-xs text-muted-foreground">From your checklist rules and this file. Nothing is sent from here.</span>
        <Button size="sm" variant="outline" className="ml-auto" disabled={add.isPending} onClick={() => void addAll()}>
          Add all ({suggestions.length})
        </Button>
      </div>
      {open && (
        <ul className="divide-y border-t border-primary/10 bg-card">
          {suggestions.map((s) => (
            <li key={s.key} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm">{s.body}</p>
                <p className="text-xs text-muted-foreground">
                  {s.why}
                  {' · '}
                  {s.source.kind === 'lender' ? `Lender guideline: ${s.source.label}${s.source.citation ? `, ${s.source.citation}` : ''}` : `Company rule: ${s.source.label}`}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded bg-muted px-1.5 py-0.5">On {partyLabel(s.party)}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5">{STAGE_LABEL[s.stage]}</span>
                  {s.request && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-900">Requested on Documents, not in yet</span>}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" disabled={add.isPending} onClick={() => addItems([s])}>
                  <PlusIcon />
                  Add
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                  Edit and add
                </Button>
                <Button size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => skip(s)}>
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <EditDialog s={editing} busy={add.isPending} onClose={() => setEditing(null)} onAdd={(edited) => addItems([editing], edited)} />}
    </section>
  )
}

function EditDialog({ s, busy, onClose, onAdd }: { s: Suggestion; busy: boolean; onClose: () => void; onAdd: (v: { body: string; party: ConditionParty }) => void }) {
  const [body, setBody] = useState(s.body)
  const [party, setParty] = useState<ConditionParty>(s.party)
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit and add</DialogTitle>
          <DialogDescription>{s.why}</DialogDescription>
        </DialogHeader>
        <TextArea label="Condition" value={body} onChange={setBody} rows={3} />
        <Select label="Who it's on" value={party} options={CONDITION_PARTIES} onChange={setParty} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || !body.trim()} onClick={() => onAdd({ body: body.trim(), party })}>
            {busy ? 'Adding…' : 'Add condition'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "No longer matches the file (…)" under a condition whose reason has gone. */
export function FlaggedNote({ flag }: { flag: Flagged | undefined }) {
  if (!flag) return null
  return <p className="text-xs text-amber-700">{flag.why}. It stays on the file; remove it yourself if it's not needed.</p>
}
