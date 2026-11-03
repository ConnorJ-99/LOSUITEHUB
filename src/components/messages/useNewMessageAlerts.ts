import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useNewMessages, type FreshMessage } from '@/lib/api/messages'

/** Where a new message opens: its file's Messages tab, else the Inbox. */
export const fileLink = (m: FreshMessage) => (m.loanId ? `/loans/${m.loanId}?tab=messages` : '/inbox')

/**
 * A pop-up for each text or email that arrives while LOSuite is open, on any
 * page. Messages already waiting when the app opens don't pop up (the home
 * page and the Inbox show them). Used once, in the app shell.
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
    for (const m of [...list].reverse()) {
      if (seen.current.has(m.id)) continue
      seen.current.add(m.id)
      toast.message(`New ${m.channel === 'text' ? 'text' : 'email'} from ${m.name}`, {
        description: m.preview || undefined,
        action: { label: 'Open', onClick: () => navigate(fileLink(m)) },
        duration: 15000,
      })
    }
  }, [fresh.data, navigate])
}
