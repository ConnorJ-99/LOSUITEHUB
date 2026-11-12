// "Borrower portal" on a file's Overview (Stage 2): each borrower's portal link
// with Copy, Draft text / Draft email (Action Queue; nothing sends on its
// own), Renew and Turn off, plus the home requests they sent from the portal.
import { useNavigate } from 'react-router'
import { CopyIcon, MailIcon, MessageSquareIcon, PlusIcon, PowerOffIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, confirmAction } from '@/components/shared'
import { startNumbersUrl, useDraftPortalInvite, useMakePortalLink, usePortalLinks, usePortalRequests, useSetRequestStatus, useTurnOffPortalLink, type PortalLink, type PortalRequest } from '@/lib/api/portal'
import { useProfile } from '@/lib/api/settings'
import type { LoanProfile } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { useAuth } from '@/lib/auth/context'
import { formatIsoDate, relativeTime } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { REQUEST_STATUS_LABEL } from '../../../supabase/functions/document-upload/portal'

const copy = (url: string) =>
  navigator.clipboard
    ?.writeText(url)
    .then(() => toast.success('Portal link copied'))
    .catch(() => toast.error('Copy did not work; select the link instead.'))

export function PortalCard({ loan }: { loan: LoanProfile }) {
  const links = usePortalLinks(loan.id)
  const app = useApplication(loan.id)
  const requests = usePortalRequests(loan.id)
  const make = useMakePortalLink(loan.id)
  const off = useTurnOffPortalLink(loan.id)
  const draft = useDraftPortalInvite(loan.id)
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  const lo = useProfile(loan.assignedLo?.id ?? me)
  const readOnly = loan.stage === 'closed' || loan.stage === 'lost'
  if (links.data === null) return null // The borrower portal script hasn't run yet.
  const people = app.data?.borrowers ?? []
  const fail = (e: Error) => toast.error(e.message)

  const renew = async (contactId: string, name: string, existing: PortalLink | null) => {
    if (existing && !(await confirmAction(`Make a new portal link for ${name}? The old link stops working right away.`, { confirmLabel: 'New link' }))) return
    make.mutate({ organizationId: loan.organizationId, contactId }, { onSuccess: (url) => void copy(url), onError: fail })
  }
  const turnOff = async (l: PortalLink, name: string) => {
    if (!(await confirmAction(`Turn off ${name}'s portal link? It stops working right away. You can make a new one later.`, { confirmLabel: 'Turn off', destructive: true }))) return
    off.mutate(l.id, { onSuccess: () => toast.success('Portal link turned off'), onError: fail })
  }

  return (
    <Card title="Borrower portal" description="Status, documents, published letters and estimates, and home requests, on one private link per borrower.">
      <ul className="divide-y">
        {people.map((b) => {
          const name = `${b.person.firstName} ${b.person.lastName}`.trim()
          const link = links.data?.find((l) => l.contactId === b.contactId) ?? null
          const expired = link && Date.parse(link.expiresAt) <= Date.now()
          const to = { organizationId: loan.organizationId, loanId: loan.id, contactId: b.contactId, name, phone: b.person.phone, email: b.person.email, firstName: b.person.firstName, loName: lo.data?.fullName ?? 'Your loan officer', isPurchase: loan.purpose === 'purchase' }
          const queue = (channel: 'text' | 'email') =>
            link && draft.mutate({ ...to, url: link.url, channel }, { onSuccess: () => toast.success(`The ${channel} is waiting in the Action Queue. Nothing is sent until you press Send.`), onError: fail })
          return (
            <li key={b.contactId} className="space-y-2 py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold">{name}</span>
                <span className="text-xs text-muted-foreground">
                  {!link ? 'No portal link yet' : expired ? `Expired ${formatIsoDate(link.expiresAt.slice(0, 10))}` : `${link.lastOpenedAt ? `Opened ${relativeTime(link.lastOpenedAt)}` : 'Not opened yet'} · works until ${formatIsoDate(link.expiresAt.slice(0, 10))}`}
                </span>
              </div>
              {link && !expired && <p className="truncate rounded-md border bg-muted/50 px-2 py-1 font-mono text-xs">{link.url}</p>}
              {!readOnly && (
                <div className="flex flex-wrap gap-1.5">
                  {link && !expired ? (
                    <>
                      <Button size="xs" variant="outline" onClick={() => void copy(link.url)}>
                        <CopyIcon />
                        Copy link
                      </Button>
                      <Button size="xs" variant="outline" disabled={!b.person.phone || draft.isPending} title={b.person.phone ? 'Draft a text with the link (Action Queue)' : 'No phone on file'} onClick={() => queue('text')}>
                        <MessageSquareIcon />
                        Draft text
                      </Button>
                      <Button size="xs" variant="outline" disabled={!b.person.email || draft.isPending} title={b.person.email ? 'Draft an email with the link (Action Queue)' : 'No email on file'} onClick={() => queue('email')}>
                        <MailIcon />
                        Draft email
                      </Button>
                      <Button size="xs" variant="ghost" disabled={make.isPending} onClick={() => void renew(b.contactId, name, link)} title="A new link; the old one stops working">
                        <RefreshCwIcon />
                        Renew
                      </Button>
                      <Button size="xs" variant="ghost" disabled={off.isPending} onClick={() => void turnOff(link, name)}>
                        <PowerOffIcon />
                        Turn off
                      </Button>
                    </>
                  ) : (
                    <Button size="xs" disabled={make.isPending || !b.person.email} title={b.person.email ? undefined : 'Add their email first: they confirm it to open the portal'} onClick={() => void renew(b.contactId, name, null)}>
                      <PlusIcon />
                      {link ? 'Make a new link' : 'Make portal link'}
                    </Button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {(requests.data?.length ?? 0) > 0 && (
        <div className="mt-3 border-t pt-3">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Home requests</p>
          <ul className="space-y-2">
            {requests.data!.map((r) => (
              <RequestRow key={r.id} r={r} readOnly={readOnly} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

export function RequestRow({ r, readOnly, showName }: { r: PortalRequest; readOnly?: boolean; showName?: boolean }) {
  const navigate = useNavigate()
  const setStatus = useSetRequestStatus()
  const over = r.overPrice > 0 ? `Over approved max by ${formatCurrency(r.overPrice)}` : r.overLoanAmount > 0 ? `Over approved loan amount by ${formatCurrency(r.overLoanAmount)}` : null
  const down = r.downPaymentPct != null ? `${r.downPaymentPct}% down` : r.downPaymentAmount != null ? `${formatCurrency(r.downPaymentAmount)} down` : null
  const open = r.status === 'requested' || r.status === 'in_progress'
  const start = () => {
    if (r.status === 'requested') setStatus.mutate({ id: r.id, loanId: r.loanId, status: 'in_progress' }, { onError: (e) => toast.error(e.message) })
    navigate(startNumbersUrl(r))
  }
  return (
    <li className="text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {showName && `${r.borrowerName}: `}
            {r.address}
          </p>
          <p className="text-xs text-muted-foreground">
            {[formatCurrency(r.price), down, [r.wantsLetter && 'letter', r.wantsEstimate && 'estimate'].filter(Boolean).join(' + '), relativeTime(r.createdAt)].filter(Boolean).join(' · ')}
          </p>
          {over && <p className="text-xs font-medium text-urgent">{over}</p>}
          {r.notes && <p className="mt-0.5 text-xs text-muted-foreground italic">"{r.notes}"</p>}
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', r.status === 'ready' ? 'bg-emerald-50 text-emerald-700' : r.status === 'in_progress' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{REQUEST_STATUS_LABEL[r.status]}</span>
        {open && !readOnly && (
          <Button size="xs" onClick={start} title="Build estimates for this home with the price and down payment they asked for">
            Start numbers
          </Button>
        )}
      </div>
    </li>
  )
}
