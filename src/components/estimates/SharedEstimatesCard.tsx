import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, confirmAction } from '@/components/shared'
import { useEstimateShares, useRevokeShare, type EstimateShare } from '@/lib/api/estimateShares'
import { shareStatus, shareUrl, type ShareStatus } from '@/lib/estimates/share'
import { asOfText } from '../../../supabase/functions/estimate-view/rules'

const STATUS: Record<ShareStatus, { label: string; className: string }> = {
  not_opened: { label: 'Not opened', className: 'bg-muted text-muted-foreground' },
  opened: { label: 'Opened', className: 'bg-primary/10 text-primary' },
  picked: { label: 'Picked an option', className: 'bg-emerald-50 text-emerald-700' },
  expired: { label: 'Expired', className: 'bg-muted text-muted-foreground' },
  revoked: { label: 'Revoked', className: 'bg-red-50 text-urgent' },
}

/** The file's shared estimates links: who, when, opened, picked, expiry; Revoke and Copy link. */
export function SharedEstimatesCard({ loanId, readOnly }: { loanId: string; readOnly: boolean }) {
  const shares = useEstimateShares(loanId)
  const revoke = useRevokeShare(loanId)
  if (!shares.data?.length) return null

  const copy = async (s: EstimateShare) => {
    try {
      await navigator.clipboard.writeText(shareUrl(window.location.origin, s.token))
      toast.success('Link copied')
    } catch {
      toast.error("Couldn't copy the link.")
    }
  }
  const stop = async (s: EstimateShare) => {
    if (!(await confirmAction(`Revoke the link sent to ${s.contactName}? It stops working right away and can't be turned back on. To share again, send a new link.`, { confirmLabel: 'Revoke' }))) return
    revoke.mutate(s.id, { onSuccess: () => toast.success('Link revoked'), onError: (e) => toast.error(e.message) })
  }

  return (
    <Card title="Shared estimates">
      <ul className="divide-y">
        {shares.data.map((s) => {
          const status = shareStatus(s)
          const live = status !== 'expired' && status !== 'revoked'
          const picked = s.snapshot.options.find((o) => o.estimateId === s.pickedEstimateId)
          return (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {s.contactName} <span className="font-normal text-muted-foreground">· by {s.channel} · {asOfText(s.createdAt)}</span>
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${STATUS[status].className}`}>{STATUS[status].label}</span>
                </p>
                <p className="text-xs text-muted-foreground">{s.snapshot.options.map((o) => `${o.name}: ${o.program}`).join(' · ')}</p>
                <p className="text-xs text-muted-foreground">
                  {s.firstOpenedAt ? `Opened ${s.views} time${s.views === 1 ? '' : 's'}, last ${asOfText(s.lastOpenedAt ?? s.firstOpenedAt)}` : 'Not opened yet'}
                  {picked ? ` · Interested in ${picked.name} (${picked.program})` : ''}
                  {' · '}
                  {s.revokedAt ? `Revoked ${asOfText(s.revokedAt)}` : `${live ? 'Expires' : 'Expired'} ${asOfText(s.expiresAt)}`}
                </p>
              </div>
              {live && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => void copy(s)}>
                    Copy link
                  </Button>
                  {!readOnly && (
                    <Button size="sm" variant="outline" onClick={() => void stop(s)} disabled={revoke.isPending}>
                      Revoke
                    </Button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
