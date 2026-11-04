import { useState } from 'react'
import { Link } from 'react-router'
import { InboxIcon, MailIcon, MessageSquareIcon, PenSquareIcon, UserPlusIcon, UserSearchIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, confirmAction, EmptyState, PageHeader, SearchInput } from '@/components/shared'
import { FailedSendActions } from '@/components/messages/FailedSend'
import { CheckNewMessagesButton } from '@/components/messages/MessagesTab'
import { NewLeadFromMessage } from '@/components/messages/NewLeadFromMessage'
import { NewMessageDialog } from '@/components/messages/NewMessageDialog'
import { TONE_CLASS } from '@/components/messages/tone'
import { useContacts } from '@/lib/api/contacts'
import { MATCH_REASON_LABEL, useFailedSends, useInbox, useMatchMessage, useNeedsMatching, type NeedsMatchingGroup } from '@/lib/api/messages'
import type { ContactSummary } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'
import { relativeTime } from '@/lib/dates'
import { formatPhone, fullName } from '@/lib/pipeline/helpers'

const preview = (body: string) => (body.length > 140 ? `${body.slice(0, 140)}…` : body)

function PersonPicker({ group, people, onPick, busy }: { group: NeedsMatchingGroup; people: ContactSummary[]; onPick: (p: ContactSummary) => void; busy: boolean }) {
  const [search, setSearch] = useState('')
  const suggested = group.candidateIds.map((id) => people.find((p) => p.id === id)).filter((p): p is ContactSummary => !!p)
  const q = search.trim().toLowerCase()
  const digits = q.replace(/\D/g, '')
  const found =
    q.length >= 2
      ? people
          .filter((p) => fullName(p).toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q) || (digits.length >= 4 && (p.phone ?? '').replace(/\D/g, '').includes(digits)))
          .slice(0, 6)
      : []
  const button = (p: ContactSummary) => (
    <Button key={p.id} size="sm" variant="outline" disabled={busy} onClick={() => onPick(p)}>
      This is {fullName(p)}
      {p.phone && <span className="text-xs text-muted-foreground">{formatPhone(p.phone)}</span>}
    </Button>
  )
  return (
    <div className="space-y-2">
      {suggested.length > 0 && <div className="flex flex-wrap gap-2">{suggested.map(button)}</div>}
      <SearchInput value={search} onChange={setSearch} placeholder="Someone else: search by name, email or phone" className="max-w-sm" />
      {found.length > 0 && <div className="flex flex-wrap gap-2">{found.map(button)}</div>}
      {q.length >= 2 && found.length === 0 && <p className="text-xs text-muted-foreground">Nobody matches. If they're new, use "New lead from this".</p>}
    </div>
  )
}

