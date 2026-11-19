import { describe, expect, it } from 'vitest'
import {
  ASSET_OPTIONS,
  CITIZENSHIP_OPTIONS,
  DECLARATION_QUESTIONS_5A,
  DECLARATION_QUESTIONS_5B,
  HOUSING_OPTIONS,
  LIABILITY_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  OTHER_INCOME_OPTIONS,
} from '../../../src/lib/urla/options'
import { PERIODS_PER_YEAR } from '../../../src/lib/calc/income/wages'
import type { Address, Declarations, Employment, PersonDetails } from '../../../src/lib/api/urla'
import type { IncomeDocType, LoanDetails, MortgageType, Occupancy } from '../../../src/lib/api/types'
import { URLA_SECTIONS } from '../../../src/lib/loanfile/urla'
import {
  ASSET_TYPES,
  CITIZENSHIP,
  DEBT_TYPES,
  DECLARATION_KEYS,
  DOC_TYPES,
  FILL_FIELDS,
  FILL_PATHS,
  FILL_SCHEMA,
  FILL_SECTIONS,
  HOUSING,
  INCOME_TYPES,
  MARITAL,
  MORTGAGE_TYPES,
  OCCUPANCY,
  PAY_FREQUENCY,
  buildFillPrompt,
  parseValue,
  quoteInNotes,
  readFill,
} from './summaryFill'

/** Union-typed spots in a schema (Claude allows at most 16). */
function unions(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n, x) => n + unions(x), 0)
  if (!node || typeof node !== 'object') return 0
  const o = node as Record<string, unknown>
  return (Array.isArray(o.anyOf) || Array.isArray(o.type) ? 1 : 0) + Object.values(o).reduce((n: number, v) => n + unions(v), 0)
}

describe('AI Summary Fill: the field list is the real 1003', () => {
  it('uses the app option lists', () => {
    const sorted = (xs: readonly string[]) => [...xs].sort()
    expect(sorted(MARITAL)).toEqual(sorted(MARITAL_STATUS_OPTIONS.map((o) => o.value)))
    expect(sorted(CITIZENSHIP)).toEqual(sorted(CITIZENSHIP_OPTIONS.map((o) => o.value)))
    expect(sorted(HOUSING)).toEqual(sorted(HOUSING_OPTIONS.map((o) => o.value)))
    expect([...INCOME_TYPES]).toEqual(OTHER_INCOME_OPTIONS.map((o) => o.value))
    expect([...ASSET_TYPES]).toEqual(ASSET_OPTIONS.map((o) => o.value))
    expect([...DEBT_TYPES]).toEqual(LIABILITY_OPTIONS.map((o) => o.value))
    expect(sorted(PAY_FREQUENCY)).toEqual(sorted([...Object.keys(PERIODS_PER_YEAR), 'hourly']))
    expect(sorted(DECLARATION_KEYS)).toEqual(sorted([...DECLARATION_QUESTIONS_5A, ...DECLARATION_QUESTIONS_5B].map((q) => q.key)))
  })

  it('matches the 1003 type names (the compiler checks these)', () => {
    const person: (keyof PersonDetails)[] = ['maritalStatus', 'dependentsCount', 'dependentsAges', 'dateOfBirth', 'citizenship', 'email', 'phone', 'militaryService']
    const address: (keyof Address)[] = ['addressLine', 'city', 'state', 'zip', 'housing', 'monthlyRent', 'monthsAtAddress']
    const job: (keyof Employment)[] = ['employerName', 'positionTitle', 'status', 'isSelfEmployed', 'ownership25OrMore', 'startDate']
    const loan: (keyof LoanDetails)[] = ['mortgageType', 'occupancy', 'purchasePrice', 'loanAmount', 'cashOutAmount', 'incomeDocType', 'timeline']
    const declarations: (keyof Declarations)[] = [...DECLARATION_KEYS]
    for (const k of person) expect(FILL_FIELDS[`person.${k}`]).toBeDefined()
    for (const k of address) expect(FILL_FIELDS[`address.${k}`]).toBeDefined()
    for (const k of job) expect(FILL_FIELDS[`job.${k}`]).toBeDefined()
    for (const k of loan) expect(FILL_FIELDS[`loan.${k}`]).toBeDefined()
    for (const k of declarations) expect(FILL_FIELDS[`declarations.${k}`]?.type).toBe('bool')
    const mt: MortgageType[] = [...MORTGAGE_TYPES]
    const occ: Occupancy[] = [...OCCUPANCY]
    const docs: IncomeDocType[] = [...DOC_TYPES]
    expect(mt.length + occ.length + docs.length).toBe(13)
  })

  it('every section is a real 1003 section', () => {
    const real = URLA_SECTIONS.map((s) => s.id as string)
    for (const s of FILL_SECTIONS) expect(real).toContain(s)
    for (const p of FILL_PATHS) expect(FILL_SECTIONS).toContain(FILL_FIELDS[p].section)
  })

  it('the answer form is within Claude limits and lists every field', () => {
    expect(unions(FILL_SCHEMA)).toBeLessThanOrEqual(16)
    expect(FILL_SCHEMA.properties.facts.items.properties.field_path.enum).toEqual(FILL_PATHS)
    expect(buildFillPrompt('x', [{ firstName: 'Maria', role: 'primary' }], {})).toContain('job.payRate (money)')
  })
})

