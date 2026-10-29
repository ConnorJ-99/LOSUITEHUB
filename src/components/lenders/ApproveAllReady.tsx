import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, confirmAction } from '@/components/shared'
import { useApproveAllReady, useWaitingAiCount, type ApproveAllResult } from '@/lib/api/matrixImports'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * "Approve all ready": approves every assistant reading with no errors (one
 * lender, or every lender when lenderId is null), the same as approving each on
 * its review screen. What still needs Connor is listed afterwards.
 */
export function ApproveAllReadyButton({ lenderId, onDone }: { lenderId: string | null; onDone: (r: ApproveAllResult) => void }) {
  const waiting = useWaitingAiCount(lenderId)
  const approve = useApproveAllReady(lenderId)
  const count = waiting.data ?? 0
  if (count === 0 && !approve.isPending) return null
  const run = async () => {
    const where = lenderId ? 'this lender' : 'every lender'
    const ok = await confirmAction(
      `Approve every reading the assistant made for ${where} that has no errors (${plural(count, 'reading')} waiting)? Each is approved exactly as it would be on its review screen: matched to the product it fills in, and live in Product Search right away. Readings with errors, and drafts typed by hand, stay for you to review.`,
      { confirmLabel: 'Approve all ready' },
    )
    if (!ok) return
    approve.mutate(undefined, {
      onSuccess: (r) => {
        toast.success(`Approved ${plural(r.readings, 'reading')}: ${plural(r.programs, 'program')}, ${r.cells} cells.${r.needsReview.length ? ` ${r.needsReview.length} still need you.` : ''}`)
        onDone(r)
      },
      onError: (e) => toast.error(e.message),
    })
  }
  return (
    <Button size="sm" disabled={approve.isPending} onClick={run} title="Approves every assistant reading that has no errors, the same as approving each one on its review screen">
      {approve.isPending ? (approve.progress ? `Approving ${approve.progress.done} of ${approve.progress.total}…` : 'Approving…') : `Approve all ready (${count})`}
    </Button>
  )
}

/** After "Approve all ready": the readings that still need a look, each with why and a link. */
export function NeedsReviewList({ result, showLender, onClose }: { result: ApproveAllResult; showLender: boolean; onClose: () => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? result.needsReview : result.needsReview.slice(0, 15)
  return (
    <Card
      title={result.needsReview.length ? `${plural(result.needsReview.length, 'reading')} still need you` : 'Every ready reading is approved'}
      description={`Approved ${plural(result.readings, 'reading')} (${plural(result.programs, 'program')}, ${result.cells} cells).${result.needsReview.length ? ' These have something to fix first; open one to see it beside the PDF.' : ''}`}
      action={
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {result.needsReview.length > 0 && (
        <ul className="divide-y">
          {shown.map((n) => (
            <li key={n.importId} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {showLender && `${n.lenderName} · `}
                  {n.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {n.reasons[0]}
                  {n.reasons.length > 1 && ` (+${n.reasons.length - 1} more)`}
                </p>
              </div>
              <Button size="sm" variant="outline" asChild>
                <Link to={`/admin/lenders/imports/${n.importId}`}>Review</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {result.needsReview.length > shown.length && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll(true)}>
          Show all {result.needsReview.length}
        </Button>
      )}
    </Card>
  )
}