/** Sends that failed and are waiting to be resent or dismissed, on the files you can see. */
function FailedSendsCard() {
  const failed = useFailedSends()
  const rows = failed.data ?? []
  if (!rows.length) return null
  return (
    <Card title="Failed sends" description="These didn't go out. Each stays here until it's resent or dismissed.">
      <ul className="divide-y">
        {rows.map(({ message: m, name }) => (
          <li key={m.id} className="py-3 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">
                {m.loanId ? (
                  <Link to={`/loans/${m.loanId}?tab=messages`} className="hover:underline">
                    {name}
                  </Link>
                ) : (
                  name
                )}
                <span className="ml-2 text-xs font-normal text-muted-foreground">{m.channel === 'text' ? 'Text' : 'Email'} · {relativeTime(m.sentAt)}</span>
              </p>
            </div>
            <p className="truncate text-sm text-muted-foreground">{preview(m.subject ? `${m.subject}: ${m.body}` : m.body)}</p>
            <FailedSendActions m={m} />
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Messages LOSuite couldn't place on its own. Admins say who each GHL contact is; later messages then match by themselves. */
function NeedsMatchingCard() {
  const waiting = useNeedsMatching(true)
  const people = useContacts()
  const match = useMatchMessage()
  const groups = waiting.data ?? []
  const [newLeadFor, setNewLeadFor] = useState<NeedsMatchingGroup | null>(null)

  const pick = async (g: NeedsMatchingGroup, p: ContactSummary) => {
    const from = g.name ?? g.phone ?? g.email ?? 'this GHL contact'
    const n = g.messages.length
    const ok = await confirmAction(
      `Put ${n === 1 ? 'this message' : `these ${n} messages`} from ${from} on ${fullName(p)}'s file? ${fullName(p)} is linked to that GHL contact${p.loans.length ? '' : ' (they have no file yet, so the messages stay on the person)'}, so their later messages match on their own.`,
      { confirmLabel: `This is ${fullName(p)}` },
    )
    if (!ok) return
    match.mutate({ messageId: g.messages[0].id, contactId: p.id }, { onSuccess: (count) => toast.success(`${count} message${count === 1 ? '' : 's'} put on ${fullName(p)}'s file`), onError: (e) => toast.error(e.message) })
  }

  if (!waiting.isPending && groups.length === 0) return null
  return (
    <Card title="Needs matching" description="MPS HQ couldn't tell who these are from. Only admins see them until they're matched.">
      {waiting.error ? (
        <p className="text-sm text-destructive">{waiting.error.message}</p>
      ) : waiting.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="divide-y">
          {groups.map((g) => (
            <li key={g.ghlContactId ?? g.messages[0].id} className="space-y-2 py-3 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {g.name ?? 'Unknown GHL contact'}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{[g.phone && formatPhone(g.phone), g.email].filter(Boolean).join(' · ')}</span>
                </p>
                {g.reason && <span className={TONE_CLASS.warn}>{MATCH_REASON_LABEL[g.reason]}</span>}
              </div>
              <ul className="space-y-1">
                {g.messages.slice(0, 3).map((m) => (
                  <li key={m.id} className="flex gap-2 text-sm">
                    {m.channel === 'text' ? <MessageSquareIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <MailIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0">
                      <span className={m.direction === 'inbound' ? undefined : 'text-muted-foreground'}>{m.direction === 'outbound' ? 'Sent: ' : ''}{preview(m.subject ? `${m.subject}: ${m.body}` : m.body)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{relativeTime(m.sentAt)}</span>
                    </span>
                  </li>
                ))}
                {g.messages.length > 3 && <li className="text-xs text-muted-foreground">and {g.messages.length - 3} more</li>}
              </ul>
              <PersonPicker group={g} people={people.data ?? []} onPick={(p) => pick(g, p)} busy={match.isPending} />
              <Button size="sm" variant="ghost" disabled={match.isPending} onClick={() => setNewLeadFor(g)}>
                <UserPlusIcon />
                New lead from this
              </Button>
            </li>
          ))}
        </ul>
      )}
      {newLeadFor && <NewLeadFromMessage group={newLeadFor} onDone={() => setNewLeadFor(null)} />}
    </Card>
  )
}

/** Every conversation you can see, newest first, and (admins) messages waiting to be matched. */
export function InboxPage() {
  const { state } = useAuth()
  const role = state.status === 'signedIn' ? state.user.role : null
  const isAdmin = role === 'admin'
  const canCheck = role === 'owner' || role === 'admin'
  const inbox = useInbox()
  const rows = inbox.data ?? []
  const [composing, setComposing] = useState(false)

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Inbox"
        description="Texts and emails from GHL, on the files you can see. Times are Central."
        action={
          <div className="flex flex-wrap gap-2">
            {canCheck && <CheckNewMessagesButton size="default" />}
            <Button onClick={() => setComposing(true)}>
              <PenSquareIcon />
              New message
            </Button>
          </div>
        }
      />
      {composing && <NewMessageDialog onClose={() => setComposing(false)} />}
      <div className="space-y-4">
        <FailedSendsCard />
        {isAdmin && <NeedsMatchingCard />}
        <Card title="Conversations">
          {inbox.error ? (
            <p className="text-sm text-destructive">{inbox.error.message}</p>
          ) : inbox.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <EmptyState icon={InboxIcon} title="No messages yet" description="Texts and emails with your clients through GHL show here once they come in." />
          ) : (
            <ul className="divide-y">
              {rows.map((r) => {
                const body = (
                  <div className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm', r.unread ? 'font-semibold' : 'font-medium')}>{r.name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {r.last.direction === 'outbound' ? 'You: ' : ''}
                        {r.last.channel === 'email' && r.last.subject ? `${r.last.subject}: ` : ''}
                        {r.last.body}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-xs text-muted-foreground">{relativeTime(r.last.sentAt)}</span>
                      {r.unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.7rem] font-semibold text-primary-foreground tabular-nums">{r.unread}</span>}
                    </div>
                  </div>
                )
                return (
                  <li key={r.contactId}>
                    {r.loanId ? (
                      <Link to={`/loans/${r.loanId}?tab=messages`} className="block rounded-md px-1 hover:bg-muted/50">
                        {body}
                      </Link>
                    ) : (
                      <div className="px-1" title="This person has no file">
                        {body}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
        {!isAdmin && canCheck && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <UserSearchIcon className="size-3.5" />
            Messages MPS HQ can't place on a file wait for the admin login (info@mps.mortgage) to match them.
          </p>
        )}
      </div>
    </>
  )
}
