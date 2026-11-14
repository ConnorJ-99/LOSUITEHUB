import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { db, keys, unwrap } from './client'

/** Someone on a file who can get an intro or update text: a borrower, or a partner on the file's team. */
export interface FileRecipient {
  kind: 'borrower' | 'partner'
  id: string
  name: string
  /** "Borrower", "Co-borrower", "Buyer's agent"… */
  role: string
  phone: string | null
  smsConsent: boolean | null
  smsOptedOutAt: string | null
}

const ROLE: Record<string, string> = { primary: 'Borrower', co_borrower: 'Co-borrower', buyer_agent: "Buyer's agent", listing_agent: 'Listing agent', title: 'Title', escrow_officer: 'Escrow officer' }

export function useFileRecipients(loanId: string | null) {
  return useQuery({
    queryKey: ['fileRecipients', loanId],
    enabled: !!loanId,
    queryFn: async (): Promise<FileRecipient[]> => {
      const [people, team] = await Promise.all([
        db().from('loan_borrowers').select('role, contact:contacts!loan_borrowers_contact_id_fkey ( id, first_name, last_name, phone, sms_consent, sms_opted_out_at )').eq('loan_id', loanId!),
        db().from('loan_team_members').select('role, partner:partners!loan_team_members_partner_id_fkey ( * )').eq('loan_id', loanId!).not('partner_id', 'is', null),
      ])
      const p = unwrap<{ role: string; contact: { id: string; first_name: string; last_name: string; phone: string | null; sms_consent: boolean | null; sms_opted_out_at: string | null } | null }[]>(people)
      const t = unwrap<{ role: string; partner: { id: string; name: string; phone: string | null; sms_consent: boolean | null; sms_opted_out_at: string | null; email_via_gmail?: boolean } | null }[]>(team)
      const out: FileRecipient[] = p.flatMap((r) => (r.contact ? [{ kind: 'borrower' as const, id: r.contact.id, name: `${r.contact.first_name} ${r.contact.last_name}`.trim(), role: ROLE[r.role] ?? 'Borrower', phone: r.contact.phone, smsConsent: r.contact.sms_consent, smsOptedOutAt: r.contact.sms_opted_out_at }] : []))
      for (const r of t) {
        // Gmail partners (title, insurance) are emailed from Messages, never texted through GoHighLevel.
        if (r.partner && !r.partner.email_via_gmail && !out.some((o) => o.kind === 'partner' && o.id === r.partner!.id))
          out.push({ kind: 'partner', id: r.partner.id, name: r.partner.name, role: ROLE[r.role] ?? r.role, phone: r.partner.phone, smsConsent: r.partner.sms_consent, smsOptedOutAt: r.partner.sms_opted_out_at })
      }
      return out
    },
  })
}

/** Records that they agreed to texts, with how (borrowers through record_consent; partners on their record). */
export async function recordTextConsent(r: Pick<FileRecipient, 'kind' | 'id'>, note: string) {
  if (r.kind === 'borrower') unwrap(await db().rpc('record_consent', { p_contact_id: r.id, p_channel: 'text', p_note: note }))
  else {
    const rows = unwrap<{ id: string }[]>(await db().from('partners').update({ sms_consent: true }).eq('id', r.id).is('sms_opted_out_at', null).select('id'))
    if (!rows.length) throw new Error('Their text consent could not be recorded (an opt-out is only undone by restoring consent).')
  }
}

/**
 * Sends one text: the approval for this exact message (the file's LO or an
 * admin), then the ghl function's send with every check (consent, opt-outs,
 * Do Not Disturb, sending hours, test mode, the LO's own number).
 */
export async function sendFileText(organizationId: string, loanId: string, r: Pick<FileRecipient, 'kind' | 'id'>, body: string, key: string) {
  const approvalId = unwrap<string>(
    r.kind === 'borrower'
      ? await db().rpc('approve_send', { p_loan_id: loanId, p_contact_id: r.id, p_channel: 'text', p_subject: null, p_body: body, p_document_ids: [], p_client_key: key })
      : await db().rpc('approve_partner_send', { p_loan_id: loanId, p_partner_id: r.id, p_channel: 'text', p_subject: null, p_body: body, p_client_key: key }),
  )
  const { error } = await db().functions.invoke('ghl', { body: { task: 'send', organizationId, approvalId } })
  if (error) {
    const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
    throw new Error(detail?.error ?? 'The text was not sent.')
  }
}

/** Saves the texts to the Action Queue as drafts instead (a borrower's draft can be sent from Today; a partner's is copied). */
export async function saveTextDrafts(organizationId: string, loanId: string, title: string, items: { r: FileRecipient; body: string }[]) {
  if (!items.length) return
  unwrap(
    await db()
      .from('action_items')
      .insert(
        items.map(({ r, body }) => ({
          organization_id: organizationId,
          loan_id: loanId,
          kind: 'draft_message',
          title: `${title}: ${r.name}`,
          payload: { channel: 'text', to: `${r.name} (${r.role.toLowerCase()})`, subject: null, body, ...(r.kind === 'borrower' && { contactId: r.id }) },
          sources: [],
          confidence: null,
          due_on: null,
          ai_run_id: null,
        })),
      )
      .select('id'),
  )
}

export function useRefreshAfterTexts(loanId: string | null) {
  const queryClient = useQueryClient()
  return () => {
    for (const key of [['messages'], ['fileRecipients', loanId], ['partners'], keys.today, ...(loanId ? [keys.queue(loanId)] : [])]) queryClient.invalidateQueries({ queryKey: key })
  }
}
