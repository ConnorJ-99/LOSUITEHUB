// "Borrower portal" on a file's Overview (Stage 2): each borrower's portal link
// with Copy, Draft text / Draft email (Action Queue; nothing sends on its
// own), Renew and Turn off, plus the home requests they sent from the portal.
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { CopyIcon, HomeIcon, MailIcon, MessageSquareIcon, PlusIcon, PowerOffIcon, RefreshCwIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, confirmAction, CurrencyInput } from '@/components/shared'
import { ASK_LABEL, useHandleMyHomeAsk, useMyHomeAccounts, useMyHomeAsks, useSendMyHomeCode, useTurnOffMyHome, type MyHomeAccount, type MyHomeAsk } from '@/lib/api/myhome'
import { startNumbersUrl, useDraftMyHomeInvite, useDraftPortalInvite, useMakePortalLink, usePortalLinks, usePortalRequests, useSetRequestStatus, useTurnOffPortalLink, type PortalLink, type PortalRequest } from '@/lib/api/portal'
import { useProfile } from '@/lib/api/settings'
import type { LoanProfile } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { useAuth } from '@/lib/auth/context'
import { formatIsoDate, relativeTime } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { myHomeUrl } from '@/lib/portal/messages'
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
  const people = app.data?.borrowers ?? []
  if (links.data === null) return null // The borrower portal script hasn't run yet.
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

/**
 * The primary borrower's MyHome account (Stage 1): "Send MyHome code to GHL"
 * puts their permanent code and link on their GHL contact and adds the tag
 * that starts Connor's MyHome email workflow (nothing is sent from MPS-HQ
 * itself). New code (the old code and link stop working) and Turn off.
 * Copy link / Draft text / Draft email (Connor, 2026-11-23): MyHome's plain
 * address, which carries no code (they sign in with email + code), drafted
 * into the Action Queue like every file text; on open and closed files.
 */
