import { useState } from 'react'
import { AlertOctagonIcon, CheckCircle2Icon, FileSearchIcon, MoonIcon, ScaleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, DateInput, TextArea, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { useCreditEvents } from '@/lib/api/creditEvents'
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
  const ready = !!app && !!worksheets.data && !!file.data && (events.data !== undefined || (app?.borrowers.length ?? 0) === 0)
  return {
    ready,
    worksheets: worksheets.data ?? [],
    creditEvents: events.data ?? [],
    creditPulled: !!file.data?.marks.some((m) => m.stepKey === 'credit' && m.status === 'done'),
  }
}

/** Readiness from the saved records (for the Overview). */
export function useSavedReadiness(loan: LoanProfile): Readiness | null {
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  const sources = useReadinessSources(loan, app.data)
  if (!sources.ready || !app.data || !properties.data || app.data.borrowers.length === 0) return null
  const draft = draftFrom(loan, app.data, properties.data, false)
  const summary = prequalSummary(loan, draft, properties.data)
  return readiness(readinessInput({ loan, app: app.data, summary, maxDtiPct: draft.loan.maxDtiPct, mortgageType: loan.details.mortgageType, ...sources, hasAssets: app.data.assets.length > 0, today: todayIso() }))
}

/** Readiness from the Prequal tab's live draft. */
export function useLiveReadiness(loan: LoanProfile, app: Application, summary: PrequalSummary, draft: PrequalDraft): Readiness | null {
  const sources = useReadinessSources(loan, app)
  if (!sources.ready) return null
  const hasAssets = draft.assets.some((a) => (a.amount ?? 0) > 0)
  return readiness(readinessInput({ loan, app, summary, maxDtiPct: draft.loan.maxDtiPct, mortgageType: draft.loan.mortgageType, ...sources, hasAssets, draftBorrowers: draft.borrowers, today: todayIso() }))
}

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

/** The readiness result with its reasons, and Move to Nurture when it's not ready. */
export function ReadinessCard({ loan, result, compact }: { loan: LoanProfile; result: Readiness | null; compact?: boolean }) {
  const [nurturing, setNurturing] = useState(false)
  if (!result) return null
  const style = LEVEL_STYLE[result.level]
  const Icon = style.icon
  const groups = (['not_ready', 'manual_review', 'needs_documents'] as const).map((level) => ({ level, items: result.reasons.filter((r) => r.level === level) })).filter((g) => g.items.length)
  const canNurture = result.level === 'not_ready' && NURTURE_STAGES.has(loan.stage)

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
        {canNurture && (
          <Button variant="outline" size="sm" onClick={() => setNurturing(true)}>
            <MoonIcon />
            Move to Nurture
          </Button>
        )}
      </div>
      {nurturing && <NurtureDialog loan={loan} result={result} onClose={() => setNurturing(false)} />}
    </Card>
  )
}
