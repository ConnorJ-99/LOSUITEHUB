// The file facts the condition suggestions read (build plan Phase 8), from
// the saved records: the loan, the 1003, the homes, credit events and the
// selected program's statement months. Pure.

import type { LoanProfile, Property } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { isTexasHomeEquity } from '@/lib/calc/texas'
import type { CreditEventType } from '@/lib/prequal/readiness'
import { ownedProperties } from '@/lib/urla/realEstate'
import { isVaExempt } from './ruleFilters'
import type { FileFacts, ProgramLimits } from './suggest'

export interface SelectedProgram {
  id: string
  name: string
  lenderId: string
  limits: ProgramLimits
}

export function fileFactsFrom(
  loan: LoanProfile,
  app: Application,
  properties: Property[],
  events: { contactId: string; eventType: CreditEventType }[],
  program: SelectedProgram | null,
  year: number,
  /** YYYY-MM-DD; the employment rules count back from it. */
  today: string,
): FileFacts {
  const d = loan.details
  const subject = properties.find((p) => p.id === d.subjectPropertyId) ?? null
  return {
    mortgageType: d.mortgageType,
    purpose: loan.purpose,
    occupancy: d.occupancy,
    propertyType: subject?.propertyType ?? null,
    incomeDocType: d.incomeDocType,
    texasCashOut: isTexasHomeEquity({ purpose: loan.purpose, propertyState: subject?.state ?? null, isHomestead: subject?.isHomestead ?? d.occupancy === 'primary' }),
    entityVesting: d.vestingEntity?.trim() || null,
    vaExempt: isVaExempt(d.mortgageType, d.upfrontFeePct),
    lenderId: program?.lenderId ?? null,
    programId: program?.id ?? d.programId,
    programName: program?.name ?? null,
    program: program?.limits ?? {},
    year,
    today,
    people: app.borrowers.map((b) => ({
      contactId: b.contactId,
      firstName: b.person.firstName,
      jobs: b.employments.filter((j) => j.status === 'current' && j.employerName.trim()).map((j) => ({ id: j.id, employerName: j.employerName.trim(), selfEmployed: j.isSelfEmployed })),
      history: b.employments.filter((j) => j.employerName.trim()).map((j) => ({ id: j.id, employerName: j.employerName.trim(), selfEmployed: j.isSelfEmployed, current: j.status === 'current', startDate: j.startDate, endDate: j.endDate })),
      otherIncomes: b.otherIncomes.map((o) => o.incomeType),
      assets: app.assets
        .filter((a) => a.contactId === b.contactId)
        .map((a) => ({ id: a.id, assetType: a.assetType, institutionName: a.institutionName, accountLast4: a.accountLast4, amount: a.amount, giftSource: a.giftSource })),
      creditEvents: events.filter((e) => e.contactId === b.contactId).map((e) => e.eventType),
    })),
    homes: ownedProperties(properties)
      .filter((p) => p.id !== subject?.id && p.reoDisposition !== 'sold' && p.reoDisposition !== 'pending_sale')
      .map((p) => ({ rented: !!p.monthlyRent || p.rentalIncomeMethod === 'schedule_e' })),
  }
}
