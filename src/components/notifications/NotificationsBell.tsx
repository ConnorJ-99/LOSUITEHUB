import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangleIcon, BellIcon, BellOffIcon, CalendarClockIcon, CheckIcon, MessageSquareIcon, UserSearchIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared'
import { useMarkNotificationsRead, useNotifications, useUnreadNotifications, type AppNotification } from '@/lib/api/notifications'
import { relativeTime } from '@/lib/dates'

const ICON: Record<AppNotification['kind'], typeof BellIcon> = {
  reply: MessageSquareIcon,
  needs_matching: UserSearchIcon,
  send_failed: AlertTriangleIcon,
  opted_out: BellOffIcon,
  scheduled_sent: CalendarClockIcon,
  scheduled_stopped: AlertTriangleIcon,
  test: BellIcon,
}

/**
 * The bell: your unread count, and a list of your latest notifications. A
 * click opens what it's about and marks it read. `tone` is "sidebar" (the
 * navy sidebar) or "bar" (the phone's top bar).
 */
export function NotificationsBell({ tone }: { tone: 'sidebar' | 'bar' }) {
  const [open, setOpen] = useState(false)
  const unread = useUnreadNotifications()
  const list = useNotifications(open)
  const mark = useMarkNotificationsRead()
  const navigate = useNavigate()
  const count = unread.data ?? 0
  const rows = list.data ?? []

  const go = (n: AppNotification) => {
    if (!n.readAt) mark.mutate([n.id])
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        className={cn('relative shrink-0', tone === 'sidebar' && 'text-sidebar-foreground hover:bg-white/8 hover:text-white')}
      >
        <BellIcon />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold text-primary-foreground tabular-nums">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Button>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Notifications</DialogTitle>
              <DialogDescription>Yours only. Choose what you get in Settings → Notifications.</DialogDescription>
            </DialogHeader>
            {count > 0 && (
              <Button size="sm" variant="outline" className="w-fit" disabled={mark.isPending} onClick={() => mark.mutate(undefined)}>
                <CheckIcon />
                Mark all read
              </Button>
            )}
            {list.isPending ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : list.error ? (
              <p className="text-sm text-destructive">{list.error.message}</p>
            ) : rows.length === 0 ? (
              <EmptyState icon={BellIcon} title="Nothing yet" description="Replies, failed sends and opt-outs show here." />
            ) : (
              <ul className="-mx-2 divide-y">
                {rows.map((n) => {
                  const Icon = ICON[n.kind] ?? BellIcon
                  return (
                    <li key={n.id}>
                      <button type="button" onClick={() => go(n)} className="flex w-full gap-3 rounded-md px-2 py-2.5 text-left hover:bg-muted/50">
                        <Icon className={cn('mt-0.5 size-4 shrink-0', n.kind === 'send_failed' || n.kind === 'scheduled_stopped' ? 'text-destructive' : 'text-primary')} />
                        <span className="min-w-0 flex-1">
                          <span className={cn('block text-sm', n.readAt ? 'font-normal' : 'font-semibold')}>{n.title}</span>
                          {n.body && <span className="block truncate text-sm text-muted-foreground">{n.body}</span>}
                          <span className="block text-xs text-muted-foreground">{relativeTime(n.createdAt)}</span>
                        </span>
                        {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

