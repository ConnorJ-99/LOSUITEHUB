// Today's "MyHome" box (nurture goals Phase 4, Connor 2026-11-24): what
// borrowers sent from MyHome that waits for you, on files you can see: open
// asks (check my value, refi, equity) and goal updates to verify. Each opens
// the file's MyHome tab, where the ask is marked done or the update verified
// (the Nurture view's Updates card verifies too). Hidden when there's nothing.
import { Link } from 'react-router'
import { HomeIcon, TargetIcon } from 'lucide-react'
import { Card } from '@/components/shared'
import { useMyHomeActivity } from '@/lib/api/myhome'
import { relativeTime } from '@/lib/dates'

export function MyHomeActivityCard() {
  const activity = useMyHomeActivity()
  const rows = activity.data ?? []
  if (!rows.length) return null
  return (
    <Card className="border-t-2 border-t-primary" title="MyHome" description="Asks and goal updates from borrowers' MyHome">
      <ul className="space-y-2">
        {rows.slice(0, 8).map((r) => (
          <li key={`${r.kind}:${r.id}`}>
            <Link to={`/loans/${r.loanId}?tab=myhome`} className="flex items-start gap-2 text-sm hover:underline">
              {r.kind === 'ask' ? <HomeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <TargetIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span className="font-medium">{r.name}</span>: {r.what}
                <span className="block text-xs text-muted-foreground">
                  {r.kind === 'goal' ? 'To verify · ' : ''}
                  {relativeTime(r.at)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {rows.length > 8 && <p className="mt-2 text-xs text-muted-foreground">And {rows.length - 8} more.</p>}
    </Card>
  )
}
