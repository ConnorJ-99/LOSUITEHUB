import { toast } from 'sonner'
import { useSavePdf } from '@/components/pdf/useSavePdf'
import type { LoanProfile } from '@/lib/api/types'
import type { FeeOverride } from '@/lib/calc'
import { nowIso } from '@/lib/dates'
import { FEE_WORKSHEET_TEMPLATE, feeWorksheet, joinNames, missingForBorrowerPdf, worksheetFileName } from '@/lib/documents/feeWorksheet'
import { computeEstimate, pricingDraft, type Estimate, type EstimateDraft } from '@/lib/estimates/estimate'
import { remainingLiensFor } from '@/lib/pricing/scenario'
import { draftOf, type EstimateData } from './useEstimateData'

/** The Loan Estimate PDF for one estimate, from its own saved figures (or the open draft's). Saved to Documents like every PDF. */
export function useEstimatePdf(loan: LoanProfile, data: EstimateData) {
  const pdf = useSavePdf(loan)
  const borrowerNames = data.application.borrowers.map((b) => `${b.person.firstName} ${b.person.lastName}`)
  /** Saves the PDF to Documents; returns its id, or null when it wasn't made (the reason is shown). */
  const save = async (estimate: Estimate, draft: EstimateDraft = draftOf(estimate), overrides: FeeOverride[] = data.feesOf(estimate.id)): Promise<string | null> => {
    const facts = draft.loanSnapshot?.facts ?? data.factsFor(draft.propertyId)
    const r = computeEstimate(draft, overrides, data.templates, facts)
    const at = pricingDraft(draft)
    const missing = missingForBorrowerPdf(at, loan.purpose)
    if (missing.length) {
      toast.error(`Fill in the ${joinNames(missing)} first, so the estimate doesn't show a blank or $0 payment.`)
      return null
    }
    const property = data.properties.find((p) => p.id === draft.propertyId) ?? null
    const preparedAt = nowIso()
    const worksheet = feeWorksheet({
      scenarioId: estimate.id,
      purpose: loan.purpose,
      occupancy: loan.details.occupancy,
      scenario: at,
      lines: r.priced.lines,
      totals: r.priced.totals,
      figures: r.priced.figures,
      cash: { label: r.cash.label, amount: Math.abs(r.cash.cashToClose) },
      payoffs: facts.mortgagePayoffs,
      remainingLiens: remainingLiensFor(loan.purpose, property),
      earnestMoney: r.earnestMoney,
      sellerCredits: r.sellerCredits,
      property,
      borrowerNames,
      preparedAt,
    })
    return await pdf.save({
      render: (lib, brand) => lib.feeWorksheetPdf(worksheet, brand),
      tooLong: 'Combine or remove some fee lines.',
      fileName: worksheetFileName('Loan Estimate', joinNames(borrowerNames), preparedAt),
      kind: 'fee_worksheet',
      propertyId: draft.propertyId,
      pricingScenarioId: estimate.id,
      templateVersion: FEE_WORKSHEET_TEMPLATE,
    })
  }
  return { save, saving: pdf.saving, ready: pdf.ready, sendingId: pdf.sendingId, closeSend: pdf.closeSend, borrowerNames }
}
