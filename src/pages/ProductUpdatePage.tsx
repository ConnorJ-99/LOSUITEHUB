import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { AiOffNote, Card, PageHeader, Select, ToggleChip, ToggleChipGroup, confirmAction } from '@/components/shared'
import { useAiStatus } from '@/lib/api/assistant'
import { useLenders } from '@/lib/api/lenders'
import { programAsReading } from '@/lib/api/matrixImports'
import { useConfirmProductUpdate, useDiscardProductUpdate, useProductUpdate, useReadProductUpdate, useSaveUpdateChoice, type ProductUpdate } from '@/lib/api/productUpdates'
import { useAuth } from '@/lib/auth/context'
import { changeLines } from '@/lib/products/productUpdate'
import type { UpdateChange } from '../../supabase/functions/assistant/productUpdate'

const STATUS: Record<ProductUpdate['status'], string> = { pending_review: 'Waiting for review', confirmed: 'Confirmed', discarded: 'Discarded' }
const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US')

/**
 * A pasted lender email (Phase 0b): the email beside the proposed changes, each
 * next to what's on file now with its quote. Confirm saves the email as guideline
 * text and opens a matrix draft per program; approving a draft is the usual approval.
 */
export function ProductUpdatePage() {
  const { updateId } = useParams<{ updateId: string }>()
  const update = useProductUpdate(updateId!)
  if (update.isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (update.error || !update.data) return <p className="py-12 text-center text-sm text-destructive">{update.error?.message ?? 'Update not found.'}</p>
  return <Review key={`${update.data.id}:${update.data.lenderId}:${update.data.proposal ? 'read' : 'unread'}`} update={update.data} />
}

function Review({ update: u }: { update: ProductUpdate }) {
  const { state } = useAuth()
  const canEdit = state.status === 'signedIn' && (state.user.role === 'owner' || state.user.role === 'admin')
  const pending = u.status === 'pending_review'
  const editable = pending && canEdit
  const lenders = useLenders()
  const ai = useAiStatus()
  const saveChoice = useSaveUpdateChoice(u.id)
  const read = useReadProductUpdate(u.id)
  const confirm = useConfirmProductUpdate(u)
  const discard = useDiscardProductUpdate(u.id)
  const lender = lenders.data?.find((l) => l.id === u.lenderId) ?? null
  const programs = (lender?.programs ?? []).filter((p) => p.active || u.programIds.includes(p.id))
  const proposal = u.proposal
  const [chosen, setChosen] = useState<string[]>(u.programIds)
  // Every proposed change starts ticked; once confirmed, the ones that were.
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(proposal?.accepted ?? proposal?.changes.map((c) => c.id) ?? []))
  const accepted = (proposal?.changes ?? []).filter((c) => ticked.has(c.id) && chosen.includes(c.programId))
  // A draft for each program with a ticked limit or rule change; by hand (no reading), one for each program picked.
  const [draftFor, setDraftFor] = useState<Set<string>>(() => new Set(proposal ? proposal.changes.filter((c) => c.kind !== 'text').map((c) => c.programId) : u.programIds))
  const drafts = chosen.filter((id) => draftFor.has(id))
  const aiReady = ai.data?.ready === true

  const setLender = async (lenderId: string) => {
    if (u.proposal && !(await confirmAction('Change the lender? The reading and the programs picked are cleared.', { confirmLabel: 'Change lender' }))) return
    saveChoice.mutate({ lender_id: lenderId, program_ids: [], proposal: null }, { onError: (e) => toast.error(e.message) })
  }
  const toggleProgram = (id: string, on: boolean) => {
    const next = on ? [...chosen, id] : chosen.filter((x) => x !== id)
    setChosen(next)
    if (on && !proposal) setDraftFor((s) => new Set([...s, id]))
    saveChoice.mutate({ program_ids: next }, { onError: (e) => toast.error(e.message) })
  }
  const onRead = () => read.mutate(undefined, { onSuccess: (p) => toast.success(`Read: ${p.changes.length} change${p.changes.length === 1 ? '' : 's'} found`), onError: (e) => toast.error(e.message) })
  const onConfirm = async () => {
    const names = (ids: string[]) => ids.map((id) => programs.find((p) => p.id === id)?.name ?? 'a program').join(', ')
    const msg = `Save this email as guideline text for ${names(chosen)}${drafts.length ? `, and open a matrix draft for ${names(drafts)}` : ''}? Nothing goes live until you approve ${drafts.length === 1 ? 'the draft' : 'each draft'}.`
    if (!(await confirmAction(msg, { confirmLabel: 'Confirm' }))) return
    confirm.mutate(
      { programIds: chosen, draftFor: drafts, accepted },
      { onSuccess: (r) => toast.success(`Saved as guideline text${r.import_ids.length ? ` · ${r.import_ids.length} draft${r.import_ids.length === 1 ? '' : 's'} to approve` : ''}`), onError: (e) => toast.error(e.message) },
    )
  }
  const onDiscard = async () => (await confirmAction('Discard this update? It stays in the list as discarded, and nothing changes.', { confirmLabel: 'Discard', destructive: true })) && discard.mutate(undefined, { onError: (e) => toast.error(e.message) })

  return (
    <div className="pb-24">
      <PageHeader
        eyebrow="Product update"
        title={u.subject || 'Pasted email'}
        description={`${u.lenderName ?? 'Lender not picked yet'} · received ${fmtDate(u.receivedOn)} · ${STATUS[u.status]}${u.decidedAt ? ` ${fmtDate(u.decidedAt)}` : ''}. Nothing changes in Product Search until you approve a new matrix version.`}
        action={
          <Button variant="outline" asChild>
            <Link to={u.lenderId ? `/admin/lenders?lender=${u.lenderId}` : '/admin/lenders'}>Back to {u.lenderName ?? 'Lenders'}</Link>
          </Button>
        }
      />
      {u.status === 'confirmed' && <ConfirmedNote update={u} />}
      {u.status === 'discarded' && <p className="mb-4 rounded-lg bg-muted px-4 py-3 text-sm">Discarded. It's kept as the record of what the lender sent.</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card title="The email" className="lg:sticky lg:top-4 lg:self-start">
          <p className="max-h-[70vh] overflow-y-auto text-sm whitespace-pre-line">{u.pastedText}</p>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card title="Lender and programs" description="Which programs this email is about. The email is saved as guideline text for each one.">
            <div className="max-w-sm">
              <Select label="Lender" value={u.lenderId} options={(lenders.data ?? []).map((l) => ({ value: l.id, label: l.name }))} onChange={setLender} readOnly={!editable} placeholder="Pick the lender" />
            </div>
            {lender && (
              <ToggleChipGroup className="mt-3">
                {programs.map((p) => (
                  <ToggleChip key={p.id} label={p.name} pressed={chosen.includes(p.id)} disabled={!editable} onChange={(on) => toggleProgram(p.id, on)} />
                ))}
              </ToggleChipGroup>
            )}
            {lender && programs.length === 0 && <p className="mt-3 text-sm text-muted-foreground">This lender has no programs yet. Add its matrix first.</p>}
          </Card>

          <Card
            title="Proposed changes"
            description="Each change next to what's on file, with the sentence from the email it comes from. Untick anything that's wrong."
            action={editable && aiReady && u.lenderId && (
              <Button size="sm" variant="outline" disabled={read.isPending} onClick={onRead}>
                {read.isPending ? 'Reading… (about a minute)' : proposal ? 'Read again' : 'Read with AI'}
              </Button>
            )}
          >
            {ai.data && !aiReady && !proposal && <AiOffNote what="Reading the email" reason={ai.data.reason === 'unreachable' ? 'unreachable' : 'no_key'} instead="Until then, pick the programs above and press Confirm: each opens an Edit-limits draft with this email beside it for you to type the changes." />}
            {aiReady && !proposal && <p className="text-sm text-muted-foreground">{u.lenderId ? 'Not read yet. Press Read with AI, or pick the programs and Confirm to make the changes by hand.' : 'Pick the lender first.'}</p>}
            {proposal && (
              <div className="space-y-4">
                {proposal.notes && <p className="text-sm">{proposal.notes}</p>}
                {proposal.effectiveDate && <p className="text-sm">Effective {fmtDate(proposal.effectiveDate)} (filled in on the new matrix version).</p>}
                {proposal.changes.length === 0 && <p className="text-sm text-muted-foreground">No program changes found. Confirm to keep the email as guideline text, or Discard it.</p>}
                {chosen.map((programId) => {
                  const mine = proposal.changes.filter((c) => c.programId === programId)
                  if (mine.length === 0) return null
                  return <ProgramChanges key={programId} programId={programId} name={programs.find((p) => p.id === programId)?.name ?? 'Program'} changes={mine} ticked={ticked} editable={editable} onTick={(id, on) => setTicked((s) => (on ? new Set([...s, id]) : new Set([...s].filter((x) => x !== id))))} />
                })}
                {proposal.changes.some((c) => !chosen.includes(c.programId)) && <p className="text-xs text-muted-foreground">Changes for programs you haven't picked above are hidden.</p>}
                {proposal.leftOut.length > 0 && (
                  <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p className="font-medium">Left out (check the email and make these by hand in the draft):</p>
                    <ul className="mt-1 list-disc pl-5">
                      {proposal.leftOut.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>

          {editable && chosen.length > 0 && (
            <Card title="When you confirm" description="The email is saved among the lender's guideline documents (as a bulletin) for every program above, so guideline search can quote it. Programs marked below also get a matrix draft to approve.">
              <ul className="divide-y">
                {chosen.map((id) => {
                  const n = accepted.filter((c) => c.programId === id && c.kind !== 'text').length
                  return (
                    <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>
                        {programs.find((p) => p.id === id)?.name ?? 'Program'}
                        <span className="text-muted-foreground"> · {draftFor.has(id) ? (n ? `draft with ${n} change${n === 1 ? '' : 's'}` : 'draft to edit by hand') : 'guideline text only'}</span>
                      </span>
                      <ToggleChip label="Matrix draft" pressed={draftFor.has(id)} onChange={(on) => setDraftFor((s) => (on ? new Set([...s, id]) : new Set([...s].filter((x) => x !== id))))} />
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}

          {editable && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={discard.isPending} onClick={onDiscard}>
                Discard
              </Button>
              <Button disabled={confirm.isPending || !u.lenderId || chosen.length === 0} title={!u.lenderId ? 'Pick the lender first' : chosen.length === 0 ? 'Pick at least one program' : undefined} onClick={onConfirm}>
                {confirm.isPending ? 'Confirming…' : 'Confirm'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** One program's proposed changes, each with what's on file now (from its matrix in use) and its quote. */
function ProgramChanges({ programId, name, changes, ticked, editable, onTick }: { programId: string; name: string; changes: UpdateChange[]; ticked: Set<string>; editable: boolean; onTick: (id: string, on: boolean) => void }) {
  const now = useQuery({ queryKey: ['programAsReading', programId], queryFn: () => programAsReading(programId) })
  return (
    <div>
      <p className="text-sm font-semibold">{name}</p>
      {now.isLoading && <p className="text-xs text-muted-foreground">Loading what's on file…</p>}
      {now.error && <p className="text-xs text-destructive">{now.error.message}</p>}
      <ul className="mt-1 space-y-2">
        {changes.map((c) => {
          const shown = now.data ? changeLines(now.data.program, c) : null
          const on = ticked.has(c.id)
          return (
            <li key={c.id} className={cn('rounded-md border px-3 py-2', !on && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.summary}</p>
                  {shown?.lines.map((l) => (
                    <p key={l} className="text-xs tabular-nums">
                      {l}
                    </p>
                  ))}
                  {shown?.problem && <p className="text-xs text-amber-800">{shown.problem}</p>}
                </div>
                <ToggleChip label={on ? 'Use' : 'Skip'} pressed={on} disabled={!editable} onChange={(v) => onTick(c.id, v)} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground italic">
                “{c.quote}” <CheckIcon className="inline size-3 text-emerald-700" aria-label="Found in the email word for word" />
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** After Confirm: the bulletin, and each draft with its status. */
function ConfirmedNote({ update: u }: { update: ProductUpdate }) {
  return (
    <Card title="Confirmed" className="mb-4" description="The email is saved as guideline text (a bulletin under the lender’s Documents). Approve each draft to make its new matrix version; the old version is kept.">
      {u.drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matrix drafts: guideline text only.</p>
      ) : (
        <ul className="divide-y">
          {u.drafts.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                {d.programName} · <span className="text-muted-foreground">{d.status === 'pending_review' ? 'waiting for your approval' : d.status}</span>
              </span>
              <Button size="sm" variant={d.status === 'pending_review' ? 'default' : 'outline'} asChild>
                <Link to={`/admin/lenders/imports/${d.id}`}>{d.status === 'pending_review' ? 'Review & approve' : 'Open'}</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
