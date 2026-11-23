import { describe, expect, it } from 'vitest'
import type { CdField } from '../../../supabase/functions/assistant/closingDisclosure'
import { changesFor, checkQuotes, isUsed, lenderKey, reviewRows, undecided, type CdFileNow } from './cdReview'

const f = (key: CdField['key'], value: number | string, extra: Partial<CdField> = {}): CdField => ({ key, value, text: String(value), quote: `${key} ${value}`, page: 1, confidence: 'high', ...extra })
const LENDER = { id: 'l1', name: 'UWM' }
const file = (over: Partial<CdFileNow> = {}): CdFileNow => ({
  values: { 'loans.loan_amount': 315000, 'loans.note_rate': 6.375, 'loans.closing_date': '2026-12-01', 'properties.annual_taxes': 6000 },
  hasHome: true,
  lenderName: null,
  lenderFromProgram: false,
  lenders: [LENDER, { id: 'l2', name: 'Rocket Mortgage, LLC' }],
  revenue: 6300,
  ...over,
})
const found = (fields: CdField[]) => Object.fromEntries(fields.map((x) => [x.key, 'found' as const]))
const rowsOf = (fields: CdField[], over: Partial<CdFileNow> = {}) => reviewRows(fields, file(over), found(fields))
const row = (fields: CdField[], key: CdField['key'], over: Partial<CdFileNow> = {}) => rowsOf(fields, over).find((r) => r.key === key)!

describe('reviewRows', () => {
  it('fills an empty place, ticked', () => {
    const r = row([f('disbursement_date', '2026-12-02')], 'disbursement_date')
    expect(r).toMatchObject({ state: 'fill', next: '2026-12-02', fileText: '—', defaultUse: true, target: 'loans.funding_date' })
  })
  it('a different value waits for Replace or Keep', () => {
    const r = row([f('loan_amount', 320000)], 'loan_amount')
    expect(r).toMatchObject({ state: 'replace', next: 320000, fileText: '$315,000', cdText: '$320,000', defaultUse: false })
  })
  it('the same value matches (320000 = 320000.00)', () => {
    expect(row([f('interest_rate', 6.375)], 'interest_rate').state).toBe('same')
  })
  it('cash to close, closing costs and broker comp are checks only', () => {
    const rows = rowsOf([f('cash_to_close', 25000), f('total_closing_costs', 9000), f('broker_compensation', 6400)])
    expect(rows.map((r) => r.state)).toEqual(['check', 'check', 'check'])
  })
  it('broker comp different from the revenue says so', () => {
    expect(row([f('broker_compensation', 6400)], 'broker_compensation').note).toContain('$6,300')
    expect(row([f('broker_compensation', 6300)], 'broker_compensation').note).toBeNull()
    expect(row([f('broker_compensation', 6400)], 'broker_compensation', { revenue: null }).note).toBeNull()
  })
  it('the home keeps 12 times the monthly escrow', () => {
    const r = row([f('tax_monthly', 612.5)], 'tax_monthly')
    expect(r).toMatchObject({ state: 'replace', next: 7350, fileText: '$6,000 a year' })
    expect(r.note).toContain('$612.50 a month × 12 = $7,350 a year')
  })
  it('taxes and insurance need a subject home', () => {
    expect(row([f('insurance_monthly', 150)], 'insurance_monthly', { hasHome: false })).toMatchObject({ state: 'cannot', next: null })
  })
  it('the loan term shows in years and saves months', () => {
    expect(row([f('loan_term', 180)], 'loan_term')).toMatchObject({ state: 'fill', cdText: '15 years', next: 180 })
  })
  it('matches the lender by name, ignoring LLC and punctuation', () => {
    expect(row([f('lender_name', 'Rocket Mortgage LLC')], 'lender_name')).toMatchObject({ state: 'fill', next: 'l2' })
    expect(row([f('lender_name', 'UWM')], 'lender_name', { lenderName: 'UWM', values: { 'loans.lender_id': 'l1' } }).state).toBe('same')
    expect(row([f('lender_name', 'UWM')], 'lender_name', { lenderName: 'Rocket Mortgage, LLC', values: { 'loans.lender_id': 'l2' } })).toMatchObject({ state: 'replace', next: 'l1' })
  })
  it("a lender that isn't in the list, or set by the program, can't change here", () => {
    expect(row([f('lender_name', 'Some Bank')], 'lender_name').state).toBe('cannot')
    expect(row([f('lender_name', 'UWM')], 'lender_name', { lenderName: 'Rocket Mortgage, LLC', lenderFromProgram: true })).toMatchObject({ state: 'cannot', note: expect.stringContaining('program') })
  })
  it("words not found in the PDF, or low confidence, aren't ticked", () => {
    const fields = [f('disbursement_date', '2026-12-02'), f('first_payment_date', '2027-02-01', { confidence: 'low' })]
    const rows = reviewRows(fields, file(), { disbursement_date: 'missing', first_payment_date: 'found' })
    expect(rows.map((r) => r.defaultUse)).toEqual([false, false])
    expect(rows[0].note).toContain("weren't found in the PDF")
  })
  it('a funded date before closing is flagged and not ticked', () => {
    const r = row([f('disbursement_date', '2026-11-30')], 'disbursement_date')
    expect(r.defaultUse).toBe(false)
    expect(r.note).toContain('before the closing date')
  })
  it('keeps the field list order', () => {
    expect(rowsOf([f('lender_loan_number', '123'), f('loan_amount', 320000)]).map((r) => r.key)).toEqual(['loan_amount', 'lender_loan_number'])
  })
})

