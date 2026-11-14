// Title, insurance and realtor emails and texts on a file (Connor, 2026-11-14):
// the requests sent from MPS HQ and their replies, which ghl-inbound saves on
// the file they're about. Shown under each partner on the Settlement &
// insurance card, and all together on the file's Messages tab. Opening them
// marks their replies read.
import { useState } from 'react'
import { ArrowDownLeftIcon, ArrowUpRightIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from 'cn'
import { usePartners } from '@/lib/api/partners'
import { useMarkPartnerRead, usePartnerMessages, type PartnerMessage } from '@/lib/api/partnerRequests'
import { relativeTime } from '@/lib/dates'

function Item({ m, who }: { m: PartnerMessage; who: string | null }) {
  const [open, setOpen] = useState(false)
  const inbound = m.direction === 'inbound'
  const long = m.body.length > 220 || m.body.split('\n').length > 4
  return (
    <li className={cn('rounded-md border px-2.5 py-2 text-xs', inbound && !m.readAt ? 'border-primary/40 bg-primary/5' : 'bg-card')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="inline-flex min-w-0 items-center gap-1 font-medium">
          {inbound ? <ArrowDownLeftIcon className="size-3 shrink-0 text-emerald-700" /> : <ArrowUpRightIcon className="size-3 shrink-0 text-muted-foreground" />}
          <span className="truncate">{inbound ? `From ${who ?? m.fromAddress ?? 'them'}` : `To ${who ?? m.toAddress ?? 'them'}`}</span>
          {inbound && !m.readAt && <span className="rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">NEW</span>}
        </span>
        <span className="text-muted-foreground">
          {m.channel === 'text' ? 'Text' : 'Email'} · {relativeTime(m.sentAt)}
          {!inbound && m.status ? ` · ${m.status}` : ''}
        </span>
      </div>
      {m.subject && <p className="mt-1 font-semibold">{m.subject}</p>}
      <p className={cn('mt-1 whitespace-pre-wrap break-words text-muted-foreground', !open && long && 'line-clamp-4')}>{m.body || '(no text)'}</p>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-primary hover:underline">
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </li>
  )
}

/** One partner's messages on this file (partnerId), or every partner's. Hidden when there are none. */
export function PartnerMessages({ loanId, partnerId }: { loanId: string; partnerId?: string }) {
  const all = usePartnerMessages(loanId)
  const partners = usePartners()
  const markRead = useMarkPartnerRead(loanId)
  const [open, setOpen] = useState(false)
  const list = (all.data ?? []).filter((m) => !partnerId || m.partnerId === partnerId)
  if (!list.length) return null
  const unread = list.filter((m) => m.direction === 'inbound' && !m.readAt)
  const nameOf = (id: string) => {
    const p = partners.data?.find((x) => x.id === id)
    return p ? p.company || p.name : null
  }
  // Opening them counts their new replies as read.
  const readThem = () => {
    for (const id of new Set(unread.map((m) => m.partnerId))) markRead.mutate(id)
  }
  return (
    <div className="mt-2">
      <button type="button" onClick={() => (setOpen(!open), !open && readThem())} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        {open ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        {list.length} message{list.length === 1 ? '' : 's'}
        {unread.length > 0 && <span className="rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">{unread.length} new</span>}
      </button>
      {open && (
        <ul className="mt-1.5 max-h-96 space-y-1.5 overflow-y-auto">
          {list.map((m) => (
            <Item key={m.id} m={m} who={nameOf(m.partnerId)} />
          ))}
        </ul>
      )}
    </div>
  )
}
