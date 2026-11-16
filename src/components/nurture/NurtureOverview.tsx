// The nurture view of a file (Connor, 2026-11-16; plan docs/plans/buyer-nurture.md
// Step 3): shown instead of the active-loan Overview while the file is in
// Nurture. Same design, different layout: where they stand in Nurture, who
// they are, their financial readiness (worked out from the 1003 and credit,
// nothing re-entered), the readiness plan and the conversation. Lender,
// pricing, estimates and closing items aren't shown here.
import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, DateInput, FormGrid, Select } from '@/components/shared'
import { ReadinessCard, useLiveReadiness } from '@/components/prequal/Readiness'
import { ReadinessPlanCard } from './ReadinessPlanCard'
import { NurtureUpdatesCard } from './NurtureUpdatesCard'
import { EVENT_LABEL } from '@/lib/prequal/readiness'
import { MoveToNurtureDialog } from './MoveToNurtureDialog'
import { useCreditEvents } from '@/lib/api/creditEvents'
import { useNotes } from '@/lib/api/notes'
import { useThread } from '@/lib/api/messages'
import { useNurtureFields, useUpdateNurture } from '@/lib/api/nurture'
import { useFeeTemplates } from '@/lib/api/pricing'
import type { LoanProfile, Property } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { formatIsoDate, relativeTime, todayIso } from '@/lib/dates'
import { prequalFeeEstimate } from '@/lib/estimates/prequal'
import { formatCurrency, formatPercent } from '@/lib/format'
import { daysInNurture, followUpOverdue, NURTURE_STAGES, obstacleLabel, type NurtureStage } from '@/lib/nurture/obstacles'
import { draftFrom, prequalSummary } from '@/lib/prequal/draft'

const Row = ({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'warn' }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-dashed py-1.5 text-sm last:border-0">
    <span className="text-muted-foreground">{label}</span>
    <span className={cn('text-right font-medium tabular-nums', tone === 'warn' && 'text-[#b4372c]')}>{value}</span>
  </div>
)

