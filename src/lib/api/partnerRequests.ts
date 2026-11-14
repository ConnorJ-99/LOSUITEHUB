// Sending a title or insurance request email to the partner on a file
// (Connor, 2026-11-14), through GoHighLevel like every other message: the
// file's loan officer or an admin approves this exact email
// (approve_partner_send), then the ghl function sends only that, with every
// check (email consent, opt-outs, Do Not Disturb, sending hours, test mode).
// Their replies come back through ghl-inbound, saved on the file they are about.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useAuth } from '@/lib/auth/context'
import { db, keys, unwrap } from './client'
import { MESSAGE_SELECT, toMessage, type Message, type MessageRow } from './messages'

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

export interface PartnerMessage extends Message {
  partnerId: string
}

/** Every text and email with partners (title, insurance, realtors) saved on this file, newest first. */
export function usePartnerMessages(loanId: string) {
  return useQuery({
    // Under ['messages'] so new ones show the moment they're saved (useMessagesLive).
    queryKey: ['messages', 'partner', loanId],
    queryFn: async (): Promise<PartnerMessage[]> =>
      unwrap<(MessageRow & { partner_id: string })[]>(
        await db().from('messages').select(`${MESSAGE_SELECT}, partner_id`).eq('loan_id', loanId).not('partner_id', 'is', null).order('sent_at', { ascending: false }).limit(200),
      ).map((r) => ({ ...toMessage(r), partnerId: r.partner_id })),
  })
}

/** Marks a partner's received messages on this file read (opening them does this). */
export function useMarkPartnerRead(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (partnerId: string) => unwrap<number>(await db().rpc('mark_partner_messages_read', { p_loan_id: loanId, p_partner_id: partnerId })),
    onSuccess: (n) => {
      if (n > 0) queryClient.invalidateQueries({ queryKey: ['messages'] })
    },
  })
}
