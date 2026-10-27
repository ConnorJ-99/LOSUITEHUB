import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LetterDraft, SavedLetter } from '@/lib/documents/preapproval'
import { db, keys, num, unwrap } from './client'

interface LetterRow {
  id: string
  property_id: string | null
  reference_number: string
  version: number
  property_address: string | null
  purchase_price: unknown
  loan_amount: unknown
  mortgage_type: LetterDraft['mortgageType']
  term_months: number | null
  amortization_type: LetterDraft['amortizationType']
  occupancy: LetterDraft['occupancy']
  seller_credits: unknown
  earnest_money: unknown
  show_seller_credits: boolean
  show_earnest_money: boolean
  show_down_payment: boolean
  reviewed: string[]
  extra_conditions: string[]
  issued_on: string
  expires_on: string
  document_id: string | null
  created_at: string
}

const toLetter = (r: LetterRow): SavedLetter => ({
  id: r.id,
  referenceNumber: r.reference_number,
  version: r.version,
  documentId: r.document_id,
  createdAt: r.created_at,
  propertyId: r.property_id,
  propertyAddress: r.property_address,
  purchasePrice: num(r.purchase_price),
  loanAmount: num(r.loan_amount),
  mortgageType: r.mortgage_type,
  termMonths: r.term_months,
  amortizationType: r.amortization_type,
  occupancy: r.occupancy,
  sellerCredits: num(r.seller_credits),
  earnestMoney: num(r.earnest_money),
  showSellerCredits: r.show_seller_credits,
  showEarnestMoney: r.show_earnest_money,
  showDownPayment: r.show_down_payment,
  reviewed: r.reviewed,
  extraConditions: r.extra_conditions,
  issuedOn: r.issued_on,
  expiresOn: r.expires_on,
})

/** A file's pre-approval letters, newest first. */
export function usePreapprovalLetters(loanId: string, enabled = true) {
  return useQuery({
    queryKey: keys.preapprovalLetters(loanId),
    enabled,
    queryFn: async () => unwrap<LetterRow[]>(await db().from('preapproval_letters').select('*').eq('loan_id', loanId).order('created_at', { ascending: false })).map(toLetter),
  })
}

/** Records a letter as issued (it can't be changed afterwards). Returns its id. */
export async function issueLetter(loanId: string, organizationId: string, d: LetterDraft, referenceNumber: string, version: number): Promise<string> {
  const row = unwrap<{ id: string }[]>(
    await db()
      .from('preapproval_letters')
      .insert({
        organization_id: organizationId,
        loan_id: loanId,
        property_id: d.propertyId,
        reference_number: referenceNumber,
        version,
        property_address: d.propertyAddress,
        purchase_price: d.purchasePrice,
        loan_amount: d.loanAmount,
        mortgage_type: d.mortgageType,
        term_months: d.termMonths,
        amortization_type: d.amortizationType,
        occupancy: d.occupancy,
        seller_credits: d.sellerCredits,
        earnest_money: d.earnestMoney,
        show_seller_credits: d.showSellerCredits,
        show_earnest_money: d.showEarnestMoney,
        show_down_payment: d.showDownPayment,
        reviewed: d.reviewed,
        extra_conditions: d.extraConditions.map((c) => c.trim()).filter(Boolean),
        issued_on: d.issuedOn,
        expires_on: d.expiresOn,
      })
      .select('id'),
  )
  return row[0].id
}

export async function linkLetterPdf(letterId: string, documentId: string) {
  unwrap(await db().from('preapproval_letters').update({ document_id: documentId }).eq('id', letterId).select('id'))
}

/** Removes a letter record made by mistake (its PDF stays in Documents). */
export async function removeLetter(letterId: string) {
  unwrap(await db().from('preapproval_letters').delete().eq('id', letterId).select('id'))
}

export function useRemoveLetter(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: removeLetter,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.preapprovalLetters(loanId) }),
  })
}
