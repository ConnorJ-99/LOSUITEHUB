import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGrid, Input } from '@/components/shared'
import { useUpdateCard } from '@/lib/api/loans'
import { HOLD_REASONS } from '@/lib/pipeline/hold'
import { TIMELINE_OPTIONS } from '@/lib/pipeline/timeline'

/**
 * Puts a file on hold, or changes or ends its hold. The file stays in its
 * stage; the reason and timeline can be picked from the lists or typed.
 */
export function HoldDialog({ loan, onClose }: { loan: { id: string; onHoldAt: string | null; holdReason: string | null; timeline: string | null }; onClose: () => void }) {
  const update = useUpdateCard()
  const [reason, setReason] = useState(loan.holdReason ?? '')
  const [timeline, setTimeline] = useState(loan.timeline ?? '')
  const onHold = loan.onHoldAt !== null
  const listId = `hold-${loan.id}`

  const save = (hold: boolean) =>
    update.mutate(
      {
        loanId: loan.id,
        changes: hold
          ? { onHoldAt: loan.onHoldAt ?? new Date().toISOString(), holdReason: reason.trim() || null, timeline: timeline.trim() || null }
          : { onHoldAt: null, holdReason: null },
      },
      { onSuccess: () => (toast.success(hold ? (onHold ? 'Hold updated' : 'On hold') : 'Taken off hold'), onClose()), onError: (e) => toast.error(e.message) },
    )

  return (
    <Dialog open onOpenChange={(o) => !o && !update.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{onHold ? 'On hold' : 'Put on hold'}</DialogTitle>
          <DialogDescription>For a client waiting on something specific. The file stays in its stage and shows in On Hold Leads on the Leads page.</DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-1">
          <Input label="Reason" value={reason} onChange={setReason} list={`${listId}-reasons`} placeholder="Pick or type a reason" span={6} />
          <datalist id={`${listId}-reasons`}>
            {HOLD_REASONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <Input label="Timeline" value={timeline} onChange={setTimeline} list={`${listId}-timeline`} placeholder="e.g. 2 months, or after the lease is signed" span={6} />
          <datalist id={`${listId}-timeline`}>
            {TIMELINE_OPTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </FormGrid>
        <DialogFooter className="gap-2 sm:justify-between">
          {onHold ? (
            <Button variant="outline" onClick={() => save(false)} disabled={update.isPending}>
              Take off hold
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={() => save(true)} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : onHold ? 'Save' : 'Put on hold'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
