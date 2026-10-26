// Gathers the readiness inputs from what's on the file. Pure; the readiness
// rules themselves are in readiness.ts.

import type { CreditEvent } from '@/lib/api/creditEvents'
import type { MortgageTypeKind } from '@/lib/calc'
import type { IncomeWorksheet } from '@/lib/api/income'
import type { LoanProfile } from '@/lib/api/types'
import type { Application, Employment } from '@/lib/api/urla'
import type { PrequalSummary, QuickBorrower } from './draft'
import type { ReadinessInput } from './readiness'

const jobIncome = (e: Employment) =>
  [e.baseIncome, e.overtimeIncome, e.bonusIncome, e.commissionIncome, e.militaryEntitlements, e.otherEmploymentIncome, e.selfEmployedIncome].reduce<number>((s, v) => s + (v ?? 0), 0)

export interface ReadinessSources {
  loan: LoanProfile
  app: Application
  /** The prequal summary: the live draft on the Prequal tab, the saved records elsewhere. */
  summary: PrequalSummary
  maxDtiPct: number
  /** The loan type being looked at (the Prequal form's, before it's saved). */
  mortgageType: MortgageTypeKind | null
  worksheets: IncomeWorksheet[]
  creditEvents: CreditEvent[]
  /** The Workflow's "Pull credit" step is done. */
  creditPulled: boolean
  hasAssets: boolean
  today: string
  /** The Prequal form's jobs, before they're saved (otherwise the saved jobs are used). */
  draftBorrowers?: QuickBorrower[]
}

export function readinessInput(s: ReadinessSources): ReadinessInput {
  const name = (contactId: string) => {
    const b = s.app.borrowers.find((x) => x.contactId === contactId)
    return b ? b.person.firstName : 'Borrower'
  }
  return {
    today: s.today,
    isPurchase: s.loan.purpose === 'purchase',
    mortgageType: s.mortgageType,
    incomeDocType: s.loan.details.incomeDocType,
    creditScore: s.summary.creditScore,
    backDtiPct: s.summary.dti.back,
    maxDtiPct: s.maxDtiPct,
    totalIncome: s.summary.totalIncome,
    ltvTooHigh: s.summary.checks.some((c) => c.label === 'Down payment' && c.status === 'fail'),
    cashNeeded: s.summary.cashNeeded,
    funds: s.summary.funds,
    saleProceeds: s.summary.saleProceeds,
    jobs: s.draftBorrowers
      ? s.draftBorrowers.flatMap((b) =>
          b.jobs
            .filter((j) => j.employerName.trim())
            .map((j) => ({
              employerName: j.employerName,
              borrowerName: b.firstName,
              selfEmployed: j.selfEmployed,
              startDate: j.startDate,
              hasIncome: (j.monthly ?? 0) + j.otherPay > 0,
              hasWorksheet: !!j.id && s.worksheets.some((w) => w.employmentId === j.id),
            })),
        )
      : s.app.borrowers.flatMap((b) =>
      b.employments
        .filter((e) => e.status === 'current')
        .map((e) => ({
          employerName: e.employerName,
          borrowerName: b.person.firstName,
          selfEmployed: e.isSelfEmployed,
          startDate: e.startDate,
          hasIncome: jobIncome(e) > 0,
          hasWorksheet: s.worksheets.some((w) => w.employmentId === e.id),
        })),
    ),
    creditEvents: s.creditEvents.map((e) => ({ type: e.eventType, date: e.eventDate, daysLate: e.daysLate, isMortgage: e.isMortgage, borrowerName: name(e.contactId) })),
    creditPulled: s.creditPulled,
    hasAssets: s.hasAssets,
  }
}