describe('AI Summary Fill: reading values', () => {
  it('reads money, percent, dates, yes/no and options', () => {
    expect(parseValue(FILL_FIELDS['loan.purchasePrice'], '$250,000')).toBe(250000)
    expect(parseValue(FILL_FIELDS['loan.purchasePrice'], '250k')).toBe(250000)
    expect(parseValue(FILL_FIELDS['job.payRate'], '14.80')).toBe(14.8)
    expect(parseValue(FILL_FIELDS['loan.downPaymentPct'], '3.5%')).toBe(3.5)
    expect(parseValue(FILL_FIELDS['loan.downPaymentPct'], '350')).toBeNull()
    expect(parseValue(FILL_FIELDS['person.dateOfBirth'], '1990-02-30')).toBeNull()
    expect(parseValue(FILL_FIELDS['person.dateOfBirth'], '1990-02-28')).toBe('1990-02-28')
    expect(parseValue(FILL_FIELDS['declarations.bankruptcyPast7Years'], 'no')).toBe(false)
    expect(parseValue(FILL_FIELDS['person.maritalStatus'], 'divorced')).toBeNull()
    expect(parseValue(FILL_FIELDS['person.maritalStatus'], 'married')).toBe('married')
    expect(parseValue(FILL_FIELDS['asset.amount'], 'about six thousand')).toBeNull()
  })

  it('finds quotes ignoring case, spacing and curly quotes', () => {
    expect(quoteInNotes('car payment  $480', 'Her Car payment $480, balance $12,000.')).toBe(true)
    expect(quoteInNotes('wife’s job', "Her wife's job is new")).toBe(true)
    expect(quoteInNotes('boat loan', 'Car payment $480')).toBe(false)
    expect(quoteInNotes('', 'anything')).toBe(false)
  })
})

