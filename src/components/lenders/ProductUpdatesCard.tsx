import { Link } from 'react-router'
import { Card } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useProductUpdates, type ProductUpdate } from '@/lib/api/productUpdates'

const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US')

function statusText(u: ProductUpdate): string {
  if (u.status === 'discarded') return 'Discarded'
  if (u.status === 'pending_review') return 'Waiting for review'
  const waiting = u.drafts.filter((d) => d.status === 'pending_review').length
  return waiting ? `Confirmed · ${waiting} draft${waiting === 1 ? '' : 's'} to approve` : u.drafts.length ? 'Confirmed · approved' : 'Confirmed · guideline text only'
}

/**
 * Pasted lender emails (Phase 0b): one lender's, newest first, or with no
 * lender every update still waiting for review (hidden when there are none).
 */
export function ProductUpdatesCard({ lenderId, action }: { lenderId: string | null; action?: React.ReactNode }) {
  const updates = useProductUpdates(lenderId)
  const list = updates.data ?? []
  if (!lenderId && list.length === 0) return null
  return (
    <Card title={lenderId ? 'Product updates' : 'Product updates waiting for review'} description="Lender emails pasted in. Each proposed change is checked against the email and approved as a new matrix version." action={action}>
      {updates.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : updates.error ? (
        <p className="text-sm text-destructive">{updates.error.message}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet. When a lender emails a product or guideline change, paste it here.</p>
      ) : (
        <ul className="divide-y">
          {list.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{u.subject || u.pastedText.slice(0, 70).replace(/\s+/g, ' ')}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {!lenderId && `${u.lenderName ?? 'Lender not picked'} · `}
                  {fmtDate(u.receivedOn)} · {statusText(u)}
                </span>
              </span>
              <Button size="sm" variant={u.status === 'pending_review' ? 'default' : 'outline'} asChild>
                <Link to={`/admin/lenders/updates/${u.id}`}>{u.status === 'pending_review' ? 'Review' : 'Open'}</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
