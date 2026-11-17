import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useNewMessages, type FreshMessage } from '@/lib/api/messages'
import { groupBySender, senderKey } from '@/lib/messaging/freshGroups'

/** Where a new message opens: its file's Messages tab (a partner's: the file's Overview, with the Settlement card), else the Inbox. */
export const fileLink = (m: FreshMessage) => (m.loanId ? (m.partnerId ? `/loans/${m.loanId}` : `/loans/${m.loanId}?tab=messages`) : '/inbox')

/**
 * A pop-up when a text or email arrives while LOSuite is open, on any page:
 * one per person, updated as more arrive ("3 new texts from Jane"; Connor,
 * 2026-11-16). Messages already waiting when the app opens don't pop up (the
 * home page and the Inbox show them). Used once, in the app shell.
 */
export function useNewMessageAlerts() {
  const fresh = useNewMessages()
  const navigate = useNavigate()
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    const list = fresh.data
    if (!list) return
    if (seen.current === null) {
      seen.current = new Set(list.map((m) => m.id))
      return
    }
    const arrived = list.filter((m) => !seen.current!.has(m.id))
    for (const m of arrived) seen.current.add(m.id)
    // Everyone with something new: one pop-up each, counting all their unread messages.
    const people = new Set(arrived.map(senderKey))
    for (const g of groupBySender(list).filter((x) => people.has(x.key))) {
      const m = g.latest
      const what = m.channel === 'text' ? 'text' : 'email'
      // The same id replaces that person's earlier pop-up instead of stacking another.
      toast.message(g.count > 1 ? `${g.count} new messages from ${m.name}` : `New ${what} from ${m.name}`, {
        id: `new-message:${g.key}`,
        description: m.preview || undefined,
        action: { label: 'Open', onClick: () => navigate(fileLink(m)) },
        duration: 15000,
      })
    }
  }, [fresh.data, navigate])
}
