// The Buyer Readiness Plan on the nurture view (Connor, 2026-11-16; plan
// docs/plans/buyer-nurture.md Steps 4–5): generate it (Opus 5.5, or a starter
// plan built from the obstacles), edit every action, milestone and date,
// approve it, then make, save, download and send the "Your Roadmap to
// Homeownership" PDF. Nothing reaches the borrower until it's approved and
// the loan officer presses Send. Only a person marks a milestone done.
import { useState } from 'react'
import { CheckCircle2Icon, CircleIcon, DownloadIcon, EyeIcon, FileTextIcon, MailIcon, PencilIcon, PlusIcon, SparklesIcon, Trash2Icon, WandIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, DateInput, FormGrid, Input, Select, TextArea, confirmAction } from '@/components/shared'
import { SendSavedPdf } from '@/components/messages/SendDocumentDialog'
import { useSavePdf } from '@/components/pdf/useSavePdf'
import { useAiStatus } from '@/lib/api/assistant'
import { openDocument, useLoanDocuments } from '@/lib/api/documents'
import { aiPlanToDraft, draftPlanWithAi, useApprovePlan, useDiscardDraft, useReadinessPlans, useRevisePlan, useSaveDraft, useSetActionStatus, useSetMilestoneStatus } from '@/lib/api/readinessPlans'
import type { LoanProfile } from '@/lib/api/types'
import { formatIsoDate, nowIso, todayIso } from '@/lib/dates'
import { joinNames, worksheetFileName } from '@/lib/documents/feeWorksheet'
import { ROADMAP_TEMPLATE, roadmapProblems, roadmapView } from '@/lib/documents/readinessRoadmap'
import { obstacleLabel } from '@/lib/nurture/obstacles'
import { useNurtureUpdates } from '@/lib/api/nurtureFollowups'
import { reportedMilestones } from '@/lib/nurture/followups'
import { followUpFor, milestoneCounts, newKey, planProblems, starterPlan, type ActionDraft, type MilestoneDraft, type PlanDraft } from '@/lib/nurture/plan'


function MilestoneRows({ items, onChange, today }: { items: MilestoneDraft[]; onChange: (next: MilestoneDraft[]) => void; today: string }) {
  const set = (key: string, patch: Partial<MilestoneDraft>) => onChange(items.map((m) => (m.key === key ? { ...m, ...patch } : m)))
  return (
    <div className="space-y-2">
      {items.map((m) => (
        <div key={m.key} className="rounded-md border bg-muted/30 p-2">
          <FormGrid>
            <Input label="Milestone" value={m.title} onChange={(title) => set(m.key, { title })} span={3} />
            <Input label="How it's measured" value={m.measure} onChange={(measure) => set(m.key, { measure })} span={3} />
            <DateInput label="Target date" value={m.targetDate} onChange={(targetDate) => set(m.key, { targetDate, followUpDate: m.followUpDate ?? followUpFor(targetDate, today) })} span={2} />
            <DateInput label="Check-in date" value={m.followUpDate} onChange={(followUpDate) => set(m.key, { followUpDate })} span={2} />
            <div className="flex items-end justify-end sm:col-span-2">
              <Button size="sm" variant="ghost" onClick={() => onChange(items.filter((x) => x.key !== m.key))} title="Remove this milestone">
                <Trash2Icon />
              </Button>
            </div>
          </FormGrid>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...items, { key: newKey(), title: '', measure: '', targetDate: null, followUpDate: null }])}>
        <PlusIcon />
        Add milestone
      </Button>
    </div>
  )
}

