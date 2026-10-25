import type { Property } from '@/lib/api/types'
import { netMonthlyRental } from '@/lib/calc'

/** The properties that count as "real estate owned" on the 1003 (section 3). */
export function ownedProperties(properties: Property[] | undefined): Property[] {
  return (properties ?? []).filter((p) => p.status === 'current_home' || p.status === 'owned')
}

/** True when the Income tab has set this property to use its Schedule E figure. */
export function usesScheduleE(p: Property): boolean {
  return p.rentalIncomeMethod === 'schedule_e' && p.scheduleEMonthlyIncome !== null
}

/** Net monthly rental for a retained property, by its chosen method (lease or Schedule E). */
export function propertyNetRental(p: Property): number {
  return netMonthlyRental({
    monthlyRent: p.monthlyRent,
    annualTaxes: p.annualTaxes,
    annualInsurance: p.annualInsurance,
    monthlyHoa: p.monthlyHoa,
    lienPayments: p.liens.filter((l) => !l.toBePaidOff).map((l) => l.monthlyPayment ?? 0),
    rentalMethod: p.rentalIncomeMethod,
    scheduleEMonthly: p.scheduleEMonthlyIncome,
  })
}
