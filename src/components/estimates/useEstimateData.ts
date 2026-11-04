import { useQueryClient } from '@tanstack/react-query'
import { keys } from '@/lib/api/client'
import { createEstimate, fetchEstimates, fetchLoanFees, loanFeesKey, resetFees, saveFees, updateEstimate, useEstimates, useLoanFees } from '@/lib/api/estimates'
import { fetchFeeTemplates, useFeeTemplates, type SavedFeeTemplate } from '@/lib/api/pricing'
import { fetchProperties, useProperties } from '@/lib/api/properties'
import type { LoanProfile, Property } from '@/lib/api/types'
import { fetchApplication, useApplication, type Application } from '@/lib/api/urla'
import type { FeeOverride } from '@/lib/calc'
import { nowIso } from '@/lib/dates'
import { activeRules, computeEstimate, estimateChanges, feeChanges, withResults, type Estimate, type EstimateDraft, type SavedFigures } from '@/lib/estimates/estimate'
import { loanFactsFor } from '@/lib/estimates/facts'

export const draftOf = (e: Estimate): EstimateDraft => {
  const { id: _id, program: _p, createdAt: _c, updatedAt: _u, ...draft } = e
  return draft
}

interface Loaded {
  list: Estimate[]
  feeMap: Map<string, FeeOverride[]>
  rules: SavedFeeTemplate[]
  application: Application
  homes: Property[]
}

/**
 * The Estimate tool's data and saves for one file, from what's loaded. Used
 * by the Scenarios & Estimate tab (useEstimateData) and by the assistant
 * (loadEstimateData), so both price and save estimates the same way.
 */
export function estimateDataFrom(loan: LoanProfile, { list, feeMap, rules, application, homes }: Loaded) {
  const factsFor = (propertyId: string | null) => loanFactsFor(loan, application, homes, propertyId)
  const feesOf = (id: string) => feeMap.get(id) ?? []
  /** The saved figures (or, for an estimate saved before figures were kept, worked out from its saved facts). */
  const figuresOf = (e: Estimate): SavedFigures => e.figures ?? computeEstimate({ ...draftOf(e), feeRules: draftOf(e).feeRules ?? activeRules(rules, e.program?.lenderId ?? null) }, feesOf(e.id), rules, e.loanSnapshot?.facts ?? factsFor(e.propertyId)).saved

  /** Saves a new estimate with its results, fee rules and loan facts. */
  const create = async (draft: EstimateDraft, overrides: FeeOverride[] = [], lenderId: string | null = null) => {
    const ready = withResults(draft, overrides, rules, factsFor(draft.propertyId), nowIso(), lenderId)
    const created = await createEstimate(ready, loan.organizationId, overrides)
    return created
  }

  /** Saves what changed on an estimate (inputs and fee edits) and its new results. */
  const save = async (e: Estimate, draft: EstimateDraft, overrides: FeeOverride[]) => {
    const ready = withResults(draft, overrides, rules, factsFor(draft.propertyId), nowIso(), e.program?.lenderId ?? null)
    const changes = estimateChanges(draftOf(e), ready)
    const f = feeChanges(feesOf(e.id), overrides)
    if (Object.keys(changes).length) await updateEstimate(e.id, changes)
    if (f.upsert.length) await saveFees(e, loan.organizationId, f.upsert)
    for (const key of f.remove) await resetFees(e.id, key)
    return ready
  }

  return { list, feesOf, figuresOf, factsFor, templates: rules, properties: homes, application, create, save, noFeeList: rules.length === 0 }
}

/** Loads a file's estimate data outside a screen (the assistant). */
export async function loadEstimateData(loan: LoanProfile) {
  const [list, feeMap, rules, application, homes] = await Promise.all([fetchEstimates(loan.id), fetchLoanFees(loan.id), fetchFeeTemplates(), fetchApplication(loan.id), fetchProperties(loan.id)])
  return { ...estimateDataFrom(loan, { list, feeMap, rules, application, homes }), refresh: async () => {} }
}

/** Everything Scenarios & Estimate loads for a file, and the saves it makes. */
export function useEstimateData(loan: LoanProfile) {
  const estimates = useEstimates(loan.id)
  const fees = useLoanFees(loan.id)
  const templates = useFeeTemplates()
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  const queryClient = useQueryClient()

  const loading = estimates.isLoading || fees.isLoading || templates.isLoading || app.isLoading || properties.isLoading
  const error = estimates.error ?? fees.error ?? app.error ?? properties.error ?? null

  const refresh = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: keys.pricingScenarios(loan.id) }), queryClient.invalidateQueries({ queryKey: loanFeesKey(loan.id) })])
  }

  const data = estimateDataFrom(loan, {
    list: estimates.data ?? [],
    feeMap: fees.data ?? new Map<string, FeeOverride[]>(),
    rules: templates.data ?? [],
    application: app.data ?? { borrowers: [], assets: [], liabilities: [] },
    homes: properties.data ?? [],
  })
  return { loading, error, ...data, refresh }
}

export type EstimateData = ReturnType<typeof useEstimateData>