function ActionEditor({ a, n, onChange, onRemove, today }: { a: ActionDraft; n: number; onChange: (next: ActionDraft) => void; onRemove: () => void; today: string }) {
  return (
    <div className="rounded-lg border border-l-[3px] border-l-primary bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          Action {n}
          {a.obstacle && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">{obstacleLabel(a.obstacle)}</span>}
        </p>
        <Button size="sm" variant="ghost" onClick={onRemove} title="Remove this action">
          <Trash2Icon />
        </Button>
      </div>
      <FormGrid>
        <Input label="What to do" value={a.title} onChange={(title) => onChange({ ...a, title })} span={6} required />
        <TextArea label="Why it matters for qualifying" value={a.why} onChange={(why) => onChange({ ...a, why })} rows={2} span={6} />
        <TextArea label="Next steps (one per line)" value={a.steps.join('\n')} onChange={(v) => onChange({ ...a, steps: v.split('\n') })} rows={3} span={3} />
        <TextArea label="Documents to verify (one per line)" value={a.docs.join('\n')} onChange={(v) => onChange({ ...a, docs: v.split('\n') })} rows={3} span={3} />
      </FormGrid>
      <p className="mt-3 mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Milestones</p>
      <MilestoneRows items={a.milestones} onChange={(milestones) => onChange({ ...a, milestones })} today={today} />
    </div>
  )
}


export interface PlanFacts {
  firstName: string
  borrowerName: string
  target: string | null
  /** What the AI is told (built by the nurture view from the 1003 and credit). */
  ai: unknown
}

export function ReadinessPlanCard({ loan, obstacles, facts, onEditObstacles }: { loan: LoanProfile; obstacles: string[]; facts: PlanFacts; onEditObstacles: () => void }) {
  const plans = useReadinessPlans(loan.id)
  const save = useSaveDraft(loan.id)
  const approve = useApprovePlan(loan.id)
  const revise = useRevisePlan(loan.id)
  const discard = useDiscardDraft(loan.id)
  const setMilestone = useSetMilestoneStatus(loan.id)
  const setAction = useSetActionStatus(loan.id)
  const updates = useNurtureUpdates(loan.id)
  const reported = reportedMilestones(updates.data ?? [])
  const ai = useAiStatus()
  const today = todayIso()
  const [editing, setEditing] = useState<{ plan: PlanDraft; source: 'ai' | 'starter'; aiRunId: string | null } | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const pdf = useSavePdf(loan, setSendingId)
  const docs = useLoanDocuments(loan.id)

  if (plans.isLoading) return <Card title="Buyer Readiness Plan"><p className="text-sm text-muted-foreground">Loading…</p></Card>
  if (plans.data === null) return <Card title="Buyer Readiness Plan"><p className="text-sm text-destructive">Readiness plans turn on once the readiness plans database script has run.</p></Card>
  const all = plans.data ?? []
  const draft = all.find((p) => p.status === 'draft') ?? null
  const approved = all.find((p) => p.status === 'approved') ?? null
  const roadmaps = (docs.data ?? []).filter((d) => d.kind === 'readiness_roadmap')
  const latestRoadmap = roadmaps[0] ?? null

  const startAi = async () => {
    if (!obstacles.length) return toast.error('Pick the readiness obstacles first.')
    setDrafting(true)
    try {
      const r = await draftPlanWithAi(loan.id, facts.ai)
      setEditing({ plan: aiPlanToDraft(r.plan, today), source: 'ai', aiRunId: r.runId })
    } catch (e) {
      toast.error(`${(e as Error).message} You can start from the template instead.`)
    } finally {
      setDrafting(false)
    }
  }
  const startTemplate = () => {
    if (!obstacles.length) return toast.error('Pick the readiness obstacles first.')
    setEditing({ plan: starterPlan(obstacles, { firstName: facts.firstName, target: facts.target }, today), source: 'starter', aiRunId: null })
  }

  const saveDraft = async (then?: 'approve') => {
    if (!editing) return
    const problems = planProblems(editing.plan, then === 'approve')
    if (problems.length) return toast.error(problems[0])
    try {
      const id = await save.mutateAsync({ obstacles, plan: editing.plan, source: editing.source, aiRunId: editing.aiRunId })
      if (then === 'approve') {
        if (!(await confirmAction('Approve this plan? It becomes the plan you share with the borrower; to change it later you revise it into a new version.', { confirmLabel: 'Approve plan' }))) {
          toast.success('Draft saved')
          setEditing(null)
          return
        }
        await approve.mutateAsync(id)
        toast.success('Plan approved. Make the roadmap PDF when you’re ready to send it.')
      } else toast.success('Draft saved')
      setEditing(null)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const makeRoadmap = async (mode: 'preview' | 'save') => {
    if (!approved) return
    const view = roadmapView({
      borrowerName: facts.borrowerName,
      firstName: facts.firstName,
      loName: loan.assignedLo?.name ?? 'Your loan officer',
      loPhone: null,
      loEmail: null,
      preparedOn: today,
      version: approved.version,
      timeframe: facts.target,
      plan: approved.plan,
      obstacles: approved.obstacles,
    })
    const problems = roadmapProblems(view)
    if (problems.length) return toast.error(problems[0])
    const render = (lib: typeof import('@/components/pdf/render'), brand: Parameters<typeof lib.readinessRoadmapPdf>[1]) =>
      lib.readinessRoadmapPdf({ ...view, contact: [brand.lo.name, brand.lo.phone, brand.lo.email].filter(Boolean).join(' · ') }, brand)
    if (mode === 'preview') {
      const tab = window.open('', '_blank')
      const made = await pdf.preview(render)
      if ('error' in made) {
        tab?.close()
        return toast.error(made.error)
      }
      if (tab) tab.location.href = made.url
      return
    }
    await pdf.save({
      kind: 'readiness_roadmap',
      fileName: worksheetFileName(`Roadmap to Homeownership v${approved.version}`, joinNames([facts.borrowerName]), nowIso()),
      propertyId: null,
      readinessPlanId: approved.id,
      templateVersion: ROADMAP_TEMPLATE,
      tooLong: 'Shorten the plan (fewer or shorter actions).',
      render,
    })
  }

  const downloadDoc = (path: string) => void openDocument({ storagePath: path })

  // ----- Editing a draft -----
  if (editing) {
    const p = editing.plan
    const setPlan = (patch: Partial<PlanDraft>) => setEditing({ ...editing, plan: { ...p, ...patch } })
    const busy = save.isPending || approve.isPending
    return (
      <Card title={`Buyer Readiness Plan · ${draft ? `draft v${draft.version}` : 'new draft'}`} description={editing.source === 'ai' ? 'Drafted by the assistant from the obstacles and the file. Edit anything, then approve.' : 'Started from the obstacle templates. Edit anything, then approve.'}>
        <div className="space-y-4">
          <FormGrid>
            <Input label="Goal" value={p.goal} onChange={(goal) => setPlan({ goal })} span={4} />
            <DateInput label="Review together on" value={p.reviewOn} onChange={(reviewOn) => setPlan({ reviewOn })} span={2} />
            <TextArea label="Introduction to the borrower" value={p.intro} onChange={(intro) => setPlan({ intro })} rows={3} span={6} />
          </FormGrid>
          {p.actions.map((a, i) => (
            <ActionEditor key={a.key} a={a} n={i + 1} today={today} onChange={(next) => setPlan({ actions: p.actions.map((x) => (x.key === a.key ? next : x)) })} onRemove={() => setPlan({ actions: p.actions.filter((x) => x.key !== a.key) })} />
          ))}
          <Button size="sm" variant="outline" onClick={() => setPlan({ actions: [...p.actions, { key: newKey(), obstacle: null, title: '', why: '', steps: [], docs: [], status: 'not_started', milestones: [] }] })}>
            <PlusIcon />
            Add action
          </Button>
          <div>
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Timeline (plan-wide milestones)</p>
            <MilestoneRows items={p.milestones} onChange={(milestones) => setPlan({ milestones })} today={today} />
          </div>
          <p className="text-xs text-muted-foreground">No promises of approval, credit scores or dates: the plan says what to do and how progress is checked.</p>
          <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => saveDraft()} disabled={busy}>
              Save draft
            </Button>
            <Button onClick={() => saveDraft('approve')} disabled={busy}>
              <CheckCircle2Icon />
              {busy ? 'Saving…' : 'Approve plan'}
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  const obstacleChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      {obstacles.length ? (
        obstacles.map((o) => (
          <span key={o} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
            {obstacleLabel(o)}
          </span>
        ))
      ) : (
        <span className="text-sm text-muted-foreground">No readiness obstacles picked yet.</span>
      )}
      <Button size="sm" variant="ghost" onClick={onEditObstacles}>
        <PencilIcon />
        Edit obstacles
      </Button>
    </div>
  )

  const generateButtons = (label: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={startAi} disabled={drafting || ai.data?.ready !== true} title={ai.data?.ready ? 'Opus 5.5 drafts it from the obstacles and the file' : 'Turns on once the AI key is set'}>
        <SparklesIcon />
        {drafting ? 'Drafting…' : label}
      </Button>
      <Button size="sm" variant="outline" onClick={startTemplate} disabled={drafting}>
        <WandIcon />
        Start from template
      </Button>
    </div>
  )

  const counts = approved ? milestoneCounts(approved.plan, today) : null
  return (
    <Card
      title="Buyer Readiness Plan"
      description={approved ? `Version ${approved.version}, approved ${formatIsoDate(approved.approvedAt!.slice(0, 10))}${counts ? ` · ${counts.done} of ${counts.total} milestones done${counts.overdue ? ` · ${counts.overdue} overdue` : ''}` : ''}` : 'A personal plan with actions, milestones and dates. You edit and approve it before the borrower sees anything.'}
    >
      <div className="space-y-4">
        {obstacleChips}

        {draft && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <span>Draft v{draft.version} is waiting for your approval.</span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setEditing({ plan: draft.plan, source: draft.source, aiRunId: null })}>
                <PencilIcon />
                Open draft
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => (await confirmAction('Throw away this draft?', { confirmLabel: 'Discard', destructive: true })) && discard.mutate(draft.id, { onError: (e) => toast.error(e.message) })}
              >
                Discard
              </Button>
            </div>
          </div>
        )}

        {!approved && !draft && generateButtons('Generate Buyer Readiness Plan')}

        {approved && (
          <>
            {approved.plan.goal && <p className="text-sm"><span className="text-muted-foreground">Goal: </span><span className="font-medium">{approved.plan.goal}</span>{approved.plan.reviewOn && <span className="text-muted-foreground"> · review {formatIsoDate(approved.plan.reviewOn)}</span>}</p>}
            <div className="space-y-3">
              {approved.plan.actions.map((a, i) => (
                <div key={a.key} className="rounded-lg border border-l-[3px] border-l-primary p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {i + 1}. {a.title}
                    </p>
                    <div className="w-40">
                      <Select
                        label="Status"
                        value={a.status}
                        options={[{ value: 'not_started', label: 'Not started' }, { value: 'in_progress', label: 'In progress' }, { value: 'done', label: 'Done' }]}
                        onChange={(v) => v && setAction.mutate({ id: a.key, status: v as ActionDraft['status'] }, { onError: (e) => toast.error(e.message) })}
                      />
                    </div>
                  </div>
                  {a.why && <p className="mt-1 text-xs text-muted-foreground">{a.why}</p>}
                  <ul className="mt-2 space-y-1">
                    {a.milestones.map((m) => (
                      <MilestoneLine key={m.key} m={m} today={today} reported={reported.has(m.key)} onToggle={(done) => setMilestone.mutate({ id: m.id!, status: done ? 'done' : 'outstanding' }, { onError: (e) => toast.error(e.message) })} />
                    ))}
                  </ul>
                </div>
              ))}
              {approved.plan.milestones.length > 0 && (
                <ul className="space-y-1">
                  {approved.plan.milestones.map((m) => (
                    <MilestoneLine key={m.key} m={m} today={today} reported={reported.has(m.key)} onToggle={(done) => setMilestone.mutate({ id: m.id!, status: done ? 'done' : 'outstanding' }, { onError: (e) => toast.error(e.message) })} />
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg bg-[#E6EEFB] p-3">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[#053095]">
                <FileTextIcon className="size-4" />
                Your Roadmap to Homeownership (PDF)
              </p>
              {latestRoadmap && approved.approvedAt && latestRoadmap.createdAt < approved.approvedAt && <p className="mb-2 text-xs text-amber-800">The plan changed since the last roadmap. Make a new one before sending.</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => makeRoadmap('preview')} disabled={pdf.saving || !pdf.ready}>
                  <EyeIcon />
                  Preview
                </Button>
                <Button size="sm" onClick={() => makeRoadmap('save')} disabled={pdf.saving || !pdf.ready}>
                  <FileTextIcon />
                  {pdf.saving ? 'Saving…' : 'Save roadmap to Documents'}
                </Button>
                {latestRoadmap && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setSendingId(latestRoadmap.id)}>
                      <MailIcon />
                      Send latest…
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => downloadDoc(latestRoadmap.storagePath)}>
                      <DownloadIcon />
                      Open latest
                    </Button>
                  </>
                )}
              </div>
              {roadmaps.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {roadmaps.slice(0, 5).map((d) => (
                    <li key={d.id}>
                      <button type="button" className="hover:underline" onClick={() => downloadDoc(d.storagePath)}>
                        {d.fileName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-3">
              {!draft && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    revise.mutate(approved.id, {
                      onSuccess: () => toast.success('A new draft version is open. Edit it, then approve.'),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                >
                  <PencilIcon />
                  Revise plan
                </Button>
              )}
            </div>
          </>
        )}
      </div>
      <SendSavedPdf loan={loan} docId={sendingId} onClose={() => setSendingId(null)} />
    </Card>
  )
}

function MilestoneLine({ m, today, reported, onToggle }: { m: MilestoneDraft; today: string; reported?: boolean; onToggle: (done: boolean) => void }) {
  const done = m.status === 'done'
  const overdue = !done && !!m.targetDate && m.targetDate < today
  return (
    <li className="flex items-start gap-2 text-sm">
      <button type="button" onClick={() => onToggle(!done)} title={done ? 'Mark not done' : 'Mark done (you verified it)'} className="mt-0.5 shrink-0">
        {done ? <CheckCircle2Icon className="size-4 text-emerald-600" /> : <CircleIcon className="size-4 text-muted-foreground" />}
      </button>
      <span className={cn('min-w-0 flex-1', done && 'text-muted-foreground line-through')}>
        {m.title}
        {m.measure && <span className="text-muted-foreground"> · {m.measure}</span>}
        {reported && !done && <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-900" title="They reported progress. Verify it under Updates.">Reported</span>}
      </span>
      <span className={cn('shrink-0 text-xs', overdue ? 'font-semibold text-[#b4372c]' : 'text-muted-foreground')}>{m.targetDate ? formatIsoDate(m.targetDate) : 'No date'}</span>
    </li>
  )
}
