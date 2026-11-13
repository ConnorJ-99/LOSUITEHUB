// "Application link": copies the /apply link anyone can fill out (Stage 5).
// Submitting it makes a new lead assigned to you (?lo= your sign-in email),
// or matches someone already in MPS-HQ.
import { ClipboardListIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { standaloneApplyUrl } from '@/lib/api/applications'
import { useAuth } from '@/lib/auth/context'

export function ApplicationLinkButton({ size = 'default' }: { size?: 'default' | 'sm' }) {
  const { state } = useAuth()
  const email = state.status === 'signedIn' ? state.user.email || null : null
  const url = standaloneApplyUrl(window.location.origin, email)
  const copy = () =>
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success('Application link copied. Anyone who applies with it becomes a new lead assigned to you.'))
      .catch(() => toast.error(`Copy did not work. The link is ${url}`))
  return (
    <Button variant="outline" size={size} onClick={() => void copy()} title={url}>
      <ClipboardListIcon />
      Application link
    </Button>
  )
}
