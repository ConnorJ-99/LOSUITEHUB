// "Forms" on a file's Overview (Pages Phase 3): send the borrower a personal
// link to one of your published pages. The link fills in what the file already
// has and ties the answers to this person (no matching); differences come back
// as proposed updates. Copy the link, or draft an email with it into the
// Action Queue (texts never carry links). Links work for 30 days and can be
// switched off.
import { useState } from 'react'
import { CopyIcon, MailIcon, PlusIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, confirmAction, Select } from '@/components/shared'
import { usePages } from '@/lib/api/pages'
import { draftLinkEmail, linkState, useCreatePageLink, usePageLinks, useRevokePageLink, type PageLinkState } from '@/lib/api/pagesPhase3'
import { useOrganization, useProfile } from '@/lib/api/settings'
import type { LoanProfile } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'
import { formatIsoDate } from '@/lib/dates'

const STATE: Record<PageLinkState, { label: string; tone: string }> = {
  submitted: { label: 'Answered', tone: 'bg-nurture/10 text-nurture' },
  opened: { label: 'Opened', tone: 'bg-primary/10 text-primary' },
  sent: { label: 'Not opened yet', tone: 'bg-muted text-muted-foreground' },
  expired: { label: 'Expired', tone: 'bg-muted text-muted-foreground' },
  off: { label: 'Switched off', tone: 'bg-muted text-muted-foreground' },
}

const copy = (url: string) =>
  navigator.clipboard
    ?.writeText(url)
    .then(() => toast.success('Link copied'))
    .catch(() => toast.error('Copy did not work; select the link instead.'))

function SendFormDialog({ loan, onClose }: { loan: LoanProfile; onClose: () => void }) {
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  const pages = usePages()
  const create = useCreatePageLink(loan.id)
  const lo = useProfile(loan.assignedLo?.id ?? me)
  const org = useOrganization()
  const usable = (pages.data ?? []).filter((p) => p.status === 'published' && p.type !== 'open_house' && p.settings.leadKind !== 'partner')
  const [pageId, setPageId] = useState<string | null>(null)
  const [made, setMade] = useState<{ id: string; url: string } | null>(null)
  const [drafting, setDrafting] = useState(false)
  const page = usable.find((p) => p.id === pageId) ?? null
  const b = loan.borrower

  const draft = async () => {
    if (!made || !page || !b?.email) return
    setDrafting(true)
    try {
      await draftLinkEmail({
        organizationId: loan.organizationId,
        loanId: loan.id,
        contactId: b.id,
        email: b.email,
        firstName: b.firstName,
        pageTitle: page.title,
        url: made.url,
        linkId: made.id,
        signer: { loName: lo.data?.fullName ?? null, loNmls: lo.data?.nmls ?? null, loPhone: lo.data?.personalCell || lo.data?.phone || null, companyName: org.data?.name ?? 'MPS Mortgage LLC', companyNmls: org.data?.nmls ?? '2501110' },
      })
      toast.success('The email is waiting in the Action Queue. Nothing is sent until you press Send.')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDrafting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send a form to {b ? `${b.firstName} ${b.lastName}`.trim() : 'the borrower'}</DialogTitle>
          <DialogDescription>A personal link fills in what this file already has. Their answers come back to this file; anything that differs shows as a proposed update.</DialogDescription>
        </DialogHeader>
        {!made ? (
          <Select
            label="Page"
            value={pageId ?? ''}
            onChange={(v) => setPageId(v || null)}
            placeholder={usable.length ? 'Pick a published form' : 'No published forms yet (Pages)'}
            options={usable.map((p) => ({ value: p.id, label: p.title }))}
          />
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium">Link for {b?.firstName ?? 'the borrower'} (works for 30 days)</p>
            <p className="rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs break-all">{made.url}</p>
            {!b?.email && <p className="text-xs text-money">This person has no email on file, so copy the link to share it.</p>}
          </div>
        )}
        <DialogFooter>
          {!made ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={!page || !b || create.isPending}
                onClick={() =>
                  page &&
                  b &&
                  create.mutate({ organizationId: loan.organizationId, page, contactId: b.id }, { onSuccess: setMade, onError: (e) => toast.error(e.message) })
                }
              >
                <PlusIcon />
                Make the link
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => copy(made.url)}>
                <CopyIcon />
                Copy link
              </Button>
              <Button disabled={!b?.email || drafting} onClick={draft}>
                <MailIcon />
                Draft an email with it
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SendFormCard({ loan }: { loan: LoanProfile }) {
  const links = usePageLinks(loan.id)
  const revoke = useRevokePageLink(loan.id)
  const [open, setOpen] = useState(false)
  const rows = links.data ?? []
  return (
    <Card
      title="Forms"
      description="Personal links to your Pages, filled in from this file"
      action={
        <Button size="sm" variant="outline" disabled={!loan.borrower} onClick={() => setOpen(true)}>
          <SendIcon />
          Send a form
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No forms sent yet.</p>
      ) : (
        <ul className="-my-2 divide-y">
          {rows.map((l) => {
            const st = linkState(l)
            return (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{l.pageTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    Sent {formatIsoDate(l.createdAt.slice(0, 10))}
                    {l.submittedAt ? ` · answered ${formatIsoDate(l.submittedAt.slice(0, 10))}` : l.lastOpenedAt ? ` · opened ${formatIsoDate(l.lastOpenedAt.slice(0, 10))}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', STATE[st].tone)}>{STATE[st].label}</span>
                  {(st === 'sent' || st === 'opened' || st === 'submitted') && (
                    <>
                      <Button size="icon-sm" variant="ghost" title="Copy link" onClick={() => copy(l.url)}>
                        <CopyIcon />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={async () => {
                          if (!(await confirmAction(`Switch off this link to ${l.pageTitle}? It will stop working. You can send a new one any time.`, { confirmLabel: 'Switch off' }))) return
                          revoke.mutate(l.id, { onError: (e) => toast.error(e.message) })
                        }}
                      >
                        Switch off
                      </Button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {open && <SendFormDialog loan={loan} onClose={() => setOpen(false)} />}
    </Card>
  )
}
