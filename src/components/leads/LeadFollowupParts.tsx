// What a lead follow-up shows in the Action Queue (Connor, 2026-11-16): the
// Next Action, stage, time frame, last contact and why it was suggested, a
// High priority mark, plus Snooze (pick a date) and View lead.
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AlarmClockIcon, ExternalLinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { DateInput, FormGrid } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { useLeadFollowupMeta, useSnoozeFollowup } from '@/lib/api/leadFollowups'
import { KIND_LABEL, type LeadContext } from '@/lib/leads/followups'
import { lastContactLabel, nextActionInfo } from '@/lib/leads/nextAction'
import { centralToday, readyChip } from '@/lib/pipeline/card'
import { stageLabel } from '@/lib/pipeline/stages'
import { addDays } from '@/lib/closed/keyDates'
import { formatIsoDate, todayIso } from '@/lib/dates'

export function LeadContextBlock({ itemId, lead }: { itemId: string; lead: LeadContext }) {
  const meta = useLeadFollowupMeta()
  const [now] = useState(() => new Date())
  const high = meta.data?.get(itemId)?.priority === 'high'
  const info = nextActionInfo(lead.nextAction)
  const chip = readyChip({ timeline: lead.timeline, readyOn: lead.readyOn }, centralToday(now))
  return (
    <div className="mb-2 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        {high && <span className="rounded bg-[#D4483B] px-1.5 py-0.5 text-[11px] font-bold text-white">High priority</span>}
        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', info?.className ?? 'bg-[#e5e9ef] text-[#374151]')}>{KIND_LABEL[lead.nextAction]}</span>
        {lead.stage && <span className="rounded bg-muted px-1.5 py-0.5">{stageLabel(lead.stage as Parameters<typeof stageLabel>[0])}</span>}
        {chip && (
          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-900">
            {chip.label}
            {chip.detail && <span className="opacity-75"> · {chip.detail}</span>}
          </span>
        )}
        <span className="text-muted-foreground">{lastContactLabel(lead.lastContactAt, now)}</span>
      </div>
      {lead.reason && <p className="text-muted-foreground">Why: {lead.reason}</p>}
    </div>
  )
}

/** Snooze… (hides it from Today until the day picked) and View lead. */
export function LeadFollowupButtons({ itemId, loanId, disabled }: { itemId: string; loanId: string; disabled?: boolean }) {
  const navigate = useNavigate()
  const snooze = useSnoozeFollowup()
  const [open, setOpen] = useState(false)
  const [until, setUntil] = useState<string | null>(() => addDays(todayIso(), 1))
  const save = () => {
    if (!until || until <= todayIso()) return toast.error('Pick a day after today.')
    snooze.mutate(
      { id: itemId, until },
      {
        onSuccess: () => {
          toast.success(`Snoozed until ${formatIsoDate(until)}`)
          setOpen(false)
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }
  return (
    <>
      <Button size="sm" variant="outline" disabled={disabled || snooze.isPending} onClick={() => setOpen(true)} title="Hide it until a day you pick">
        <AlarmClockIcon />
        Snooze…
      </Button>
      <Button size="sm" variant="outline" onClick={() => navigate(`/loans/${loanId}`)} title="Open the file">
        <ExternalLinkIcon />
        View lead
      </Button>
      {open && (
        <EditDialog title="Snooze this follow-up" open onOpenChange={setOpen} onSubmit={save} saving={snooze.isPending} submitLabel="Snooze">
          <FormGrid>
            <DateInput label="Show it again on" value={until} onChange={setUntil} span={3} />
          </FormGrid>
        </EditDialog>
      )}
    </>
  )
}
