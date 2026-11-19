import { describe, expect, it } from 'vitest'
import { emptyDeclarations, type Application } from '@/lib/api/urla'
import type { AppliedChange } from '@/lib/api/aifill'
import { activeAiKeys, askKeys, issueKey, newRowKey, rowPrefixes, runsWithKey, type FillRun } from './badges'

describe('Still need to ask', () => {
  const issues = [
    { section: 'borrower' as const, field: 'Date of birth', fix: { kind: 'person' as const, contactId: 'p1', field: 'dateOfBirth' as const } },
    { section: 'declarations' as const, field: 'Bankruptcy (7 years)', fix: { kind: 'declaration' as const, contactId: 'p1', field: 'bankruptcyPast7Years' as const } },
    { section: 'borrower' as const, field: 'Current address' },
  ]
  const run = { id: 'r1', applied: [], confirmed: [], undone: false }

  it('uses the same keys as the form fields', () => {
    expect(issueKey(issues[0].fix)).toBe('person:p1:dateOfBirth')
    expect(issueKey({ kind: 'loan', field: 'purchasePrice' })).toBe('loan:purchasePrice')
    expect(issueKey({ kind: 'job', employmentId: 'j1', field: 'startDate' })).toBe('row:employments:j1:startDate')
    expect(issueKey(undefined)).toBeNull()
  })

  it('shows only after an AI fill that was not undone', () => {
    expect([...askKeys(issues, [run])]).toEqual(['person:p1:dateOfBirth', 'declaration:p1:bankruptcyPast7Years'])
    expect(askKeys(issues, []).size).toBe(0)
    expect(askKeys(issues, [{ ...run, undone: true }]).size).toBe(0)
  })
})

const app = (marital: string | null, rows: string[] = ['j1']): Application => ({
  borrowers: [
    {
      contactId: 'p1',
      role: 'primary',
      estimatedCreditScore: 640,
      person: { maritalStatus: marital } as never,
      addresses: [],
      employments: rows.map((id) => ({ id, contactId: 'p1' }) as never),
      otherIncomes: [],
      declarations: emptyDeclarations,
    },
  ],
  assets: [],
  liabilities: [],
})

const field = (key: string, target: AppliedChange & { kind: 'field' } extends infer T ? T extends { target: infer U } ? U : never : never, after: unknown): AppliedChange => ({
  kind: 'field', key, target, before: null, after, section: 'borrower', display: '', label: '',
})
const marital = field('person:p1:maritalStatus', { kind: 'person', contactId: 'p1', field: 'maritalStatus' }, 'married')
const score = field('credit:p1', { kind: 'credit', contactId: 'p1' }, '640')
const price = field('loan:purchasePrice', { kind: 'loan', field: 'purchasePrice' }, 250000)
const job: AppliedChange = { kind: 'new_row', key: 'new:employments:p1:job1', table: 'employments', rowId: 'j1', section: 'income', display: '', fieldCount: 4 }
const run = (extra: Partial<FillRun> = {}): FillRun => ({ id: 'r1', applied: [marital, score, price, job], confirmed: [], undone: false, ...extra })

describe('AI tags on the 1003', () => {
  it('tags fields still holding the AI value, and rows AI Fill added', () => {
    expect([...activeAiKeys([run()], app('married'), { purchasePrice: 250000 })].sort()).toEqual(['credit:p1', 'loan:purchasePrice', 'newrow:employments:j1', 'person:p1:maritalStatus'])
  })

  it('drops the tag once the value is edited or the row is deleted', () => {
    const keys = activeAiKeys([run()], app('separated', []), { purchasePrice: 260000 })
    expect([...keys]).toEqual(['credit:p1'])
  })

  it('drops confirmed tags and everything from an undone run', () => {
    expect([...activeAiKeys([run({ confirmed: ['person:p1:maritalStatus', 'newrow:employments:j1'] })], app('married'), { purchasePrice: 250000 })].sort()).toEqual(['credit:p1', 'loan:purchasePrice'])
    expect(activeAiKeys([run({ undone: true })], app('married'), { purchasePrice: 250000 }).size).toBe(0)
  })

  it('a later run confirming or changing a field wins', () => {
    const later: FillRun = { id: 'r2', applied: [field('loan:purchasePrice', { kind: 'loan', field: 'purchasePrice' }, 275000)], confirmed: [], undone: false }
    expect(activeAiKeys([run(), later], app('married'), { purchasePrice: 275000 }).has('loan:purchasePrice')).toBe(true)
    expect(activeAiKeys([run(), { ...later, confirmed: ['loan:purchasePrice'] }], app('married'), { purchasePrice: 275000 }).has('loan:purchasePrice')).toBe(false)
  })

  it('finds the runs that hold a key, and a row’s keys', () => {
    expect(runsWithKey([run(), run({ id: 'r2', applied: [] })], 'loan:purchasePrice')).toEqual(['r1'])
    expect(runsWithKey([run()], newRowKey('employments', 'j1'))).toEqual(['r1'])
    expect(rowPrefixes('employments', 'j1')).toEqual(['row:employments:j1:', 'newrow:employments:j1'])
    expect(rowPrefixes('contact_addresses', 'a1')).toEqual(['address:a1:'])
  })
})
