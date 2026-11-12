import { describe, expect, it } from 'vitest'
import { incomeDrafts, incomeKindOf, monthsThrough, type IncomeDoc, type IncomeJob } from './fromDocuments'
import { computeWorksheet } from './worksheets'

const today = '2026-11-12'
const f = (v: string | number) => ({ value: v, quote: String(v) })
const excel: IncomeJob = { id: 'excel', employerName: 'Excel', current: true, selfEmployed: false, startDate: '2024-01-01', endDate: null }
const stub = (over: IncomeDoc['fields'] = {}): IncomeDoc => ({
  documentId: 'stub1',
  fileName: 'oct-stub.pdf',
  kind: 'paystub',
  fields: { employer_name: f('Excel Inc'), pay_date: f('2026-10-31'), pay_frequency: f('biweekly'), base_pay_current: f(2000), ytd_base: f(41500), ytd_gross: f(45000), ytd_overtime: f(3500), ...over },
})
const w2 = (year: number, wages: number, id = `w2-${year}`): IncomeDoc => ({ documentId: id, fileName: `${year}-w2.pdf`, kind: 'w2', fields: { employer_name: f('EXCEL'), tax_year: f(year), w2_wages: f(wages) } })

describe('months through a date', () => {
  it('Oct 31 = 10; Sep 15 = 8.5', () => {
    expect(monthsThrough('2026-10-31')).toBe(10)
    expect(monthsThrough('2026-09-15')).toBe(8.5)
  })
})

describe('W-2 job', () => {
  it('stated base below the YTD average: the stated rate, plus an overtime draft', () => {
    // $2,000 biweekly = $4,333.33/mo; YTD $41,500 / 10 = $4,150/mo is lower → YTD average.
    const d = incomeDrafts({ docs: [stub(), w2(2025, 52000)], jobs: [excel], today })
    expect(d.map((x) => [x.data.kind, x.label, x.employmentId])).toEqual([
      ['salary', 'Salary · Excel', 'excel'],
      ['variable', 'Overtime · Excel', 'excel'],
    ])
    expect(d[0].data.inputs).toEqual({ frequency: 'monthly', amount: 4150 })
    expect(computeWorksheet(d[0].data).monthly).toBe(4150)
    expect(d[0].notes).toContain('YTD base average $4,150/mo ($41,500 over 10 months) is lower than the stated $4,333/mo, so the YTD average is used')
    expect(d[0].sourceDocumentIds).toEqual(['stub1', 'w2-2025'])
    expect(d[1].data.inputs).toEqual({ incomeType: 'overtime', ytdAmount: 3500, ytdMonths: 10, priorYear1: null, priorYear2: null })
  })
  it('the stated rate when it is the lower one', () => {
    const d = incomeDrafts({ docs: [stub({ ytd_base: f(45000), ytd_overtime: f(0) })], jobs: [excel], today })
    expect(d[0].data.inputs).toEqual({ frequency: 'biweekly', amount: 2000 })
    expect(d[0].notes).toContain('No W-2 analyzed yet for this job')
  })
  it('a pace well below last year’s W-2 is noted', () => {
    const d = incomeDrafts({ docs: [stub(), w2(2025, 70000)], jobs: [excel], today })
    expect(d[0].notes).toContain("This year's pace is 23% below the 2025 W-2: the underwriter will ask why")
  })
  it("documents from another employer, or a job that isn't current, don't count", () => {
    const old: IncomeJob = { ...excel, id: 'old', employerName: 'Old Co', current: false }
    expect(incomeDrafts({ docs: [stub({ employer_name: f('Old Co') })], jobs: [excel, old], today })).toEqual([])
  })
})

describe('bank statements', () => {
  const stmt = (i: number, deposits: number, extra: IncomeDoc['fields'] = {}): IncomeDoc => ({ documentId: `s${i}`, fileName: `s${i}.pdf`, kind: 'bank_statement', fields: { total_deposits: f(deposits), ...extra } })
  it('sums deposits, divides by 12, lists large deposits to exclude', () => {
    const docs = [stmt(1, 10000, { deposits: [{ date: '2026-09-03', amount: 9000, description: 'TRANSFER FROM SAVINGS' }] } as never), ...Array.from({ length: 11 }, (_, i) => stmt(i + 2, 10000))]
    const [d] = incomeDrafts({ docs, jobs: [], today, only: 'bank_statement' })
    expect(d.data).toMatchObject({ kind: 'bank_statement', inputs: { totalDeposits: 120000, months: 12, accountType: 'business', expenseRatioPct: 50 } })
    expect(computeWorksheet(d.data).monthly).toBe(5000)
    expect(d.notes.some((n) => n.startsWith('Large deposit Sep 3, 2026 $9,000 (TRANSFER FROM SAVINGS)'))).toBe(true)
  })
  it('says when months are missing; uses the expense factor given', () => {
    const [d] = incomeDrafts({ docs: [stmt(1, 8000), stmt(2, 8000)], jobs: [], today, expenseRatioPct: 30 })
    expect(d.notes).toContain('Only 2 of 12 months uploaded: the total is divided by 12, so add the missing statements')
    expect(d.data.inputs).toMatchObject({ expenseRatioPct: 30 })
  })
})

describe('tax returns', () => {
  const se: IncomeJob = { id: 'biz', employerName: 'Pat Consulting', current: true, selfEmployed: true, startDate: '2019-01-01', endDate: null }
  it('Schedule C: the two most recent years into the self-employed worksheet', () => {
    const ret = (year: number, profit: number, dep: number): IncomeDoc => ({ documentId: `r${year}`, fileName: `${year}.pdf`, kind: 'tax_return', fields: { return_form: f('1040'), tax_year: f(year), sch_c_net_profit: f(profit), sch_c_depreciation: f(dep) } })
    const [d] = incomeDrafts({ docs: [ret(2023, 50000, 0), ret(2025, 70000, 2000), ret(2024, 60000, 1000)], jobs: [se], today })
    expect(d.data.kind).toBe('schedule_c')
    expect(d.data.inputs).toMatchObject({ recentYear: 2025, recent: { netProfit: 70000, depreciation: 2000 }, older: { netProfit: 60000, depreciation: 1000 } })
    expect(d.employmentId).toBe('biz')
    expect(d.sourceDocumentIds).toEqual(['r2025', 'r2024'])
  })
  it('1065 with a K-1: a partnership worksheet with guaranteed payments; one year is noted', () => {
    const [d] = incomeDrafts({ docs: [{ documentId: 'p', fileName: 'p.pdf', kind: 'business_return', fields: { return_form: f('1065'), tax_year: f(2025), k1_ordinary_income: f(40000), k1_guaranteed_payments: f(24000), k1_ownership_pct: f(50) } }], jobs: [se], today })
    expect(d.data).toMatchObject({ kind: 'partnership', inputs: { recent: { k1OrdinaryIncome: 40000, k1GuaranteedPayments: 24000, ownershipPct: 50 } } })
    expect(d.notes).toContain('Only one year of returns analyzed: the two-year rule needs both years')
  })
})

describe('which income a document feeds', () => {
  it('maps document types', () => {
    expect(['paystub', 'w2', 'bank_statement', 'tax_return', 'photo_id'].map(incomeKindOf)).toEqual(['wages', 'wages', 'bank_statement', 'returns', null])
  })
})
