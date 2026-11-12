// Today's "Portal requests": homes borrowers asked for numbers on (with the
// over-limit flag) and documents they uploaded that wait for your review.
// Hidden when there's nothing to do.
import { Link } from 'react-router'
import { FileTextIcon } from 'lucide-react'
import { Card } from '@/components/shared'
import { useOpenPortalRequests, usePortalUploads } from '@/lib/api/portal'
import { relativeTime } from '@/lib/dates'
import { RequestRow } from './PortalCard'

export function PortalRequestsCard() {
  const requests = useOpenPortalRequests()
  const uploads = usePortalUploads()
  const reqs = requests.data ?? []
  const ups = uploads.data ?? []
  if (reqs.length === 0 && ups.length === 0) return null
  return (
    <Card className="border-t-2 border-t-primary" title="Portal requests" description="From borrowers' portal and upload links">
      {reqs.length > 0 && (
        <ul className="space-y-3">
          {reqs.map((r) => (
            <RequestRow key={r.id} r={r} showName />
          ))}
        </ul>
      )}
      {ups.length > 0 && (
        <div className={reqs.length ? 'mt-3 border-t pt-3' : ''}>
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">New uploads to review</p>
          <ul className="space-y-1.5">
            {ups.map((u) => (
              <li key={u.id}>
                <Link to={`/loans/${u.loanId}?tab=documents`} className="flex items-center gap-2 text-sm hover:underline">
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{u.borrowerName}</span>: {u.label}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(u.receivedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
