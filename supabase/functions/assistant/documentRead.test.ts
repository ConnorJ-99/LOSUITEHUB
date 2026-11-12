import { describe, expect, it } from 'vitest'
import { documentFlags, employerKey, matchJob, normalizeDocReading, statementGaps, statusFor, type DocumentReading, type FlagJob } from './documentRead'

const today = '2026-11-12'
const excel: FlagJob = { id: 'excel', employerName: 'Excel', current: true, startDate: '2025-06-15', endDate: null }
const hd: FlagJob = { id: 'hd', employerName: 'The Home Depot, Inc.', current: false, startDate: '2024-06-01', endDate: '2025-06-01' }

describe('cleaning the reply', () => {
  it('keeps known fields, in the right form', () => {
    const r = normalizeDocReading({ kind: 'paystub', confidence: 'high', fields: [
      { key: 'employer_name', value: 'EXCEL INC', quote: 'EXCEL INC' },
      { key: 'ytd_gross', value: '$41,250.00', quote: 'YTD 41,250.00' },
      { key: 'pay_date', value: '2026-11-01', quote: '11/01/2026' },
      { key: 'made_up', value: 'x', quote: 'x' },
    ] })
    expect(r).toEqual({ kind: 'paystub', confidence: 'high', fields: { employer_name: { value: 'EXCEL INC', quote: 'EXCEL INC' }, ytd_gross: { value: 41250, quote: 'YTD 41,250.00' }, pay_date: { value: '2026-11-01', quote: '11/01/2026' } } })
  })
  it('never keeps a Social Security number; accounts are last 4 only', () => {
    const r = normalizeDocReading({ kind: 'bank_statement', confidence: 'high', fields: [
      { key: 'employee_name', value: 'Pat 123-45-6789', quote: 'x' },
      { key: 'account_last4', value: '000123456789', quote: 'Acct 000123456789' },
    ] }) as DocumentReading
    expect(r.fields.employee_name).toBeUndefined()
    expect(r.fields.account_last4).toEqual({ value: '6789', quote: '••6789' })
  })
  it('an unknown kind or a bad date is refused or dropped', () => {
    expect(normalizeDocReading({ kind: 'passport', confidence: 'high', fields: [] })).toEqual({ error: 'The reading named a document type MPS HQ does not know.' })
    expect((normalizeDocReading({ kind: 'w2', confidence: 'high', fields: [{ key: 'tax_year', value: '25', quote: '25' }] }) as DocumentReading).fields).toEqual({})
  })
})

describe('employer matching', () => {
  it('ignores Inc, LLC, "The" and punctuation; one name inside the other matches', () => {
    expect(employerKey('The Home Depot, Inc.')).toBe('home depot')
    expect(matchJob('HOME DEPOT USA INC', [excel, hd])?.id).toBe('hd')
    expect(matchJob('Excel', [excel, hd])?.id).toBe('excel')
    expect(matchJob('Walmart', [excel, hd])).toBeNull()
  })
})

describe('flags', () => {
  const read = (over: Partial<DocumentReading>): DocumentReading => ({ kind: 'paystub', confidence: 'high', fields: {}, ...over })
  it('an employer not on the 1003 is offered as a new job', () => {
    const f = documentFlags(read({ fields: { employer_name: { value: 'Walmart', quote: 'WALMART' }, pay_date: { value: '2026-11-01', quote: '' } } }), 'paystub', [excel], today)
    expect(f).toEqual([{ code: 'employer_not_on_1003', text: 'Employer "Walmart" isn\'t on the 1003', employer: 'Walmart' }])
  })
  it("Connor's example: a W-2 showing Excel earnings before the stated June 2025 start", () => {
    const f = documentFlags(read({ kind: 'w2', fields: { employer_name: { value: 'Excel Inc', quote: '' }, tax_year: { value: 2024, quote: '2024' } } }), 'w2', [excel], today)
    expect(f.map((x) => x.text)).toEqual(['The W-2 shows Excel earnings in 2024, but the 1003 start date is Jun 2025'])
  })
  it('a pay stub over 30 days old', () => {
    expect(documentFlags(read({ fields: { employer_name: { value: 'Excel', quote: '' }, pay_date: { value: '2026-09-15', quote: '' } } }), 'paystub', [excel], today).map((x) => x.code)).toEqual(['old_paystub'])
  })
  it('a type that differs from what it was uploaded as; "other" never flags', () => {
    expect(documentFlags(read({ kind: 'bank_statement' }), 'paystub', [], today).map((x) => x.code)).toEqual(['type_mismatch'])
    expect(documentFlags(read({ kind: 'bank_statement' }), 'other', [], today)).toEqual([])
  })
  it('an expired ID; a low-confidence reading', () => {
    expect(documentFlags(read({ kind: 'photo_id', fields: { id_expiration: { value: '2026-01-31', quote: '' } } }), 'photo_id', [], today).map((x) => x.text)).toEqual(['The ID expired Jan 31, 2026'])
    expect(documentFlags(read({ confidence: 'low' }), 'other', [], today).map((x) => x.code)).toEqual(['low_confidence'])
  })
  it('Ready only when sure and nothing flagged', () => {
    expect(statusFor(read({}), [])).toBe('ready')
    expect(statusFor(read({ confidence: 'medium' }), [])).toBe('needs_review')
  })
})

describe('statement months', () => {
  it('finds a missing month between statements', () => {
    expect(statementGaps([{ start: '2026-09-01', end: '2026-09-30' }, { start: '2026-07-01', end: '2026-07-31' }])).toEqual([{ from: '2026-07-31', to: '2026-09-01' }])
    expect(statementGaps([{ start: '2026-08-01', end: '2026-08-31' }, { start: '2026-09-01', end: '2026-09-30' }])).toEqual([])
  })
})

describe('income fields (Stage 4)', () => {
  it('pay frequency, ownership and the return form are checked against their lists', () => {
    const r = normalizeDocReading({ kind: 'paystub', confidence: 'high', fields: [
      { key: 'pay_frequency', value: 'Bi-Weekly', quote: 'BIWEEKLY' },
      { key: 'k1_ownership_pct', value: '50%', quote: '50.000000%' },
      { key: 'return_form', value: '1120s', quote: 'Form 1120-S' },
      { key: 'base_pay_current', value: '2,307.69', quote: 'Regular 2,307.69' },
    ] }) as DocumentReading
    expect(r.fields.pay_frequency?.value).toBe('biweekly')
    expect(r.fields.k1_ownership_pct?.value).toBe(50)
    expect(r.fields.return_form?.value).toBe('1120S')
    expect(r.fields.base_pay_current?.value).toBe(2307.69)
  })
  it('keeps up to 10 large deposits; long numbers in a description keep only their last 4', () => {
    const r = normalizeDocReading({ kind: 'bank_statement', confidence: 'high', fields: [], deposits: [
      { date: '2026-09-03', amount: '$12,500.00', description: 'MOBILE DEPOSIT REF 99887766554' },
      { date: 'yesterday', amount: '5', description: 'x' },
    ] }) as DocumentReading
    expect(r.deposits).toEqual([{ date: '2026-09-03', amount: 12500, description: 'MOBILE DEPOSIT REF ••6554' }])
  })
})
