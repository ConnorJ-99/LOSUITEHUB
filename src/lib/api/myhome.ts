// MyHome from MPS-HQ's side (Stage 1, docs/plans/myhome.md): the primary
// borrower's MyHome account on a file, "Send MyHome code to GHL"
// (invite_to_myhome() makes the permanent code and link, then the ghl
// function writes them to the GHL contact and adds the tag that starts
// Connor's email workflow), "New code" and Turn off. Before the MyHome script
// has run, reads come back null.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { db, unwrap } from './client'

export interface MyHomeAccount {
  id: string
  contactId: string
  status: 'invited' | 'active' | 'off'
  codeSentAt: string | null
  invitedAt: string
  lastSignedInAt: string | null
}

const accountsKey = (contactIds: string[]) => ['myhomeAccounts', ...[...contactIds].sort()] as const

/** The MyHome accounts of these people. Null = the MyHome script hasn't run yet. */
export function useMyHomeAccounts(contactIds: string[]) {
  return useQuery({
    queryKey: accountsKey(contactIds),
    enabled: contactIds.length > 0,
    retry: false,
    queryFn: async (): Promise<MyHomeAccount[] | null> => {
      const r = await db().from('borrower_accounts').select('id, contact_id, status, code_sent_at, invited_at, last_signed_in_at').in('contact_id', contactIds)
      if (r.error) return null
      return (r.data as { id: string; contact_id: string; status: MyHomeAccount['status']; code_sent_at: string | null; invited_at: string; last_signed_in_at: string | null }[]).map((a) => ({
        id: a.id,
        contactId: a.contact_id,
        status: a.status,
        codeSentAt: a.code_sent_at,
        invitedAt: a.invited_at,
        lastSignedInAt: a.last_signed_in_at,
      }))
    },
  })
}

export type SendCodeResult = { sent: true } | { skipped: string }

/** Invites the person if needed (or makes a new code), then sends the code and link to their GHL contact with the tag. */
export function useSendMyHomeCode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { organizationId: string; loanId: string; contactId: string; newCode?: boolean }): Promise<SendCodeResult> => {
      unwrap(await db().rpc('invite_to_myhome', { p_contact_id: v.contactId, p_new_code: v.newCode ?? false }))
      const { data, error } = await db().functions.invoke<SendCodeResult>('ghl', {
        body: { task: 'myhome_code', organizationId: v.organizationId, loanId: v.loanId, contactId: v.contactId, appUrl: window.location.origin },
      })
      if (error) {
        const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
        throw new Error(detail?.error ?? 'The MyHome code was not sent to GHL.')
      }
      return data as SendCodeResult
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['myhomeAccounts'] }),
  })
}

export function useTurnOffMyHome() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (accountId: string) => {
      unwrap(await db().rpc('turn_off_myhome', { p_account_id: accountId }))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['myhomeAccounts'] }),
  })
}
