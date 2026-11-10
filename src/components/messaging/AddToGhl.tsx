import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCwIcon, UserPlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { linkGhlContact, linkGhlPartner, useGhlStatus, type ContactLinkResult } from '@/lib/api/ghl'
import { useAuth } from '@/lib/auth/context'
import { TONE_CLASS } from '@/components/messages/tone'

type Target = { kind: 'borrower'; loanId: string; contactId: string } | { kind: 'partner'; partnerId: string }

/**
 * "Add to GoHighLevel" (build plan Phase 3): one person at a time, on click
 * only, through the ghl function's existing match-or-create (borrowers are
 * assigned to the file's loan officer). Linked: a "Linked to GoHighLevel"
 * chip. Skipped or failed: the reason and Retry. The reason isn't saved, so
 * it shows until the page is left.
 */
export function AddToGhl({ target, linked, name }: { target: Target; linked: boolean; name: string }) {
  const { state } = useAuth()
  const organizationId = state.status === 'signedIn' ? state.user.organizationId : null
  const status = useGhlStatus()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  if (linked) return <span className={TONE_CLASS.ok}>Linked to GoHighLevel</span>
  if (!status.data?.ready || !organizationId) return <span className={TONE_CLASS.warn}>Not linked yet</span>

  const run = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const r: ContactLinkResult = target.kind === 'partner' ? await linkGhlPartner(organizationId, target.partnerId) : await linkGhlContact(organizationId, target.loanId, target.contactId)
      if ('skipped' in r) setProblem(r.skipped)
      else {
        toast.success(r.created ? `${name} added to GoHighLevel` : `${name} linked to their GoHighLevel contact`)
        for (const key of [['messages', 'people'], ['partners'], ['closedLoans']]) queryClient.invalidateQueries({ queryKey: key })
      }
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      {problem ? (
        <>
          <span className="text-xs text-amber-800">{problem}</span>
          <Button size="xs" variant="outline" disabled={busy} onClick={run}>
            <RefreshCwIcon />
            {busy ? 'Trying…' : 'Retry'}
          </Button>
        </>
      ) : (
        <Button size="xs" variant="outline" disabled={busy} onClick={run} title="Finds them in GoHighLevel by phone or email, or adds them (no tags, no workflows)">
          <UserPlusIcon />
          {busy ? 'Adding…' : 'Add to GoHighLevel'}
        </Button>
      )}
    </span>
  )
}
