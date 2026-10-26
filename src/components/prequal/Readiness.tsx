import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertOctagonIcon, ArrowRightIcon, BadgeCheckIcon, CheckCircle2Icon, FileSearchIcon, FileTextIcon, MoonIcon, ScaleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, DateInput, TextArea, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { keys } from '@/lib/api/client'
import { useCreditEvents } from '@/lib/api/creditEvents'
import { addDocumentRequests, useDocumentRequests, useDocumentRules } from '@/lib/api/documentRules'
import { useWorksheets } from '@/lib/api/income'
import { useLoanFile } from '@/lib/api/loanfile'
import { useUpdateStage } from '@/lib/api/loans'
import { useAddNote } from '@/lib/api/notes'
import { useProperties } from '@/lib/api/properties'
import { useAddTask } from '@/lib/api/tasks'
import type { LoanProfile } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { todayIso } from '@/lib/dates'
import { addDays } from '@/lib/contract/followThrough'
import { fullName } from '@/lib/pipeline/helpers'
import { draftFrom, prequalSummary, type PrequalDraft, type PrequalSummary } from '@/lib/prequal/draft'
import { LEVEL_LABEL, NURTURE_LABEL, readiness, type NurtureReason, type Readiness, type ReadinessLevel } from '@/lib/prequal/readiness'
import { readinessInput } from '@/lib/prequal/readinessInput'
import { checklistFrom, documentChecklist, documentRequest, nextStep, type DocGroup } from '@/lib/prequal/nextStep'
import { useQueueIntroEmails } from '@/lib/api/contract'
import { useOrganization, useProfile } from '@/lib/api/settings'
import type { Application } from '@/lib/api/urla'

const LEVEL_STYLE: Record<ReadinessLevel, { icon: typeof CheckCircle2Icon; box: string; text: string }> = {
  ready: { icon: CheckCircle2Icon, box: 'border-emerald-200 bg-emerald-50', text: 'text-emerald-800' },
  needs_documents: { icon: FileSearchIcon, box: 'border-sky-200 bg-sky-50', text: 'text-sky-900' },
  manual_review: { icon: ScaleIcon, box: 'border-amber-200 bg-amber-50', text: 'text-amber-900' },
  not_ready: { icon: AlertOctagonIcon, box: 'border-red-200 bg-red-50', text: 'text-red-900' },
}
const GROUP_TITLE: Record<Exclude<ReadinessLevel, 'ready'>, string> = {
  not_ready: 'Why it is not ready',
  manual_review: 'Needs a closer look',
  needs_documents: 'Still needed',
}
const NURTURE_STAGES = new Set(['lead', 'contacted', 'pre_qualified', 'pre_approved'])

/**
 * Everything readiness needs besides the prequal summary. The Prequal tab
 * passes its live (unsaved) summary; other screens use the saved records.
 */
export function useReadinessSources(loan: LoanProfile, app: Application | undefined) {
  const worksheets = useWorksheets(loan.id)
  const file = useLoanFile(loan.id)
  const events = useCreditEvents(loan.id, app?.borrowers.map((b) => b.contactId) ?? [])
  const rules = useDocumentRules()
  const requests = useDocumentRequests(loan.id)
  const ready = !!app && !!worksheets.data && !!file.data && !!rules.data && (events.data !== undefined || (app?.borrowers.length ?? 0) === 0)
  return {
    ready,
    worksheets: worksheets.data ?? [],
    creditEvents: events.data ?? [],
    rules: rules.data ?? [],
    waitingRequests: (requests.data ?? []).filter((r) => r.status === 'requested').map((r) => ({ label: shortLabel(r.label), contactId: r.contactId })),
    creditPulled: !!file.data?.marks.some((m) => m.stepKey === 'credit' && m.status === 'done'),
  }
}

/** The readiness result and the documents to ask for. */
export interface ReadinessView {
  result: Readiness
  checklist: DocGroup[]
}

/** Readiness from the saved records (for the Overview). */
export function useSavedReadiness(loan: LoanProfile): ReadinessView | null {
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  const sources = useReadinessSources(loan, app.data)
  if (!sources.ready || !app.data || !properties.data || app.data.borrowers.length === 0) return null
  const draft = draftFrom(loan, app.data, properties.data, false)
  const summary = prequalSummary(loan, draft, properties.data)
  return {
    result: readiness(readinessInput({ loan, app: app.data, summary, maxDtiPct: draft.loan.maxDtiPct, mortgageType: loan.details.mortgageType, ...sources, hasAssets: app.data.assets.length > 0, today: todayIso() })),
    checklist: documentChecklist(checklistFrom(draft, loan.details.incomeDocType, sources.creditEvents), sources.rules),
  }
}