describe('AI Summary Fill: checking the reply', () => {
  const notes = `Maria Lopez, married with 2 kids (4 and 7). Works for Excel Mobile for two years making $14.80 an hour, 40 hours a week.
Has about $6,500 in checking at Chase. Car payment $480, balance $12,000. Renting now at $1,350 a month.
Looking around $250k in Fort Worth, wants FHA with 3.5% down. Husband Jose works at Lowe's. Heard about us from Facebook. Also owes $300 to someone.`
  const borrowers = [
    { contactId: 'p1', firstName: 'Maria', role: 'primary' as const },
    { contactId: 'c1', firstName: 'Ana', role: 'co_borrower' as const },
  ]
  const fact = (field_path: string, value: string, source_text: string, extra: Record<string, string> = {}) => ({ field_path, value, source_text, record: '', borrower: '', display_label: '', confidence: 'high', ...extra })

  const reply = {
    facts: [
      fact('person.maritalStatus', 'married', 'married with 2 kids'),
      fact('person.dependentsCount', '2', 'married with 2 kids (4 and 7)'),
      fact('job.employerName', 'Excel Mobile', 'Works for Excel Mobile', { record: 'job1' }),
      fact('job.payRate', '14.80', 'making $14.80 an hour', { record: 'job1' }),
      fact('job.payFrequency', 'hourly', 'making $14.80 an hour', { record: 'job1' }),
      fact('job.hoursPerWeek', '40', '40 hours a week', { record: 'job1' }),
      fact('job.yearsOnJob', '2', 'for two years', { record: 'job1' }),
      fact('liability.description', 'Auto loan', 'Car payment $480', { record: 'debt1' }),
      fact('liability.monthlyPayment', '480', 'Car payment $480', { record: 'debt1' }),
      fact('liability.unpaidBalance', '12000', 'balance $12,000', { record: 'debt1' }),
      fact('loan.mortgageType', 'fha', 'wants FHA'),
      fact('loan.downPaymentPct', '3.5', '3.5% down'),
      fact('loan.purchasePrice', '250000', 'around $250k', { borrower: 'Maria' }),
      // Left out: made-up quote, wrong option, unknown field, duplicate, existing row that isn't there.
      fact('asset.amount', '9000', 'has $9,000 in savings', { record: 'acct1' }),
      fact('person.citizenship', 'citizen', 'Maria Lopez'),
      fact('person.ssn', '123', 'Maria Lopez'),
      fact('person.maritalStatus', 'married', 'married with 2 kids'),
      fact('asset.amount', '6500', '$6,500 in checking', { record: 'existing:nope' }),
      // Jose isn't on the file: becomes a question.
      fact('job.employerName', "Lowe's", "Husband Jose works at Lowe's", { record: 'job2', borrower: 'Jose' }),
    ],
    unmapped: [{ source_text: 'Heard about us from Facebook', summary: 'Heard about MPS from Facebook.' }],
    ambiguous: [
      {
        source_text: 'owes $300 to someone',
        question: '$300: monthly payment or balance?',
        record: 'debt2',
        borrower: '',
        choices: [
          { label: 'Payment', field_path: 'liability.monthlyPayment', value: '300' },
          { label: 'Balance', field_path: 'liability.unpaidBalance', value: '300' },
          { label: 'Bad', field_path: 'liability.nope', value: '300' },
        ],
      },
      { source_text: 'never said', question: 'Made up?', record: '', borrower: '', choices: [] },
    ],
  }

  const r = readFill(reply, notes, borrowers, ['row-1'])
  if ('error' in r) throw new Error(r.error)

  it('keeps facts with real quotes, fields and values', () => {
    expect(r.facts.map((f) => f.fieldPath)).toEqual([
      'person.maritalStatus',
      'person.dependentsCount',
      'job.employerName',
      'job.payRate',
      'job.payFrequency',
      'job.hoursPerWeek',
      'job.yearsOnJob',
      'liability.description',
      'liability.monthlyPayment',
      'liability.unpaidBalance',
      'loan.mortgageType',
      'loan.downPaymentPct',
      'loan.purchasePrice',
    ])
    expect(r.facts.find((f) => f.fieldPath === 'job.payRate')).toMatchObject({ value: 14.8, record: 'job1', section: 'income', contactId: 'p1' })
    expect(r.facts.find((f) => f.fieldPath === 'liability.unpaidBalance')).toMatchObject({ value: 12000, section: 'liabilities' })
    // Loan facts belong to the file: the primary borrower stands in.
    expect(r.facts.find((f) => f.fieldPath === 'loan.purchasePrice')?.contactId).toBe('p1')
    expect(r.facts[0].displayLabel).toBe('Marital status: married')
  })

  it('says what it left out and why', () => {
    expect(r.dropped.map((d) => d.why)).toEqual(['quote not in the notes', 'value does not fit', 'unknown field', 'same field twice', 'existing row not found', 'Jose is not on this file'])
  })

  it("turns unclear numbers and people who aren't on the file into questions", () => {
    expect(r.ambiguous.map((q) => q.question)).toEqual([
      "The notes mention Jose, who isn't on this file. Add them as a co-borrower first, then run it again.",
      '$300: monthly payment or balance?',
    ])
    expect(r.ambiguous[1].choices).toEqual([
      { label: 'Payment', fieldPath: 'liability.monthlyPayment', value: 300 },
      { label: 'Balance', fieldPath: 'liability.unpaidBalance', value: 300 },
    ])
    expect(r.unmapped).toEqual([{ sourceText: 'Heard about us from Facebook', summary: 'Heard about MPS from Facebook.' }])
  })

  it('matches a co-borrower by first name', () => {
    const r2 = readFill({ facts: [fact('person.maritalStatus', 'married', 'married with 2 kids', { borrower: 'ana' })], unmapped: [], ambiguous: [] }, notes, borrowers, [])
    if ('error' in r2) throw new Error(r2.error)
    expect(r2.facts[0].contactId).toBe('c1')
  })

  it('refuses a broken reply and anything that looks like an SSN', () => {
    expect(readFill(null, notes, borrowers, [])).toEqual({ error: 'unreadable' })
    expect(readFill({ facts: [] }, notes, borrowers, [])).toEqual({ error: 'missing lists' })
    const ssn = readFill({ facts: [fact('person.email', '123-45-6789', 'Maria Lopez')], unmapped: [], ambiguous: [] }, notes, borrowers, [])
    if ('error' in ssn) throw new Error(ssn.error)
    expect(ssn.facts).toEqual([])
  })
})
