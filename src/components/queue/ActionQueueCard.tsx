import { useState } from 'react'
import { InboxIcon } from 'lucide-react'
import { Card } from '@/components/shared'
import { useLoanQueue, type FileInfo } from '@/lib/api/queue'
import type { LoanProfile } from '@/lib/api/types'
import { relativeTime } from '@/lib/dates'
import { fullName } from '@/lib/pipeline/helpers'
import { ActionEntry } from './ActionEntry'
import { DraftFollowUpButton } from './DraftFollowUpButton'

const DECISION_LABEL = { approved: 'Approved', edited: 'Edited and approved', dismissed: 'Dismissed', pending: 'Waiting' } as const

/** The file's Action Queue: what the assistant prepared, waiting for Connor's decision. */
export function ActionQueueCard({ loan }: { loan: LoanProfile }) {
  const queue = useLoanQueue(loan.id)
  const [showDecided, setShowDecided] = useState(false)
  const file: FileInfo = {
    loanId: loan.id,
    organizationId: loan.organizationId,
    contactId: loan.borrower?.id ?? null,
    borrowerName: loan.borrower ? fullName(loan.borrower) : 'No borrower',
  }
  const pending = queue.data?.pending ?? []
  const decided = queue.data?.decided ?? []

  return (
    <Card
      title={`Action Queue${pending.length ? ` (${pending.length})` : ''}`}
      description="Drafts and suggestions from the assistant. Nothing is sent or saved until you approve it."
      action={<DraftFollowUpButton loanId={loan.id} borrowerFirstName={loan.borrower?.firstName ?? null} />}
    >
      {queue.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : queue.isError ? (
        <p className="text-sm text-destructive">{queue.error.message}</p>
      ) : (
        <div className="space-y-3">
          {pending.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <InboxIcon className="size-4" />
              Nothing waiting for you.
            </p>
          ) : (
            pending.map((item) => <ActionEntry key={item.id} item={item} file={file} />)
          )}
          {decided.length > 0 && (
            <div>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowDecided((s) => !s)}>
                {showDecided ? 'Hide' : 'Show'} recent decisions ({decided.length})
              </button>
              {showDecided && (
                <ul className="mt-2 divide-y text-sm">
                  {decided.map((d) => (
                    <li key={d.id} className="flex justify-between gap-2 py-1.5">
                      <span className="truncate">{d.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {DECISION_LABEL[d.status]}
                        {d.decidedAt && ` · ${relativeTime(d.decidedAt)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