export function MyHomeLine({
  organizationId,
  loanId,
  contactId,
  name,
  person,
  loName,
  closed,
  account,
  readOnly,
}: {
  organizationId: string
  loanId: string
  contactId: string
  name: string
  person: { firstName: string; phone: string | null; email: string | null }
  loName: string
  closed: boolean
  account: MyHomeAccount | null
  readOnly: boolean
}) {
  const send = useSendMyHomeCode()
  const off = useTurnOffMyHome()
  const draft = useDraftMyHomeInvite(loanId)
  const hasEmail = !!person.email
  const live = !!account && account.status !== 'off'
  const url = myHomeUrl(window.location.origin)
  const queue = (channel: 'text' | 'email') =>
    draft.mutate(
      { organizationId, loanId, contactId, name, phone: person.phone, email: person.email, firstName: person.firstName, loName, url, closed, channel },
      { onSuccess: () => toast.success(`The ${channel} is waiting in the Action Queue. Nothing is sent until you press Send.`), onError: (e) => toast.error(e.message) },
    )
  const status = !account
    ? 'Not sent yet'
    : account.status === 'off'
      ? 'Turned off'
      : account.lastSignedInAt
        ? `Signed in ${relativeTime(account.lastSignedInAt)}`
        : account.codeSentAt
          ? `Code sent to GHL ${relativeTime(account.codeSentAt)}, not signed in yet`
          : 'Code not sent to GHL yet'
  const go = (newCode: boolean) =>
    send.mutate(
      { organizationId, loanId, contactId, newCode },
      {
        onSuccess: (r) => ('skipped' in r ? toast.warning(r.skipped) : toast.success(`${name}'s MyHome code and link are in GHL, and the "home management code" tag is on. Your GHL workflow sends the email.`)),
        onError: (e) => toast.error(e.message),
      },
    )
  const newCode = async () => {
    if (!(await confirmAction(`Make a new MyHome code and link for ${name}? The old code and link stop working right away. The new ones go to GHL.`, { confirmLabel: 'New code' }))) return
    go(true)
  }
  const turnOff = async () => {
    if (!account || !(await confirmAction(`Turn off ${name}'s MyHome? They can't sign in until you send their code again.`, { confirmLabel: 'Turn off', destructive: true }))) return
    off.mutate(account.id, { onSuccess: () => toast.success('MyHome turned off'), onError: (e) => toast.error(e.message) })
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1.5">
      <HomeIcon className="size-3.5 text-primary" />
      <span className="text-xs font-semibold">MyHome</span>
      <span className="mr-auto text-xs text-muted-foreground">{status}</span>
      {!readOnly && (
        <>
          <Button
            size="xs"
            variant="outline"
            disabled={!hasEmail || send.isPending}
            title={hasEmail ? 'Puts their MyHome code and link in GHL and adds the "home management code" tag, which starts your GHL email' : 'Add their email first: it is how they sign in'}
            onClick={() => go(false)}
          >
            <SendIcon />
            {live && account?.codeSentAt ? 'Send code again' : 'Send MyHome code to GHL'}
          </Button>
          {live && (
            <>
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(url)
                    .then(() => toast.success('MyHome link copied. They sign in with their email and MyHome code.'))
                    .catch(() => toast.error(`Copy did not work. The link is ${url}`))
                }
                title={`${url} (no code in it: they sign in with their email and MyHome code)`}
              >
                <CopyIcon />
                Copy link
              </Button>
              <Button size="xs" variant="outline" disabled={!person.phone || draft.isPending} title={person.phone ? 'Draft a text with the MyHome link (Action Queue)' : 'No phone on file'} onClick={() => queue('text')}>
                <MessageSquareIcon />
                Draft text
              </Button>
              <Button size="xs" variant="outline" disabled={!person.email || draft.isPending} title={person.email ? 'Draft an email with the MyHome link (Action Queue)' : 'No email on file'} onClick={() => queue('email')}>
                <MailIcon />
                Draft email
              </Button>
              <Button size="xs" variant="ghost" disabled={send.isPending} onClick={() => void newCode()} title="A new code and link; the old ones stop working">
                <RefreshCwIcon />
                New code
              </Button>
              <Button size="xs" variant="ghost" disabled={off.isPending} onClick={() => void turnOff()}>
                <PowerOffIcon />
                Turn off
              </Button>
            </>
          )}
        </>
      )}
    </div>
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

/**
 * The MyHome card on a file's MyHome tab (Connor, 2026-11-24: its own tab, off
 * the Overview): the primary borrower's MyHome line (status, Send code to GHL,
 * Copy link, Draft text) and what they asked for from MyHome.
 */
export function MyHomeCard({
  loan,
  person,
  home,
}: {
  loan: LoanProfile
  person: { id: string; firstName: string; lastName: string | null; phone: string | null; email: string | null } | null
  home: { id: string; estimatedValue: number | null; estimatedValueOn: string | null } | null
}) {
  const accounts = useMyHomeAccounts(person ? [person.id] : [])
  const asks = useMyHomeAsks(loan.id)
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  const lo = useProfile(loan.assignedLo?.id ?? me)
  // Nothing before the MyHome script has run, or with no borrower.
  if (!person || accounts.data === null || accounts.data === undefined) return null
  const name = `${person.firstName} ${person.lastName ?? ''}`.trim()
  return (
    <Card title="MyHome" description="Their lifelong account: loan status and documents while the loan is open, goals while they get ready, and their home's value, equity and loan after closing.">
      <MyHomeLine
        organizationId={loan.organizationId}
        loanId={loan.id}
        contactId={person.id}
        name={name}
        person={{ firstName: person.firstName, phone: person.phone, email: person.email }}
        loName={lo.data?.fullName ?? 'Your loan officer'}
        closed={loan.stage === 'closed'}
        account={accounts.data.find((a) => a.contactId === person.id) ?? null}
        readOnly={loan.stage === 'lost'}
      />
      {(asks.data?.length ?? 0) > 0 && (
        <div className="mt-3 border-t pt-3">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Asked from MyHome</p>
          <ul className="space-y-2">
            {asks.data!.map((a) => (
              <AskRow key={a.id} loanId={loan.id} ask={a} home={home} firstName={person.firstName} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

/**
 * One ask from MyHome: what and when, and Mark done. A value check also takes
 * the new value (saved on the home, dated, and shown to them in MyHome as
 * your estimate) with "Save value & mark done".
 */
function AskRow({ loanId, ask, home, firstName }: { loanId: string; ask: MyHomeAsk; home: { id: string; estimatedValue: number | null; estimatedValueOn: string | null } | null; firstName: string }) {
  const handle = useHandleMyHomeAsk(loanId)
  const [value, setValue] = useState<number | null>(home?.estimatedValue ?? null)
  const done = !!ask.handledAt
  const finish = (withValue: boolean) =>
    handle.mutate(
      withValue && home && value != null ? { askId: ask.id, homeId: home.id, value } : { askId: ask.id },
      {
        onSuccess: () => toast.success(withValue ? `Saved. ${firstName} sees ${formatCurrency(value)} as your estimate in MyHome.` : 'Marked done'),
        onError: (e) => toast.error(e.message),
      },
    )
  return (
    <li className={cn('text-sm', done && 'text-muted-foreground')}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{ASK_LABEL[ask.kind]}</span>
        <span className="text-xs text-muted-foreground">
          {relativeTime(ask.createdAt)}
          {done && ` · done ${relativeTime(ask.handledAt!)}`}
        </span>
      </div>
      {!done && (
        <div className="mt-1.5 flex flex-wrap items-end gap-2">
          {ask.kind === 'value_check' &&
            (home ? (
              <>
                <div className="w-44">
                  <CurrencyInput label="Their home's value" value={value} onChange={setValue} />
                </div>
                <Button size="sm" disabled={handle.isPending || value == null || value <= 0} onClick={() => finish(true)}>
                  Save value & mark done
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Add the home on the Property tab (as the subject property) to give them a value.</p>
            ))}
          <Button size="sm" variant="ghost" disabled={handle.isPending} onClick={() => finish(false)}>
            Mark done
          </Button>
        </div>
      )}
    </li>
  )
}