describe('changesFor', () => {
  const fields = [f('loan_amount', 320000), f('disbursement_date', '2026-12-02'), f('interest_rate', 6.375), f('cash_to_close', 25000), f('tax_monthly', 612.5)]
  it('sends ticked fills and differences Connor chose to replace', () => {
    const rows = rowsOf(fields)
    expect(changesFor(rows, {})).toEqual([{ key: 'disbursement_date', label: 'Disbursement (funded) date', target: 'loans.funding_date', after: '2026-12-02' }])
    expect(changesFor(rows, { loan_amount: 'use', tax_monthly: 'use' }).map((c) => [c.target, c.after])).toEqual([
      ['loans.funding_date', '2026-12-02'],
      ['loans.loan_amount', 320000],
      ['properties.annual_taxes', 7350],
    ])
  })
  it('an unticked fill and kept differences send nothing', () => {
    expect(changesFor(rowsOf(fields), { disbursement_date: 'keep', loan_amount: 'keep' })).toEqual([])
  })
  it('lists differences still waiting for a choice', () => {
    const rows = rowsOf(fields)
    expect(undecided(rows, {}).map((r) => r.key)).toEqual(['loan_amount', 'tax_monthly'])
    expect(undecided(rows, { loan_amount: 'keep' }).map((r) => r.key)).toEqual(['tax_monthly'])
    expect(isUsed(rows[0], { loan_amount: 'use' })).toBe(true)
  })
})

describe('checkQuotes', () => {
  const pages = [['Closing Disclosure', 'Loan Amount $320,000'], ['Lender Credits -$1,250.00']]
  it('finds the words on their page or another one', () => {
    const fields = [f('loan_amount', 320000, { quote: 'Loan Amount $320,000' }), f('lender_credits', 1250, { quote: 'Lender Credits -$1,250.00', page: 1 })]
    expect(checkQuotes(pages, fields)).toEqual({ loan_amount: 'found', lender_credits: 'found' })
  })
  it("says missing when the words aren't there", () => {
    expect(checkQuotes(pages, [f('loan_amount', 330000, { quote: 'Loan Amount $330,000' })])).toEqual({ loan_amount: 'missing' })
  })
  it('a scanned PDF (no text) is unchecked', () => {
    expect(checkQuotes([[], []], [f('loan_amount', 320000)])).toEqual({ loan_amount: 'unchecked' })
    expect(checkQuotes(null, [f('loan_amount', 320000)])).toEqual({ loan_amount: 'unchecked' })
  })
})

describe('lenderKey', () => {
  it('drops punctuation and company endings', () => {
    expect(lenderKey('Rocket Mortgage, LLC')).toBe('rocket mortgage')
    expect(lenderKey('The Loan Store, Inc.')).toBe('loan store')
  })
})

describe('the CD fills in the home (Connor, 2026-11-23)', () => {
  const ADDRESS = '1420 Oak Ridge Dr, Frisco, TX 75034'
  it('with no home on the file, the address makes one and taxes and insurance go on it', () => {
    const fields = [f('property_address', ADDRESS), f('tax_monthly', 500), f('insurance_monthly', 300)]
    const rows = rowsOf(fields, { hasHome: false, values: {} })
    expect(rows.find((r) => r.key === 'property_address')).toMatchObject({ state: 'fill', next: ADDRESS, defaultUse: true })
    expect(rows.find((r) => r.key === 'tax_monthly')).toMatchObject({ state: 'fill', next: 6000 })
    const changes = changesFor(rows, {}, false)
    expect(changes.find((c) => c.key === 'property_address')?.after).toEqual({ line: '1420 Oak Ridge Dr', city: 'Frisco', state: 'TX', zip: '75034' })
    expect(changes.map((c) => c.target)).toEqual(['properties.address', 'properties.annual_taxes', 'properties.annual_insurance'])
  })
  it('without the address, taxes and insurance stay off a file with no home', () => {
    const rows = rowsOf([f('property_address', ADDRESS), f('tax_monthly', 500)], { hasHome: false, values: {} })
    expect(changesFor(rows, { property_address: 'keep' }, false)).toEqual([])
    expect(row([f('tax_monthly', 500)], 'tax_monthly', { hasHome: false, values: {} }).state).toBe('cannot')
  })
  it("never renames the file's home", () => {
    expect(row([f('property_address', ADDRESS)], 'property_address', { values: { 'properties.address': '1420 Oak Ridge Dr, Frisco, TX 75034' } }).state).toBe('same')
    const r = row([f('property_address', ADDRESS)], 'property_address', { values: { 'properties.address': '88 Willow Bend Ct, McKinney, TX 75071' } })
    expect(r.state).toBe('check')
    expect(r.note).toContain("isn't changed here")
  })
  it('the appraised value fills the loan', () => {
    expect(row([f('appraised_value', 410000)], 'appraised_value', { values: {} })).toMatchObject({ state: 'fill', target: 'loans.appraised_value', next: 410000 })
  })
})
