import { describe, expect, it } from 'vitest'
import type { LoanProfile } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import type { PrequalSummary, QuickBorrower } from './draft'
import { readinessInput } from './readinessInput'

describe('readinessInput', () => {
  it("uses the Prequal form's jobs when given, so unsaved start dates count", () => {
    const draftBorrowers = [
      {
        contactId: 'c1',
        firstName: 'Marcus',
        role: 'primary',
        creditScore: 652,
        otherIncomes: [],
        jobs: [
          { key: 'k1', id: 'j1', employerName: 'Reyes Landscaping', selfEmployed: true, monthly: 9800, otherPay: 0, startDate: '2020-05-01' },
          { key: 'k2', id: null, employerName: '  ', selfEmployed: false, monthly: null, otherPay: 0, startDate: null },
        ],
      },
    ] as QuickBorrower[]
    const summary = { creditScore: 652, dti: { back: 30 }, totalIncome: 9800, checks: [], cashNeeded: null, funds: null, saleProceeds: 0 } as unknown as PrequalSummary
    const input = readinessInput({
      loan: { purpose: 'purchase', details: { incomeDocType: null } } as unknown as LoanProfile,
      app: { borrowers: [] } as unknown as Application,
      summary,
      maxDtiPct: 45,
      mortgageType: 'conventional',
      worksheets: [{ employmentId: 'j1' }] as never,
      creditEvents: [],
      creditPulled: true,
      hasAssets: true,
      today: '2026-10-26',
      draftBorrowers,
    })
    expect(input.jobs).toEqual([{ employerName: 'Reyes Landscaping', borrowerName: 'Marcus', selfEmployed: true, startDate: '2020-05-01', hasIncome: true, hasWorksheet: true }])
  })
})
