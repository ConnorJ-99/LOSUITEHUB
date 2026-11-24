// Updates from the borrower (Connor, 2026-11-16; buyer-nurture Step 7): what
// they reported in a reply (read by the AI into a summary, a milestone and a
// suggested next step) or told you by phone. Nothing counts until you verify
// it; "Verify and mark done" also ticks the milestone, as you. The AI never
// completes a milestone.
import { useState } from 'react'
import { CheckCircle2Icon, CheckIcon, PencilIcon, PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, FormGrid, Select, TextArea } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { useAddUpdate, useEditUpdate, useNurtureUpdates, useVerifyUpdate, useDismissUpdate } from '@/lib/api/nurtureFollowups'
import { useReadinessPlans } from '@/lib/api/readinessPlans'
import type { Message } from '@/lib/api/messages'
import { relativeTime } from '@/lib/dates'
import { isOpenUpdate, UPDATE_KIND_LABEL, type NurtureUpdate, type UpdateKind } from '@/lib/nurture/followups'

interface MilestoneOption {
  id: string
  title: string
  done: boolean
}

export function NurtureUpdatesCard({ loanId, organizationId, firstName, messages }: { loanId: string; organizationId: string; firstName: string; messages: Message[] }) {
  const updates = useNurtureUpdates(loanId)
  const plans = useReadinessPlans(loanId)
  const verify = useVerifyUpdate(loanId)
  const dismiss = useDismissUpdate(loanId)
  const [editing, setEditing] = useState<{ id: string | null; summary: string; milestoneId: string | null; kind: UpdateKind } | null>(null)
  const [showAll, setShowAll] = useState(false)
  if (updates.isLoading) return null
  if (!updates.data) return null // Before the nurture follow-ups script.

  const approved = plans.data?.find((p) => p.status === 'approved')
  const milestones: MilestoneOption[] = approved ? [...approved.plan.actions.flatMap((a) => a.milestones), ...approved.plan.milestones].map((m) => ({ id: m.key, title: m.title, done: m.status === 'done' })) : []
  const byId = new Map(milestones.map((m) => [m.id, m]))
  const msgs = new Map(messages.map((m) => [m.id, m]))
  const open = updates.data.filter(isOpenUpdate)
  const decided = updates.data.filter((u) => !isOpenUpdate(u))
  const busy = verify.isPending || dismiss.isPending
  const onError = (e: Error) => toast.error(e.message)
  const name = firstName || 'the borrower'

  const row = (u: NurtureUpdate) => {
    const m = u.milestoneId ? byId.get(u.milestoneId) : undefined
    const msg = u.messageId ? msgs.get(u.messageId) : undefined
    const unread = u.status === 'queued'
    return (
      <li key={u.id} className={cn('rounded-lg border p-3', isOpenUpdate(u) ? 'border-amber-200 bg-amber-50/40' : 'opacity-75')}>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {unread ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-semibold">New reply · not read yet</span>
          ) : (
            <span className="rounded bg-muted px-1.5 py-0.5 font-semibold">{u.kind ? UPDATE_KIND_LABEL[u.kind] : 'Update'}</span>
          )}
          <span className={cn('rounded px-1.5 py-0.5', m ? 'bg-[#2E8B6A]/15 text-[#1f6b51]' : 'bg-muted text-muted-foreground')}>{m ? m.title : 'No milestone'}</span>
          {u.status === 'unverified' && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">Unverified</span>}
          {u.status === 'verified' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800">Verified</span>}
          {u.status === 'dismissed' && <span className="rounded bg-muted px-1.5 py-0.5">Dismissed</span>}
          {u.source === 'reply' && u.confidence && u.status === 'unverified' && <span className="text-muted-foreground">AI read it ({u.confidence} confidence)</span>}
          {u.source === 'typed' && <span className="text-muted-foreground">Added by you</span>}
          {u.source === 'myhome' && <span className="text-muted-foreground">From MyHome (their goal update)</span>}
          <span className="ml-auto text-muted-foreground">{relativeTime(u.createdAt)}</span>
        </div>
        {unread ? (
          <p className="mt-1.5 text-sm whitespace-pre-wrap">{msg ? `“${msg.body}”` : 'Their latest message is on the Messages tab.'}</p>
        ) : (
          u.summary && <p className="mt-1.5 text-sm">{u.summary}</p>
        )}
        {!unread && msg && <p className="mt-1 truncate text-xs text-muted-foreground">They wrote: “{msg.body}”</p>}
        {u.suggestedNext && isOpenUpdate(u) && <p className="mt-1 text-xs text-muted-foreground">Suggested next step: {u.suggestedNext}</p>}
        {isOpenUpdate(u) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {unread ? (
              <Button size="sm" variant="outline" onClick={() => setEditing({ id: u.id, summary: '', milestoneId: null, kind: 'progress' })}>
                <PencilIcon />
                Write it up
              </Button>
            ) : (
              <>
                <Button size="sm" disabled={busy} onClick={() => verify.mutate({ id: u.id, milestoneDone: false }, { onSuccess: () => toast.success('Verified'), onError })} title="You checked it (a document, a statement, a call)">
                  <CheckIcon />
                  Verify
                </Button>
                {m && !m.done && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => verify.mutate({ id: u.id, milestoneDone: true }, { onSuccess: () => toast.success(`Verified, and “${m.title}” is marked done`), onError })}>
                    <CheckCircle2Icon />
                    Verify and mark done
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setEditing({ id: u.id, summary: u.summary ?? '', milestoneId: u.milestoneId, kind: u.kind ?? 'progress' })}>
                  <PencilIcon />
                  Edit
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismiss.mutate(u.id, { onError })} title="Not an update (small talk, a question you answered)">
              <XIcon />
              Dismiss
            </Button>
          </div>
        )}
      </li>
    )
  }

  return (
    <Card
      title={`Updates from ${name}`}
      description="What they reported in a reply (read by the AI) or told you. Nothing counts until you verify it."
      action={
        <Button size="sm" variant="outline" onClick={() => setEditing({ id: null, summary: '', milestoneId: null, kind: 'progress' })}>
          <PlusIcon />
          Add an update
        </Button>
      }
    >
      {open.length === 0 && decided.length === 0 ? (
        <p className="text-sm text-muted-foreground">No updates yet. When {name} replies, it shows here to verify.</p>
      ) : (
        <ul className="space-y-2">
          {open.map(row)}
          {(showAll ? decided : decided.slice(0, 2)).map(row)}
        </ul>
      )}
      {decided.length > 2 && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all (${decided.length} earlier)`}
        </Button>
      )}
      {editing && <UpdateDialog loanId={loanId} organizationId={organizationId} milestones={milestones} value={editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function UpdateDialog({ loanId, organizationId, milestones, value, onClose }: { loanId: string; organizationId: string; milestones: MilestoneOption[]; value: { id: string | null; summary: string; milestoneId: string | null; kind: UpdateKind }; onClose: () => void }) {
  const add = useAddUpdate(loanId, organizationId)
  const edit = useEditUpdate(loanId)
  const [v, setV] = useState(value)
  const submit = () => {
    if (!v.summary.trim()) return toast.error('Write what they reported.')
    const done = { onSuccess: onClose, onError: (e: Error) => toast.error(e.message) }
    if (v.id) edit.mutate({ id: v.id, summary: v.summary, milestoneId: v.milestoneId, status: 'unverified' }, done)
    else add.mutate({ summary: v.summary, milestoneId: v.milestoneId, kind: v.kind }, done)
  }
  return (
    <EditDialog title={v.id ? 'The update' : 'Add an update'} open onOpenChange={(o) => !o && onClose()} onSubmit={submit} saving={add.isPending || edit.isPending} submitLabel="Save (unverified)">
      <FormGrid>
        <TextArea label="What they reported" value={v.summary} onChange={(summary) => setV({ ...v, summary })} rows={3} span={6} hint="In your words, e.g. “Says she paid the Visa down to $400.” Verify it once you’ve seen proof." />
        <Select label="Milestone" placeholder="No milestone" value={v.milestoneId ?? ''} options={[{ value: '', label: 'No milestone' }, ...milestones.map((m) => ({ value: m.id, label: `${m.title}${m.done ? ' (done)' : ''}` }))]} onChange={(milestoneId) => setV({ ...v, milestoneId: milestoneId || null })} span={3} />
        {!v.id && <Select label="Kind" value={v.kind} options={(Object.keys(UPDATE_KIND_LABEL) as UpdateKind[]).map((k) => ({ value: k, label: UPDATE_KIND_LABEL[k] }))} onChange={(kind) => kind && setV({ ...v, kind: kind as UpdateKind })} span={3} />}
      </FormGrid>
    </EditDialog>
  )
}
