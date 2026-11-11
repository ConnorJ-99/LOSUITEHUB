import { useQuery } from '@tanstack/react-query'
import { db } from './client'

/**
 * Cash to close from the estimate Selected for the file (its saved figures),
 * for the loan header. Null when nothing is selected or it has no figures.
 * Nothing is calculated here.
 */
export function useSelectedCashToClose(pricingScenarioId: string | null) {
  return useQuery({
    queryKey: ['selectedCashToClose', pricingScenarioId],
    enabled: !!pricingScenarioId,
    retry: false,
    queryFn: async (): Promise<number | null> => {
      const r = await db().from('pricing_scenarios').select('figures').eq('id', pricingScenarioId!).maybeSingle()
      const f = (r.data as { figures: { cashToClose?: number } | null } | null)?.figures
      return typeof f?.cashToClose === 'number' ? f.cashToClose : null
    },
  })
}