/** Readiness from the Prequal tab's live draft. */
export function useLiveReadiness(loan: LoanProfile, app: Application, summary: PrequalSummary, draft: PrequalDraft): ReadinessView | null {
  const sources = useReadinessSources(loan, app)
  if (!sources.ready) return null
  const hasAssets = draft.assets.some((a) => (a.amount ?? 0) > 0)
  return {
    result: readiness(readinessInput({ loan, app, summary, maxDtiPct: draft.loan.maxDtiPct, mortgageType: draft.loan.mortgageType, ...sources, hasAssets, draftBorrowers: draft.borrowers, today: todayIso() })),
    checklist: documentChecklist(checklistFrom(draft, loan.details.incomeDocType, sources.creditEvents), sources.rules),
  }
}

/** "Pay stubs covering the last 30 days" → "pay stubs covering the last 30 days" (for lists inside a sentence). "W-2s" and "VOE" keep their capitals. */
const shortLabel = (label: string) => (/^[A-Z]([a-z]|\s)/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label)

function NurtureDialog({ loan, result, onClose }: { loan: LoanProfile; result: Readiness; onClose: () => void }) {
  const [reasons, setReasons] = useState<NurtureReason[]>(result.nurture)
  const [checkBack, setCheckBack] = useState<string | null>(addDays(todayIso(), 90))
  const [note, setNote] = useState(result.reasons.filter((r) => r.level === 'not_ready').map((r) => r.text).join(' '))
  const updateStage = useUpdateStage()
  const addNote = useAddNote(loan.borrower?.id ?? '', loan.organizationId)
  const addTask = useAddTask(loan.id, loan.organizationId)
  const [saving, setSaving] = useState(false)
  const name = loan.borrower ? fullName(loan.borrower) : 'the borrower'

  const submit = async () => {
    if (reasons.length === 0) return toast.error('Pick at least one reason')
    setSaving(true)
    try {
      const labels = reasons.map((r) => NURTURE_LABEL[r]).join(', ')
      await updateStage.mutateAsync({ loanId: loan.id, stage: 'nurture' })
      if (loan.borrower) await addNote.mutateAsync({ loanId: loan.id, kind: 'note', body: `Moved to Nurture (${labels}). ${note}`.trim() })
      if (checkBack) await addTask.mutateAsync({ title: `Check back with ${name} (Nurture: ${labels})`, dueOn: checkBack })
      toast.success('Moved to Nurture')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditDialog title="Move to Nurture" description="Not ready yet. The reason is saved as a note and a check-back task is added." open onOpenChange={(o) => !o && onClose()} onSubmit={submit} saving={saving} submitLabel="Move to Nurture">
      <div className="space-y-3">
        <ToggleChipGroup>
          {(Object.keys(NURTURE_LABEL) as NurtureReason[]).map((r) => (
            <ToggleChip key={r} label={NURTURE_LABEL[r]} pressed={reasons.includes(r)} onChange={(p) => setReasons((s) => (p ? [...s, r] : s.filter((x) => x !== r)))} />
          ))}
        </ToggleChipGroup>
        <TextArea label="Note" value={note} onChange={setNote} rows={3} />
        <DateInput label="Check back on" value={checkBack} onChange={setCheckBack} hint="Leave blank for no task" />
      </div>
    </EditDialog>
  )
}

/** Pick the documents and text or email; the request goes to the Action Queue. */
function RequestDialog({ loan, checklist, onClose }: { loan: LoanProfile; checklist: DocGroup[]; onClose: () => void }) {
  const [channel, setChannel] = useState<'text' | 'email'>('email')
  const [off, setOff] = useState<Set<string>>(new Set())
  const profile = useProfile(loan.assignedLo?.id)
  const org = useOrganization()
  const queue = useQueueIntroEmails(loan.id, loan.organizationId)
  const queryClient = useQueryClient()
  const id = (g: DocGroup, key: string) => `${g.title}:${key}`
  const picked = checklist.map((g) => ({ ...g, items: g.items.filter((i) => !off.has(id(g, i.key))) })).filter((g) => g.items.length)
  const b = loan.borrower
  const toggle = (key: string, on: boolean) =>
    setOff((s) => {
      const next = new Set(s)
      if (on) next.delete(key)
      else next.add(key)
      return next
    })

  const submit = () => {
    if (!b) return toast.error('This file has no borrower.')
    if (picked.length === 0) return toast.error('Pick at least one document')
    const signer = { loName: profile.data?.fullName ?? null, loNmls: profile.data?.nmls ?? null, loPhone: profile.data?.phone ?? null, companyName: org.data?.name ?? 'MPS Mortgage LLC', companyNmls: org.data?.nmls ?? '2501110' }
    const draft = documentRequest(channel, { firstName: b.firstName, contact: channel === 'text' ? b.phone : b.email }, picked, signer)
    queue.mutate([{ title: `Document request (${channel}) to ${b.firstName}`, draft }], {
      onSuccess: async () => {
        // Track each item as requested, so the Documents tab can tick them off as they arrive.
        const items = picked.flatMap((g) => g.items.map((i) => ({ contactId: g.contactId, ruleKey: i.key, label: i.full, kind: i.kind })))
        const tracked = await addDocumentRequests(loan.id, loan.organizationId, items).catch(() => null)
        queryClient.invalidateQueries({ queryKey: keys.documentRequests(loan.id) })
        toast.success(`Document request added to the Action Queue${tracked ? `; ${tracked} item${tracked === 1 ? '' : 's'} now tracked on the Documents tab` : ''}`)
        onClose()
      },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <EditDialog
      title="Draft document request"
      description="A starter list from how they earn money, what they have and their credit history. The draft goes to the Action Queue for you to approve and send."
      open
      onOpenChange={(o) => !o && onClose()}
      onSubmit={submit}
      saving={queue.isPending}
      submitLabel="Add to Action Queue"
      wide
    >
      <div className="space-y-3">
        <ToggleChipGroup>
          <ToggleChip label="Email" pressed={channel === 'email'} onChange={() => setChannel('email')} />
          <ToggleChip label="Text" pressed={channel === 'text'} onChange={() => setChannel('text')} />
        </ToggleChipGroup>
        {checklist.map((g) => (
          <div key={g.title}>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</p>
            <ul className="mt-1 space-y-1">
              {g.items.map((i) => {
                const on = !off.has(id(g, i.key))
                return (
                  <li key={i.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className={cn(!on && 'text-muted-foreground line-through')}>{i.full}</span>
                    <ToggleChip label="Ask" pressed={on} onChange={(p) => toggle(id(g, i.key), p)} />
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        {channel === 'text' && <p className="text-xs text-muted-foreground">Texts list the short names; if the list is too long for one text, it says the full list is coming by email.</p>}
      </div>
    </EditDialog>
  )
}

/** The readiness result with its reasons, and the next step with its button. */
export function ReadinessCard({ loan, view, compact }: { loan: LoanProfile; view: ReadinessView | null; compact?: boolean }) {
  const [nurturing, setNurturing] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const updateStage = useUpdateStage()
  if (!view) return null
  const result = view.result
  const next = nextStep(result, loan.stage)
  const style = LEVEL_STYLE[result.level]
  const Icon = style.icon
  const groups = (['not_ready', 'manual_review', 'needs_documents'] as const).map((level) => ({ level, items: result.reasons.filter((r) => r.level === level) })).filter((g) => g.items.length)
  const canNurture = result.level === 'not_ready' && NURTURE_STAGES.has(loan.stage)
  const canRequest = result.level !== 'not_ready' && view.checklist.length > 0
  const preApprove = () =>
    updateStage.mutate({ loanId: loan.id, stage: 'pre_approved' }, { onSuccess: () => toast.success('Moved to Pre-Approved'), onError: (e) => toast.error(e.message) })

  return (
    <Card title="Readiness" description={compact ? undefined : 'Worked out from the prequal, documents and credit history. Your rules, no AI.'}>
      <div className="space-y-3">
        <div className={cn('flex items-center gap-2 rounded-lg border p-3 text-sm font-semibold', style.box, style.text)}>
          <Icon className="size-4 shrink-0" />
          {LEVEL_LABEL[result.level]}
          {result.nurture.length > 0 && <span className="font-normal">· {result.nurture.map((n) => NURTURE_LABEL[n]).join(', ')}</span>}
        </div>
        {groups.map((g) => (
          <div key={g.level}>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{GROUP_TITLE[g.level]}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
              {g.items.map((r, i) => (
                <li key={i}>{r.text}</li>
              ))}
            </ul>
          </div>
        ))}
        {next && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <ArrowRightIcon className="size-3.5" />
              Next step
            </p>
            <p className="mt-1 text-sm font-medium">{next.title}</p>
            <p className="text-sm text-muted-foreground">{next.detail}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {canNurture && (
                <Button variant="outline" size="sm" onClick={() => setNurturing(true)}>
                  <MoonIcon />
                  Move to Nurture
                </Button>
              )}
              {next.action === 'pre_approve' && (
                <Button size="sm" onClick={preApprove} disabled={updateStage.isPending}>
                  <BadgeCheckIcon />
                  Move to Pre-Approved
                </Button>
              )}
              {canRequest && (
                <Button variant={next.action === 'request_documents' ? 'default' : 'outline'} size="sm" onClick={() => setRequesting(true)}>
                  <FileTextIcon />
                  Draft document request
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      {nurturing && <NurtureDialog loan={loan} result={result} onClose={() => setNurturing(false)} />}
      {requesting && <RequestDialog loan={loan} checklist={view.checklist} onClose={() => setRequesting(false)} />}
    </Card>
  )
}
