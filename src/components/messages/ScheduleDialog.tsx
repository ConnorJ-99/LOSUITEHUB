import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DateInput, FormGrid, Input } from '@/components/shared'
import { useMessagingSettings } from '@/lib/api/ghl'
import { defaultSchedule, fromCentral, scheduleLabel } from '@/lib/messaging/schedule'
import { sendWindow } from '../../../supabase/functions/ghl/sendRules'
import { TONE_CLASS } from './tone'

/**
 * Pick when an approved message goes out (Central time). Scheduling IS the
 * approval: MPS HQ sends it at that time as you, after checking everything
 * again then. It must be inside sending hours.
 */
export function ScheduleDialog({ what, busy, onSchedule, onClose }: { what: string; busy: boolean; onSchedule: (sendAt: Date) => void; onClose: () => void }) {
  const settings = useMessagingSettings()
  const [openedAt] = useState(() => Date.now())
  const [pick, setPick] = useState(() => defaultSchedule(new Date(openedAt)))
  const at = fromCentral(pick.date, pick.time)
  const hours = settings.data?.sendHours
  const problem = !at
    ? 'Pick a day and a time.'
    : at.getTime() < openedAt + 60_000
      ? 'Pick a time from a minute from now.'
      : at.getTime() > openedAt + 60 * 86400e3
        ? 'Pick a time within 60 days.'
        : hours && !sendWindow(hours, at).open
          ? 'That time is outside sending hours (Settings → Sending), so it would not go out.'
          : null

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule {what}</DialogTitle>
          <DialogDescription>Scheduling approves it. MPS HQ sends it at that time from your GHL number or email, after checking consent, sending hours and opt-outs again. You can cancel it until then.</DialogDescription>
        </DialogHeader>
        <FormGrid>
          <DateInput label="Day" value={pick.date} onChange={(date) => setPick((p) => ({ ...p, date: date ?? '' }))} required span={3} />
          <Input label="Time (Central)" type="time" value={pick.time} onChange={(time) => setPick((p) => ({ ...p, time }))} required span={3} />
        </FormGrid>
        <p className={`w-fit ${problem ? TONE_CLASS.warn : TONE_CLASS.ok}`}>{problem ?? `Goes out ${scheduleLabel(at!)}`}</p>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !!problem} onClick={() => at && onSchedule(at)}>
            {busy ? 'Scheduling…' : 'Approve and schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
