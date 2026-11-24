// My assets from MPS-HQ's side (nurture goals Phase 2, Connor 2026-11-24):
// read only. The accounts and balances a borrower keeps in MyHome
// (`borrower_assets`, on the person) and every balance they reported
// (`borrower_asset_balances`). Only MyHome writes them; the file's verified
// assets stay on the 1003. Before the script has run, reads come back null.
import { useQuery } from '@tanstack/react-query'
import { db } from './client'

export type ReportedCategory = 'checking' | 'savings' | 'cash' | 'investment' | 'retirement' | 'other'

export const REPORTED_CATEGORY_LABEL: Record<ReportedCategory, string> = {
  checking: 'Checking',
  savings: 'Savings',
  cash: 'Cash',
  investment: 'Investment',
  retirement: 'Retirement',
  other: 'Other',
}

export interface ReportedAsset {
  id: string
  contactId: string
  nickname: string
  institution: string | null
  category: ReportedCategory
  balance: number
  balanceOn: string
  notes: string | null
  /** Every balance reported, newest first (the current one included). */
  history: { balance: number; on: string; loggedAt: string }[]
}

export function useReportedAssets(contactIds: string[]) {
  return useQuery({
    queryKey: ['reportedAssets', ...[...contactIds].sort()],
    enabled: contactIds.length > 0,
    retry: false,
    queryFn: async (): Promise<ReportedAsset[] | null> => {
      const [a, h] = await Promise.all([
        db().from('borrower_assets').select('id, contact_id, nickname, institution, category, balance, balance_on, notes').in('contact_id', contactIds).is('archived_at', null).order('sort_order').order('created_at'),
        db().from('borrower_asset_balances').select('asset_id, balance, balance_on, created_at').in('contact_id', contactIds).order('balance_on', { ascending: false }).order('created_at', { ascending: false }).limit(500),
      ])
      if (a.error || h.error) return null
      const hist = h.data as { asset_id: string; balance: number; balance_on: string; created_at: string }[]
      return (a.data as { id: string; contact_id: string; nickname: string; institution: string | null; category: ReportedCategory; balance: number; balance_on: string; notes: string | null }[]).map((r) => ({
        id: r.id,
        contactId: r.contact_id,
        nickname: r.nickname,
        institution: r.institution,
        category: r.category,
        balance: Number(r.balance),
        balanceOn: r.balance_on,
        notes: r.notes,
        history: hist.filter((x) => x.asset_id === r.id).map((x) => ({ balance: Number(x.balance), on: x.balance_on, loggedAt: x.created_at })),
      }))
    },
  })
}
