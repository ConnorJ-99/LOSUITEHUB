// "Publish to borrower" on a pre-approval letter or estimate PDF (Documents
// and Letters). Only published ones show in the borrower portal. Publishing
// one for a home the borrower asked about marks the request Ready and drafts
// "your numbers are ready" in the Action Queue (never sent on its own).
import { GlobeIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { confirmAction } from '@/components/shared'
import { isPublishable, usePublishDocument, usePublished } from '@/lib/api/portal'
import { useProfile } from '@/lib/api/settings'
import type { LoanProfile } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'

export function PublishToggle({ loan, documentId, kind, className }: { loan: LoanProfile; documentId: string; kind: string; className?: string }) {
  const published = usePublished(loan.id)
  const publish = usePublishDocument(loan.id)
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  const lo = useProfile(loan.assignedLo?.id ?? me)
  if (!isPublishable(kind) || !published.data?.ready) return null
  const at = published.data.at.get(documentId) ?? null

  const flip = async () => {
    const on = !at
    const question = on ? 'Publish this to the borrower portal? The borrower can open and download it there.' : 'Take this out of the borrower portal? The borrower will no longer see it there.'
    if (!(await confirmAction(question, { confirmLabel: on ? 'Publish' : 'Unpublish' }))) return
    publish.mutate(
      { documentId, publish: on, userId: me, loName: lo.data?.fullName ?? 'Your loan officer' },
      {
        onSuccess: (drafts) => toast.success(on ? (drafts ? 'Published. "Your numbers are ready" is waiting in the Action Queue.' : 'Published to the borrower portal') : 'Taken out of the borrower portal'),
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <button
      type="button"
      onClick={() => void flip()}
      disabled={publish.isPending}
      aria-pressed={!!at}
      title={at ? `In the borrower portal since ${new Date(at).toLocaleDateString('en-US')}. Click to take it out.` : 'Show it in the borrower portal'}
      className={cn('inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap disabled:opacity-60', at ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'bg-card text-muted-foreground hover:text-foreground', className)}
    >
      <GlobeIcon className="size-3" />
      {at ? 'Published to borrower' : 'Publish to borrower'}
    </button>
  )
}
