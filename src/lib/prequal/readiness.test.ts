import { describe, expect, it } from 'vitest'
import { monthsBetween, readiness, type ReadinessInput } from './readiness'

/** A clean, verified purchase file. */
const ready: ReadinessInput = {
  today: '2026-10-26',
  isPurchase: true,
  mortgageType: 'conventional',
  incomeDocType: null,
  creditScore: 700,
  backDtiPct: 38,
  maxDtiPct: 45,
  totalIncome: 9000,
  ltvTooHigh: false,
  cashNeeded: 30000,
  funds: 45000,
  saleProceeds: 0,
  jobs: [{ employerName: 'Sample Co', borrowerName: 'Jane', selfEmployed: false, startDate: '2019-01-01', hasIncome: true, hasWorksheet: true }],
  creditEvents: [],
  creditPulled: true,
  hasAssets: true,
}
const texts = (i: ReadinessInput) => readiness(i).reasons.map((r) => r.text)

describe('readiness', () => {
  it('is ready when everything passes and is verified', () => {
    expect(readiness(ready)).toEqual({ level: 'ready', reasons: [], nurture: [] })
  })

  it('needs documents when the numbers pass but nothing is verified', () => {
    const r = readiness({ ...ready, creditPulled: false, hasAssets: false, jobs: [{ ...ready.jobs[0], hasWorksheet: false }] })
    expect(r.level).toBe('needs_documents')
    expect(r.reasons.map((x) => x.text)).toEqual([
      'Credit not pulled yet.',
      'Income not documented for Sample Co (Jane): pay stubs, W-2s or returns, then an income worksheet.',
      'No savings or assets entered.',
    ])
    expect(texts({ ...ready, creditScore: null, totalIncome: 0 })).toEqual(['Ask for an estimated credit score.', 'No income entered yet.'])
  })

  describe('not ready → Nurture', () => {
    it('credit under 580', () => {
      expect(readiness({ ...ready, creditScore: 579 })).toMatchObject({ level: 'not_ready', nurture: ['credit'] })
      expect(readiness({ ...ready, creditScore: 580, mortgageType: 'fha' }).level).toBe('ready')
    })
    it('short of cash, or too little down', () => {
      const r = readiness({ ...ready, funds: 25000.4, cashNeeded: 30000.16 })
      expect(r).toMatchObject({ level: 'not_ready', nurture: ['down_payment'] })
      expect(r.reasons[0].text).toBe('Short about $5,000 to close (needs about $30,000).')
      expect(readiness({ ...ready, ltvTooHigh: true }).nurture).toEqual(['down_payment'])
    })
    it('must sell first when closing needs the sale money', () => {
      const r = readiness({ ...ready, funds: 45000, saleProceeds: 40000 })
      expect(r).toMatchObject({ level: 'not_ready', nurture: ['must_sell'] })
      expect(r.reasons[0].text).toBe('Needs about $25,000 from selling their home to close.')
      expect(readiness({ ...ready, funds: 75000, saleProceeds: 40000 }).level).toBe('ready')
    })
    it('DTI over 55%', () => {
      expect(readiness({ ...ready, backDtiPct: 55.01 })).toMatchObject({ level: 'not_ready', nurture: ['dti'] })
    })
    it('refinances skip the purchase cash rules', () => {
      expect(readiness({ ...ready, isPurchase: false, funds: 0, ltvTooHigh: true }).level).toBe('ready')
    })
  })

  describe('manual review (likely Non-QM)', () => {
    it('DTI between the loan type max and 55%', () => {
      expect(readiness({ ...ready, backDtiPct: 52.5 })).toMatchObject({ level: 'manual_review', nurture: [] })
      expect(texts({ ...ready, backDtiPct: 55 })).toEqual(['DTI 55% is over the 45% conventional max; Non-QM may allow up to 55%.'])
      expect(readiness({ ...ready, backDtiPct: 49, mortgageType: 'fha', maxDtiPct: 50 }).level).toBe('ready')
    })
    it('score between 580 and the loan type minimum', () => {
      expect(texts({ ...ready, creditScore: 600 })).toEqual(['Score 600 is under the usual 620 conventional minimum; look at FHA or Non-QM.'])
    })
    it('non-full-doc income', () => {
      expect(texts({ ...ready, incomeDocType: 'bank_statement' })).toEqual(['Bank-statement income is a Non-QM program.'])
      expect(readiness({ ...ready, incomeDocType: 'full_doc' }).level).toBe('ready')
    })
    it('self-employed under 2 years, or start date unknown', () => {
      const job = { ...ready.jobs[0], selfEmployed: true, startDate: '2025-06-15' }
      expect(texts({ ...ready, jobs: [job] })).toEqual(['Jane has been self-employed 1 yr 4 mo at Sample Co; agency loans want 2 years.'])
      expect(readiness({ ...ready, jobs: [{ ...job, startDate: '2024-10-26' }] }).level).toBe('ready')
      expect(texts({ ...ready, jobs: [{ ...job, startDate: null }] })).toEqual(['When did Jane start self-employment at Sample Co?'])
    })
    it('a mortgage late in the last 12 months (other lates and collections are noted elsewhere)', () => {
      const late = { type: 'late_payment' as const, date: '2026-02-01', daysLate: 30, isMortgage: true, borrowerName: 'Jane' }
      expect(texts({ ...ready, creditEvents: [late] })).toEqual(['30-day late mortgage payment in Feb 2026 (Jane), within 12 months.'])
      expect(readiness({ ...ready, creditEvents: [{ ...late, isMortgage: false }] }).level).toBe('ready')
      expect(readiness({ ...ready, creditEvents: [{ ...late, date: '2025-09-01' }] }).level).toBe('ready')
      expect(readiness({ ...ready, creditEvents: [{ ...late, type: 'collection', daysLate: null }] }).level).toBe('ready')
    })
    it('bankruptcy or foreclosure inside the waiting period for the loan type', () => {
      const bk = { type: 'bankruptcy_ch7' as const, date: '2023-03-01', daysLate: null, isMortgage: false, borrowerName: 'Jane' }
      expect(texts({ ...ready, creditEvents: [bk] })).toEqual(['Chapter 7 bankruptcy in Mar 2023 (Jane): conventional waits 4 years.'])
      expect(readiness({ ...ready, mortgageType: 'fha', creditEvents: [bk] }).level).toBe('ready')
      expect(texts({ ...ready, creditEvents: [{ ...bk, date: null }] })).toEqual(['Date of the chapter 7 bankruptcy (Jane).'])
      expect(readiness({ ...ready, creditEvents: [{ ...bk, type: 'foreclosure', date: '2020-01-01' }] }).level).toBe('manual_review')
    })
  })

  it('lists every reason, worst first', () => {
    const r = readiness({ ...ready, creditScore: 560, backDtiPct: 50, creditPulled: false })
    expect(r.reasons.map((x) => x.level)).toEqual(['not_ready', 'manual_review', 'needs_documents'])
    expect(r.level).toBe('not_ready')
  })

  it('counts whole months', () => {
    expect(monthsBetween('2024-10-26', '2026-10-26')).toBe(24)
    expect(monthsBetween('2024-10-27', '2026-10-26')).toBe(23)
  })
})
