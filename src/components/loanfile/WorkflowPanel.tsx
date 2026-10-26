import { useState } from 'react'
import {
  BadgeCheckIcon,
  BanknoteIcon,
  CalendarCheckIcon,
  CircleDotIcon,
  FileCheck2Icon,
  FileSignatureIcon,
  FileTextIcon,
  FolderIcon,
  GavelIcon,
  HomeIcon,
  KeyRoundIcon,
  MailIcon,
  PenLineIcon,
  ReceiptIcon,
  SendIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useMarkStep } from '@/lib/api/loanfile'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { GROUPS, OWNER_LABEL, type StepResult, type Workflow } from '@/lib/loanfile/workflow'
import { GroupProgress, NextStepCard, StepGroup, StepRow } from './Workflow'

const ICONS: Record<string, LucideIcon> = {
  prequal: UserCheckIcon,
  application: FileTextIcon,
  credit: ShieldCheckIcon,
  documents: FolderIcon,
  preapproval: MailIcon,
  contract: FileSignatureIcon,
  disclosures: SendIcon,
  disclosures_signed: PenLineIcon,
  appraisal: HomeIcon,
  title: GavelIcon,
  submit: FileCheck2Icon,
  approval: BadgeCheckIcon,
  appraisal_received: HomeIcon,
  conditions: FolderIcon,
  ctc: CalendarCheckIcon,
  cd: ReceiptIcon,
  docs_out: FileSignatureIcon,
  closing: KeyRoundIcon,
  funded: BanknoteIcon,
}
const iconFor = (key: string) => ICONS[key] ?? CircleDotIcon

/**
 * The Workflow at the top of the Overview: the next step, progress by
 * group, and the step checklist. Steps done outside LOSuite (disclosures,
 * submission, closing) are tracked here, never performed here.
 */
export function WorkflowPanel({ workflow, loanId, organizationId, days, onOpenSection, onCompleteFields }: { workflow: Workflow; loanId: string; organizationId: string; days: number; onOpenSection: (section: string) => void; onCompleteFields: () => void }) {
  const mark = useMarkStep(loanId, organizationId)
  const [openGroup, setOpenGroup] = useState<string | null>(workflow.currentGroup)
  const groupLabel = (id: string) => GROUPS.find((g) => g.id === id)?.label ?? id

  const markStep = (step: StepResult, status: 'done' | 'na' | null) =>
    mark.mutate(
      { step, status, doneOn: todayIso() },
      {
        onSuccess: () => toast.success(status === 'done' ? `${step.name}: done${step.milestone ? ' (milestone recorded)' : ''}` : status === 'na' ? `${step.name}: not applicable` : `${step.name}: cleared`),
        onError: (e) => toast.error(e.message),
      },
    )
  // Finishing the 1003 completes this step, or clears a block caused by missing 1003 fields.
  const isUrla = (step: StepResult) => step.ruleKey === 'urla_complete' || (step.ruleKey === 'ready_to_submit' && step.status === 'blocked')
  /** The step's main button: fill the 1003's missing fields, open its section, or mark it done today. */
  const act = (step: StepResult) => (isUrla(step) ? onCompleteFields() : step.actionTarget ? onOpenSection(step.actionTarget) : markStep(step, 'done'))
  const label = (step: StepResult) => (isUrla(step) ? 'Complete fields' : (step.actionLabel ?? 'Mark done'))
  /** Overrides for steps whose main button doesn't mark them done (blocked, worked out from the file, or opening a section). */
  const menuFor = (step: StepResult) =>
    step.status === 'blocked' || step.ruleKey || step.actionTarget
      ? [
          { label: 'Mark done anyway', onSelect: () => markStep(step, 'done') },
          ...(isUrla(step) ? [{ label: 'Open the 1003', onSelect: () => onOpenSection('1003') }] : []),
        ]
      : undefined

  const next = workflow.next
  return (
    <div className="space-y-4">
      {next ? (
        <NextStepCard
          icon={iconFor(next.key)}
          eyebrow={`${groupLabel(next.group)} · Your next step`}
          title={next.name}
          description={next.reason ?? `${OWNER_LABEL[next.owner]}'s step${next.actionTarget ? '' : '. Do it in Arive or with the lender, then mark it here.'}`}
          actionLabel={label(next)}
          onAction={() => act(next)}
          alsoReady={workflow.alsoReady.map((s) => ({ icon: iconFor(s.key), label: s.name, actionLabel: label(s), onAction: () => act(s) }))}
        />
      ) : (
        workflow.totalCount > 0 && workflow.doneCount === workflow.totalCount && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">Every step is done.</div>
        )
      )}

      <GroupProgress
        groups={workflow.groups.map((g) => ({ name: g.label, steps: g.steps.map((s) => s.status), current: g.current }))}
        summary={`${workflow.doneCount} of ${workflow.totalCount} steps complete${next ? ` · now on ${next.name}, waiting on ${OWNER_LABEL[next.owner]}` : ''}`}
      />

      <div className="space-y-3">
        {workflow.groups.map((g) => (
          <StepGroup
            key={g.id}
            name={g.label}
            statuses={g.steps.map((s) => s.status)}
            current={g.current}
            waitingOn={g.current && next ? OWNER_LABEL[next.owner] : undefined}
            days={g.current ? days : undefined}
            open={openGroup === g.id}
            onToggle={() => setOpenGroup((o) => (o === g.id ? null : g.id))}
          >
            {g.steps.map((s) => {
              const manual = (s.status === 'done' && !s.auto) || s.status === 'na'
              const open = s.status !== 'done' && s.status !== 'na'
              return (
                <StepRow
                  key={s.key}
                  icon={iconFor(s.key)}
                  name={s.name}
                  owner={OWNER_LABEL[s.owner]}
                  status={s.status}
                  reason={s.reason ?? undefined}
                  detail={s.status === 'done' ? (s.auto ? 'Done from the file' : s.doneOn ? `Done ${formatIsoDate(s.doneOn)}` : undefined) : s.status !== 'blocked' ? (s.reason ?? undefined) : undefined}
                  actionLabel={open ? label(s) : manual ? 'Undo' : undefined}
                  onAction={() => (open ? act(s) : markStep(s, null))}
                  secondaryLabel={open ? 'Skip' : undefined}
                  onSecondary={() => markStep(s, 'na')}
                  menu={open ? menuFor(s) : undefined}
                  actionFixesBlock={isUrla(s)}
                  busy={mark.isPending}
                />
              )
            })}
          </StepGroup>
        ))}
      </div>
    </div>
  )
}
