import { Link } from 'react-router'
import { CalendarClockIcon, MailIcon, MessageSquareIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, confirmAction } from '@/components/shared'
import { useCancelScheduled, useScheduledSends, type ScheduledSend } from '@/lib/api/messages'
import { useAuth } from '@/lib/auth/context'
import { scheduleLabel } from '@/lib/messaging/schedule'

const preview = (s: ScheduledSend) => {
  const text = s.subject ? `${s.subject}: ${s.body}` : s.body
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

/**
 * Approved messages waiting for their time, soonest first, with Cancel; and
 * any from the last 3 days that didn't go out at their time, with the reason.
 * Hidden when there are none.
 */
export function ScheduledCard() {
  const scheduled = useScheduledSends()
  const cancel = useCancelScheduled()
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  const isAdmin = state.status === 'signedIn' && state.user.role === 'admin'
  const rows = scheduled.data ?? []
  if (!rows.length) return null

  const stop = async (s: ScheduledSend) => {
    if (!(await confirmAction(`Cancel the ${s.channel === 'text' ? 'text' : 'email'} to ${s.name} set for ${scheduleLabel(new Date(s.sendAt))}? It won't be sent.`, { confirmLabel: 'Cancel it' }))) return
    cancel.mutate(s.id, { onSuccess: () => toast.success('Cancelled. Nothing was sent.'), onError: (e) => toast.error(e.message) })
  }

  return (
    <Card title="Scheduled" description="Approved messages that go out at their time, Central. Every check runs again then.">
      <ul className="divide-y">
        {rows.map((s) => {
          const Icon = s.channel === 'text' ? MessageSquareIcon : MailIcon
          return (
            <li key={s.id} className="space-y-1 py-2.5 first:pt-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <Link to={`/loans/${s.loanId}?tab=messages`} className="font-medium hover:underline">
                    {s.name}
                  </Link>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Icon className="size-3" />
                    {s.voidedAt ? 'Was set for ' : ''}
                    {scheduleLabel(new Date(s.sendAt))}
                  </p>
                </div>
                {!s.voidedAt && (s.approvedBy === me || isAdmin) && (
                  <Button size="xs" variant="ghost" disabled={cancel.isPending} onClick={() => stop(s)}>
                    Cancel
                  </Button>
                )}
              </div>
              <p className="text-sm break-words text-muted-foreground">{preview(s)}</p>
              {s.voidedAt && (
                <p className="flex items-start gap-1 text-xs text-destructive">
                  <CalendarClockIcon className="mt-0.5 size-3 shrink-0" />
                  Didn't send: {s.voidReason ?? 'cancelled'}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
