// Lead "Next Action" tags and last contact (Connor, 2026-11-16). Read on their
// own, so the boards and the file header work before the next action script
// has run (they then show the step line as before).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NextActionId } from '@/lib/leads/nextAction'
import { db, keys } from './client'

// Under ['pipeline'] so a stage move (which can change the tag) refreshes them.
export const nextActionKey = ['pipeline', 'next-action'] as const
const lastContactKey = ['pipeline', 'last-contact'] as const

export interface NextActionState {
  nextAction: NextActionId | null
  /** Connor picked it (it sticks until the file's data changes). */
  manual: boolean
}

/** Every visible file's tag; null before the script has run. */
export function useNextActions() {
  return useQuery({
    queryKey: nextActionKey,
    retry: false,
    queryFn: async () => {
      const r = await db().from('loans').select('id, next_action, next_action_manual')
      if (r.error) return null
      return new Map((r.data as { id: string; next_action: NextActionId | null; next_action_manual: boolean }[]).map((x) => [x.id, { nextAction: x.next_action, manual: x.next_action_manual } satisfies NextActionState]))
    },
  })
}

/** When each lead file's borrowers last heard from us; null before the script has run. */
export function useLastContacts() {
  return useQuery({
    queryKey: lastContactKey,
    retry: false,
    queryFn: async () => {
      const r = await db().rpc('lead_last_contacts')
      if (r.error) return null
      return new Map((r.data as { loan_id: string; last_contact_at: string | null }[]).map((x) => [x.loan_id, x.last_contact_at]))
    },
  })
}

/** One file's tag and last contact, for the file header; null before the script has run. */
export function useLoanNextAction(loanId: string) {
  return useQuery({
    queryKey: [...nextActionKey, loanId],
    retry: false,
    queryFn: async () => {
      const [loan, contact] = await Promise.all([
        db().from('loans').select('next_action, next_action_manual, ready_on').eq('id', loanId).maybeSingle(),
        db().rpc('lead_last_contacts', { p_loan: loanId }),
      ])
      if (loan.error || contact.error) return null
      const row = loan.data as { next_action: NextActionId | null; next_action_manual: boolean; ready_on: string | null } | null
      const last = (contact.data as { last_contact_at: string | null }[])[0]?.last_contact_at ?? null
      return { nextAction: row?.next_action ?? null, manual: row?.next_action_manual ?? false, lastContactAt: last, readyOn: row?.ready_on ?? null }
    },
  })
}

/** Picks a file's Next Action by hand; null goes back to automatic (from the file). */
export function useSetNextAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, nextAction }: { id: string; nextAction: NextActionId | null }) => {
      const r = await db().from('loans').update({ next_action: nextAction }).eq('id', id).select('id')
      if (r.error) throw new Error(/next_action/.test(r.error.message) ? 'Run the next action script in Supabase first.' : r.error.message)
      if (!r.data?.length) throw new Error('You do not have permission to change this file.')
    },
    onSettled: (_d, _e, v) => {
      queryClient.invalidateQueries({ queryKey: nextActionKey })
      queryClient.invalidateQueries({ queryKey: keys.loan(v.id) })
    },
  })
}
