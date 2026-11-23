import { RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/shared'
import { useHomeValueIndex, useRefreshHomeValueIndex } from '@/lib/api/homeValueIndex'

/**
 * Settings → Home value index: the FHFA quarters MyHome's home value estimate
 * uses (Dallas and Fort Worth), the last refresh, and Refresh now for owners
 * and admins. A timer checks every Monday; FHFA publishes once a quarter.
 */
export function HomeValueIndexCard({ canEdit }: { canEdit: boolean }) {
  const status = useHomeValueIndex()
  const refresh = useRefreshHomeValueIndex()
  if (status.isLoading) return null
  const s = status.data ?? null
  const run = s?.lastRun ?? null
  return (
    <Card
      title="Home value index"
      description="MyHome estimates a closed home's value from the FHFA home price index for Dallas or Fort Worth (Hood County uses Fort Worth). It's checked every Monday; FHFA publishes once a quarter."
      action={
        canEdit && s !== null ? (
          <Button
            size="sm"
            variant="outline"
            disabled={refresh.isPending}
            onClick={() =>
              refresh.mutate(undefined, {
                onSuccess: (r) => toast.success(r.newQuarters ? `Loaded ${r.newQuarters} new quarter${r.newQuarters === 1 ? '' : 's'} (latest ${r.latest}).` : `Up to date (latest ${r.latest}).`),
                onError: (e) => toast.error(e.message),
              })
            }
          >
            <RefreshCwIcon />
            {refresh.isPending ? 'Refreshing… (up to a minute)' : 'Refresh now'}
          </Button>
        ) : undefined
      }
    >
      {s === null ? (
        <p className="text-sm text-muted-foreground">The home value index turns on once its database script has run.</p>
      ) : (
        <div className="space-y-2 text-sm">
          {s.areas.length ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:max-w-md">
              {s.areas.map((a) => (
                <div key={a.area}>
                  <dt className="text-xs text-muted-foreground">{a.area}</dt>
                  <dd className="tabular-nums">
                    {a.quarter} · {a.index.toFixed(2)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-muted-foreground">Nothing loaded yet{canEdit ? '. Press Refresh now.' : '.'}</p>
          )}
          {run && (
            <p className={run.problem && !run.source ? 'text-destructive' : 'text-muted-foreground'}>
              Last refresh {new Date(run.ranAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              {run.source ? ` from ${run.source === 'fhfa' ? 'FHFA' : 'FRED'}` : ''}
              {run.problem ? `: ${run.problem}` : ''}
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
