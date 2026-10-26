import { describe, expect, it } from 'vitest'
import { DEFAULT_DOCUMENT_RULES, documentChecklist, type ChecklistInput, type DocRule } from './nextStep'

const input: ChecklistInput = {
  people: [{ firstName: 'Jane', jobs: [{ employerName: 'A', selfEmployed: false }], otherIncomes: ['social_security'], assetTypes: ['checking'], creditEvents: [] }],
  incomeDocType: null,
  homes: [{ addressLine: '1 Elm', rented: false }],
}
const keys = (rules: DocRule[]) => documentChecklist(input, rules).flatMap((g) => g.items.map((i) => i.key))

describe('checklist rules', () => {
  it('skips turned-off rules', () => {
    expect(keys(DEFAULT_DOCUMENT_RULES)).toEqual(['id', 'paystubs', 'w2s', 'award_social_security', 'bank_statements', 'home_statements'])
    expect(keys(DEFAULT_DOCUMENT_RULES.map((r) => (r.key === 'w2s' ? { ...r, active: false } : r)))).not.toContain('w2s')
  })
  it('uses reworded rules and custom ones, in order', () => {
    const rules: DocRule[] = [
      ...DEFAULT_DOCUMENT_RULES.map((r) => (r.key === 'paystubs' ? { ...r, fullText: 'Your two most recent pay stubs' } : r)),
      { key: 'voe', condition: 'wage_earner', shortText: 'a VOE', fullText: 'A written verification of employment', kind: 'other', sortOrder: 75, active: true },
    ]
    const items = documentChecklist(input, rules)[0].items
    expect(items.map((i) => i.key)).toEqual(['id', 'paystubs', 'w2s', 'voe', 'award_social_security', 'bank_statements'])
    expect(items[1].full).toBe('Your two most recent pay stubs')
    expect(items.find((i) => i.key === 'award_social_security')).toMatchObject({ full: 'Your Social Security award letter', kind: 'award_letter' })
  })
  it('every item carries the document type that satisfies it', () => {
    expect(documentChecklist(input)[0].items.map((i) => i.kind)).toEqual(['photo_id', 'paystub', 'w2', 'award_letter', 'bank_statement'])
  })
  it('matches the starter list the database seeds, word for word', () => {
    const scripts = import.meta.glob<string>('/supabase/migrations/*document_rules.sql', { query: '?raw', import: 'default', eager: true })
    const sql = Object.values(scripts)[0]
    const seeded = [...sql.matchAll(/\(org, '([a-z0-9_]+)',\s*'([a-z_0-9]+)',\s*'((?:[^']|'')*)', '((?:[^']|'')*)', '([a-z_0-9]+)', (\d+), true\)/g)].map((m) => ({
      key: m[1],
      condition: m[2],
      shortText: m[3].replace(/''/g, "'"),
      fullText: m[4].replace(/''/g, "'"),
      kind: m[5],
      sortOrder: Number(m[6]),
      active: true,
    }))
    expect(seeded).toEqual(DEFAULT_DOCUMENT_RULES)
  })
})
