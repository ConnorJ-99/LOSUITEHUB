import { useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth/context'
import { moveGhlOpportunity, useGhlStatus } from '@/lib/api/ghl'

/**
 * Moves a file's borrower's one GHL opportunity (decision 3 in
 * docs/plans/next-build.md) and says what happened. Does nothing when GHL
 * isn't connected, so closing a file or copying it works the same without GHL.
 * A GHL problem never undoes the LOSuite change; it's shown so someone can
 * press "Update GHL" on the closed file later.
 */
export function useGhlOpportunity() {
  const status = useGhlStatus()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  const [pending, setPending] = useState(false)

  const move = async (loanId: string, kind: 'closed' | 'comeback', who: string) => {
    if (status.data?.ready !== true || !orgId) return
    setPending(true)
    try {
      const r = await moveGhlOpportunity(orgId, loanId, kind)
      if ('skipped' in r) return void toast.message(`GHL: ${r.skipped}`)
      const where = r.to ?? (kind === 'closed' ? 'the Closed pipeline' : 'the active pipeline')
      toast.success(`GHL: ${r.created ? `added an opportunity for ${who} in` : `moved ${who}'s opportunity to`} ${where}${r.contactCreated ? ` (and added ${who} as a GHL contact)` : ''}`)
      if (r.otherOpportunities > 0) {
        toast.warning(`${who} has ${r.otherOpportunities} more ${r.otherOpportunities === 1 ? 'opportunity' : 'opportunities'} in GHL. LOSuite used the newest; the others can be deleted in GHL.`)
      }
    } catch (e) {
      toast.error(`GHL wasn't updated: ${(e as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  return { move, ready: status.data?.ready === true, pending }
}