export function NurtureOverview({ loan, app, properties, realtor, onGoToTab }: { loan: LoanProfile; app: Application; properties: Property[]; realtor: string | null; onGoToTab: (tab: string) => void }) {
  const fields = useNurtureFields(loan.id)
  const update = useUpdateNurture()
  const [editing, setEditing] = useState(false)
  const templates = useFeeTemplates()
  const draft = draftFrom(loan, app, properties, false)
  const summary = prequalSummary(loan, draft, properties, prequalFeeEstimate(loan, templates.data ?? []))
  const readiness = useLiveReadiness(loan, app, summary, draft)
  const people = app.borrowers.map((b) => b.contactId)
  const events = useCreditEvents(loan.id, people)
  const thread = useThread(people)
  const notes = useNotes(loan.borrower?.id)
  const [now] = useState(() => new Date())
  const today = todayIso()

  if (fields.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  const f = fields.data
  if (!f) return <Card title="Nurture"><p className="text-sm text-destructive">The nurture view turns on once the nurture database script has run.</p></Card>

  const days = daysInNurture(f.enteredAt, now)
  const overdue = followUpOverdue(f.nextFollowUp, today)
  const save = (patch: Parameters<typeof update.mutate>[0]) => update.mutate(patch, { onError: (e) => toast.error(e.message) })
  const funds = summary.funds
  const needed = summary.cashNeeded
  const gap = funds !== null && needed !== null ? needed - funds : null
  const recent = [...(thread.data ?? [])].sort((a, b) => b.sentAt.localeCompare(a.sentAt)).slice(0, 5)
  const recentNotes = (notes.data ?? []).filter((n) => n.loanId === loan.id || !n.loanId).slice(0, 3)

  return (
    <div className="space-y-4">
      <Card
        className="border-t-2 border-t-[#2E8B6A]"
        title="Nurture"
        description={`Preparing for homeownership${days !== null ? ` · ${days} day${days === 1 ? '' : 's'} in Nurture (since ${formatIsoDate(f.enteredAt!.slice(0, 10))})` : ''}`}
      >
        <FormGrid>
          <Select label="Nurture stage" value={f.stage ?? 'initial_review'} options={NURTURE_STAGES.map((s) => ({ value: s.id, label: s.label }))} onChange={(v) => v && save({ loanId: loan.id, nurture_stage: v as NurtureStage })} span={3} />
          <DateInput label="Next follow-up" value={f.nextFollowUp} onChange={(v) => save({ loanId: loan.id, nurture_next_follow_up: v })} span={2} error={overdue ? 'Overdue' : undefined} />
        </FormGrid>
        <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Target time frame: </span>
            <span className="font-medium">{f.target ?? '—'}</span>
          </div>
          {f.note && (
            <div className="min-w-0">
              <span className="text-muted-foreground">Note: </span>
              {f.note}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Borrower">
          <Row label="Name" value={app.borrowers.map((b) => `${b.person.firstName} ${b.person.lastName}`.trim()).join(' & ') || '—'} />
          <Row label="Phone" value={loan.borrower?.phone ?? '—'} />
          <Row label="Email" value={loan.borrower?.email ?? '—'} />
          <Row label="Loan officer" value={loan.assignedLo?.name ?? '—'} />
          <Row label="Referring realtor" value={realtor ?? '—'} />
          <Row label="Referral source" value={loan.referralSource ?? '—'} />
          <Row label="Status shown to partners" value={f.partnerStatus ?? '—'} />
        </Card>

        <Card title="Financial readiness" description="From the 1003 and credit on file. Estimates are marked.">
          <Row label="Credit score" value={summary.creditScore !== null ? `${summary.creditScore} (estimate)` : 'Not on file'} />
          <Row label="Credit history on file" value={events.data ? (events.data.length ? `${events.data.length} item${events.data.length === 1 ? '' : 's'}` : 'None') : '—'} />
          <Row label="Monthly income" value={summary.totalIncome > 0 ? formatCurrency(summary.totalIncome) : 'Not on the 1003'} />
          <Row label="Monthly debts" value={formatCurrency(summary.otherDebts)} />
          <Row label="DTI (front / back)" value={summary.dti.back === null ? '—' : `${formatPercent(summary.dti.front, 1)} / ${formatPercent(summary.dti.back, 1)}`} tone={summary.dti.back !== null && summary.dti.back > draft.loan.maxDtiPct ? 'warn' : undefined} />
          <Row label="Savings for closing" value={funds === null ? 'Not on the 1003' : formatCurrency(funds)} />
          <Row label="Cash needed (estimate)" value={needed === null ? '—' : formatCurrency(needed)} />
          {gap !== null && <Row label={gap > 0 ? 'Short by' : 'Cushion'} value={formatCurrency(Math.abs(gap))} tone={gap > 0 ? 'warn' : undefined} />}
        </Card>
      </div>

      <ReadinessCard loan={loan} view={readiness} />

      <ReadinessPlanCard
        loan={loan}
        obstacles={f.obstacles}
        onEditObstacles={() => setEditing(true)}
        facts={{
          firstName: loan.borrower?.firstName ?? '',
          borrowerName: app.borrowers.map((b) => `${b.person.firstName} ${b.person.lastName}`.trim()).join(' & ') || 'Borrower',
          target: f.target,
          ai: {
            firstName: loan.borrower?.firstName ?? '',
            today,
            timeframe: f.target,
            obstacles: f.obstacles.map((key) => ({ key, label: obstacleLabel(key) })),
            creditScoreEstimate: summary.creditScore,
            creditHistory: (events.data ?? []).map((e) => `${EVENT_LABEL[e.eventType]}${e.eventDate ? ` (${e.eventDate})` : ''}`),
            monthlyIncome: summary.totalIncome > 0 ? summary.totalIncome : null,
            monthlyDebts: summary.otherDebts,
            dtiBackPct: summary.dti.back,
            maxDtiPct: draft.loan.maxDtiPct,
            savings: funds,
            cashNeeded: needed,
            readinessNotes: readiness?.result.reasons.map((r) => r.text) ?? [],
            note: f.note,
          },
        }}
      />

      <NurtureUpdatesCard loanId={loan.id} organizationId={loan.organizationId} firstName={loan.borrower?.firstName ?? ''} messages={thread.data ?? []} />

      <Card
        title="Communication"
        action={
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => onGoToTab('messages')}>
              Messages
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onGoToTab('notes')}>
              Notes
            </Button>
          </div>
        }
      >
        {recent.length === 0 && recentNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages or notes yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {recent.map((m) => (
              <li key={m.id} className="flex gap-2">
                <span className={cn('shrink-0 text-xs font-semibold', m.direction === 'inbound' ? 'text-emerald-700' : 'text-muted-foreground')}>{m.direction === 'inbound' ? 'They wrote' : 'You sent'}</span>
                <span className="min-w-0 flex-1 truncate">{m.body}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(m.sentAt)}</span>
              </li>
            ))}
            {recentNotes.map((n) => (
              <li key={n.id} className="flex gap-2">
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">Note</span>
                <span className="min-w-0 flex-1 truncate">{n.body}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <MoveToNurtureDialog target={{ loanId: loan.id, borrowerName: loan.borrower?.firstName ?? 'Borrower', editing: { obstacles: f.obstacles, target: f.target, note: f.note } }} onClose={() => setEditing(false)} />}
    </div>
  )
}
