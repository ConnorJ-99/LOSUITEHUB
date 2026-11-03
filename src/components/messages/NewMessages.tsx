import { Link } from 'react-router'
import { ArrowRightIcon, MailIcon, MessageSquareIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/shared'
import { useNewMessages } from '@/lib/api/messages'
import { relativeTime } from '@/lib/dates'
import { fileLink } from './useNewMessageAlerts'

/** The home page box: received messages nobody has opened yet. Hidden when there are none. */
export function NewMessagesCard() {
  const fresh = useNewMessages()
  const list = fresh.data ?? []
  if (!list.length) return null
  const shown = list.slice(0, 5)
  return (
    <Card
      className="border-t-2 border-t-primary"
      title={`New messages (${list.length})`}
      action={
        <Button variant="ghost" size="sm" asChild>
          <Link to="/inbox">
            Inbox
            <ArrowRightIcon />
          </Link>
        </Button>
      }
    >
      <ul className="divide-y">
        {shown.map((m) => (
          <li key={m.id}>
            <Link to={fileLink(m)} className="flex items-start gap-2 py-2 hover:bg-muted/40">
              {m.channel === 'text' ? <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-primary" /> : <MailIcon className="mt-0.5 size-4 shrink-0 text-primary" />}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-sm font-medium">{m.name}</span>
                  <span className="text-xs text-muted-foreground">{relativeTime(m.sentAt)}</span>
                </span>
                {m.preview && <span className="block truncate text-sm text-muted-foreground">{m.preview}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {list.length > shown.length && <p className="pt-1 text-xs text-muted-foreground">And {list.length - shown.length} more in the Inbox.</p>}
    </Card>
  )
}
