import { useState } from 'react'
import { StarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DateInput, Input, ToggleChip, confirmAction } from '@/components/shared'
import { useLoanReview, useReviewActions } from '@/lib/api/reviews'
import { REVIEW_STATUS_LABEL } from '@/lib/closed/reviews'
import { formatIsoDate, todayIso } from '@/lib/dates'

/**
 * A closed file's review request: its status, "Request review" for older
 * loans (a draft in the Action Queue, never sent here), "Mark review
 * received", and "Don't ask for a review". Changes are logged.
 */
export function ReviewPanel({ loanId }: { loanId: string }) {
  const review = useLoanReview(loanId)
  const act = useReviewActions(loanId)
  const [receivedOn, setReceivedOn] = useState<string | null>(null)
  const [note, setNote] = useState('')
  if (review.isError) return <p className="text-xs text-muted-foreground">Review requests show once the review requests database script has run.</p>
  if (!review.data) return null
  const r = review.data
  const fail = (e: Error) => toast.error(e.message)

  return (
    <div className="rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <StarIcon className="size-4 text-money" />
          Review: {r.skip ? "Don't ask" : REVIEW_STATUS_LABEL[r.status]}
          <span className="font-normal text-muted-foreground">
            {r.requestedAt && ` · asked ${formatIsoDate(r.requestedAt.slice(0, 10))}`}
            {r.receivedOn && ` · received ${formatIsoDate(r.receivedOn)}`}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          {r.status === 'not_requested' && !r.skip && (
            <Button size="sm" variant="outline" disabled={act.request.isPending} onClick={() => act.request.mutate(undefined, { onSuccess: (res) => (res === 'drafted' ? toast.success('Review request drafted in the Action Queue') : toast.message(`Not drafted: ${res}`)), onError: fail })}>
              Request review
            </Button>
          )}
          {r.status !== 'received' && (r.status === 'requested' || r.status === 'follow_up_sent' || r.status === 'drafted') && (
            <>
              <div className="w-36">
                <DateInput label="Received on" value={receivedOn ?? todayIso()} onChange={setReceivedOn} />
              </div>
              <Button size="sm" className="self-end" disabled={act.received.isPending} onClick={() => act.received.mutate(receivedOn, { onSuccess: () => toast.success('Review received. No follow-up will be drafted.'), onError: fail })}>
                Mark review received
              </Button>
            </>
          )}
        </div>
      </div>
      {r.status !== 'received' && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <ToggleChip
            label="Don't ask for a review"
            pressed={r.skip}
            onChange={async (on) => {
              if (on && !(await confirmAction("Don't ask this client for a review? No request or follow-up will be drafted.", { confirmLabel: "Don't ask" }))) return
              act.skip.mutate({ skip: on, note }, { onError: fail })
            }}
          />
          {!r.skip && <div className="min-w-48 flex-1"><Input label="Note (optional)" value={note} onChange={setNote} placeholder="Why not, for the record" /></div>}
          {r.skip && r.skipNote && <span className="text-xs text-muted-foreground">{r.skipNote}</span>}
        </div>
      )}
    </div>
  )
}
