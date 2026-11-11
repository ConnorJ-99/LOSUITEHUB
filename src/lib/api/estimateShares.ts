import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ShareSnapshot } from '../../../supabase/functions/estimate-view/rules'
import { db, unwrap } from './client'

/** Shared estimates links on a file (build plan Phase 7). */
export interface EstimateShare {
  id: string
  contactId: string
  contactName: string
  channel: 'text' | 'email'
  estimateIds: string[]
  snapshot: ShareSnapshot
  token: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  firstOpenedAt: string | null
  lastOpenedAt: string | null
  views: number
  pickedEstimateId: string | null
  pickedAt: string | null
}

/** A borrower the estimates can go to. */
export interface ShareRecipient {
  contactId: string
  firstName: string
  name: string
  role: 'primary' | 'co_borrower'
  email: string | null
  phone: string | null
  smsConsent: boolean | null
  emailConsent: boolean | null
  smsOptedOutAt: string | null
  emailOptedOutAt: string | null
}

export const shareKeys = { list: (loanId: string) => ['estimateShares', loanId] as const, recipients: (loanId: string) => ['estimateShareRecipients', loanId] as const }

interface ShareRow {
  id: string
  contact_id: string
  channel: 'text' | 'email'
  estimate_ids: string[]
  snapshot: ShareSnapshot
  token: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  first_opened_at: string | null
  last_opened_at: string | null
  views: number
  picked_estimate_id: string | null
  picked_at: string | null
  contact: { first_name: string; last_name: string | null } | null
}

const fromRow = (r: ShareRow): EstimateShare => ({
  id: r.id,
  contactId: r.contact_id,
  contactName: r.contact ? `${r.contact.first_name} ${r.contact.last_name ?? ''}`.trim() : 'Borrower',
  channel: r.channel,
  estimateIds: r.estimate_ids,
  snapshot: r.snapshot,
  token: r.token,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
  firstOpenedAt: r.first_opened_at,
  lastOpenedAt: r.last_opened_at,
  views: r.views,
  pickedEstimateId: r.picked_estimate_id,
  pickedAt: r.picked_at,
})

const SHARE_SELECT =
  'id, contact_id, channel, estimate_ids, snapshot, token, created_at, expires_at, revoked_at, first_opened_at, last_opened_at, views, picked_estimate_id, picked_at, contact:contacts!estimate_shares_contact_id_fkey ( first_name, last_name )'

/** The file's shares, newest first. Empty (not an error) before the estimate shares script has run. */
export function useEstimateShares(loanId: string) {
  return useQuery({
    queryKey: shareKeys.list(loanId),
    retry: false,
    queryFn: async (): Promise<EstimateShare[]> => {
      const r = await db().from('estimate_shares').select(SHARE_SELECT).eq('loan_id', loanId).order('created_at', { ascending: false })
      if (r.error) {
        if (/estimate_shares|schema cache|does not exist/i.test(r.error.message)) return []
        throw new Error(r.error.message)
      }
      return (r.data as unknown as ShareRow[]).map(fromRow)
    },
  })
}

export function useShareRecipients(loanId: string) {
  return useQuery({
    queryKey: shareKeys.recipients(loanId),
    queryFn: async (): Promise<ShareRecipient[]> => {
      const rows = unwrap<
        {
          role: 'primary' | 'co_borrower'
          contact: { id: string; first_name: string; last_name: string | null; email: string | null; phone: string | null; sms_consent: boolean | null; email_consent: boolean | null; sms_opted_out_at: string | null; email_opted_out_at: string | null } | null
        }[]
      >(
        await db()
          .from('loan_borrowers')
          .select('role, contact:contacts!loan_borrowers_contact_id_fkey ( id, first_name, last_name, email, phone, sms_consent, email_consent, sms_opted_out_at, email_opted_out_at )')
          .eq('loan_id', loanId),
      )
      return rows
        .filter((r) => r.contact)
        .map((r) => ({
          contactId: r.contact!.id,
          firstName: r.contact!.first_name,
          name: `${r.contact!.first_name} ${r.contact!.last_name ?? ''}`.trim(),
          role: r.role,
          email: r.contact!.email,
          phone: r.contact!.phone,
          smsConsent: r.contact!.sms_consent,
          emailConsent: r.contact!.email_consent,
          smsOptedOutAt: r.contact!.sms_opted_out_at,
          emailOptedOutAt: r.contact!.email_opted_out_at,
        }))
        .sort((a, b) => (a.role === b.role ? 0 : a.role === 'primary' ? -1 : 1))
    },
  })
}

/** Saves the frozen copy and returns the new link's token. The database checks it's the file's LO or an admin. */
export async function createShare(v: { organizationId: string; loanId: string; contactId: string; channel: 'text' | 'email'; estimateIds: string[]; snapshot: ShareSnapshot; expiresAt: string }): Promise<EstimateShare> {
  const rows = unwrap<ShareRow[]>(
    await db()
      .from('estimate_shares')
      .insert({ organization_id: v.organizationId, loan_id: v.loanId, contact_id: v.contactId, channel: v.channel, estimate_ids: v.estimateIds, snapshot: v.snapshot, expires_at: v.expiresAt })
      .select(SHARE_SELECT),
  )
  if (!rows.length) throw new Error("Only the file's loan officer or an admin can share estimates.")
  return fromRow(rows[0])
}

export function useRevokeShare(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (shareId: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from('estimate_shares').update({ revoked_at: new Date().toISOString() }).eq('id', shareId).is('revoked_at', null).select('id'))
      if (!rows.length) throw new Error('This link could not be revoked.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: shareKeys.list(loanId) }),
  })
}
