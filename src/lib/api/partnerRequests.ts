// Sending a title or insurance request email to the partner on a file
// (Connor, 2026-11-14), through GoHighLevel like every other message: the
// file's loan officer or an admin approves this exact email
// (approve_partner_send), then the ghl function sends only that, with every
// check (email consent, opt-outs, Do Not Disturb, sending hours, test mode).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useAuth } from '@/lib/auth/context'
import { db, keys, unwrap } from './client'

export function useSendPartnerEmail(loanId: string) {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (v: { partnerId: string; subject: string; body: string; key: string; recordConsent: boolean }) => {
      // A person's click records that this business partner takes email about the file (never over an opt-out).
      if (v.recordConsent) {
        const rows = unwrap<{ id: string }[]>(await db().from('partners').update({ email_consent: true }).eq('id', v.partnerId).is('email_opted_out_at', null).select('id'))
        if (!rows.length) throw new Error('Their email consent could not be recorded (an opt-out is only undone by restoring consent).')
      }
      const approvalId = unwrap<string>(
        await db().rpc('approve_partner_send', { p_loan_id: loanId, p_partner_id: v.partnerId, p_channel: 'email', p_subject: v.subject, p_body: v.body, p_client_key: v.key }),
      )
      const { error } = await db().functions.invoke('ghl', { body: { task: 'send', organizationId: orgId, approvalId } })
      if (error) {
        const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
        throw new Error(detail?.error ?? 'The email was not sent.')
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.partners })
      queryClient.invalidateQueries({ queryKey: ['messages'] })
    },
  })
}
