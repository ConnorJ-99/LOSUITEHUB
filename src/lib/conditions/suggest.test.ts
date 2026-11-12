import { describe, expect, it } from 'vitest'
import { DEFAULT_DOCUMENT_RULES, documentChecklist } from '@/lib/prequal/nextStep'
import { NO_RULE_FILTERS } from './ruleFilters'
import { STARTER_CONDITION_RULES } from './starterRules'
import { accountName, allSuggestions, suggestConditions, type Existing, type FileFacts, type SuggestPerson } from './suggest'

const RULES = [...DEFAULT_DOCUMENT_RULES, ...STARTER_CONDITION_RULES]
const pat: SuggestPerson = {
  contactId: 'pat',
  firstName: 'Pat',
  jobs: [{ id: 'job1', employerName: 'ABC Company', selfEmployed: false }],
  history: [],
  otherIncomes: [],
  assets: [{ id: 'a1', assetType: 'checking', institutionName: 'Chase', accountLast4: '9981234', amount: 20000, giftSource: null }],
  creditEvents: [],
}
const base: FileFacts = {
  mortgageType: 'conventional',
  purpose: 'purchase',
  occupancy: 'primary',
  propertyType: 'single_family',
  incomeDocType: 'full_doc',
  texasCashOut: false,
  entityVesting: null,
  vaExempt: false,
  lenderId: null,
  programId: null,
  people: [pat],
  homes: [],
  programName: null,
  program: {},
  year: 2026,
  today: '2026-11-12',
}
const none: Existing = { conditions: [], requests: [], dismissed: [] }
const keys = (f: FileFacts) => allSuggestions(f, RULES).map((s) => s.ruleKey)

describe('starter rules fire when they should', () => {
  it('purchase vs refinance', () => {
    expect(keys(base)).toEqual(expect.arrayContaining(['cond_purchase_contract', 'cond_earnest_money', 'cond_hoi_quote']))
    expect(keys(base)).not.toContain('cond_refi_statement')
    const refi = keys({ ...base, purpose: 'refinance_rate_term' })
    expect(refi).toEqual(expect.arrayContaining(['cond_refi_statement', 'cond_refi_dec_page', 'cond_payoff_auth']))
    expect(refi).not.toContain('cond_purchase_contract')
  })
  it('the purchase contract is once per file, on the realtor', () => {
    const s = allSuggestions({ ...base, people: [pat, { ...pat, contactId: 'jo', firstName: 'Jo' }] }, RULES).filter((x) => x.ruleKey === 'cond_purchase_contract')
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ key: 'cond_purchase_contract', party: 'realtor', contactId: null })
  })
  it('VA: COE and DD-214, the exemption letter only when exempt', () => {
    const va = keys({ ...base, mortgageType: 'va' })
    expect(va).toEqual(expect.arrayContaining(['cond_va_coe', 'cond_va_dd214']))
    expect(va).not.toContain('cond_va_exempt_letter')
    expect(keys({ ...base, mortgageType: 'va', vaExempt: true })).toContain('cond_va_exempt_letter')
  })
  it('FHA adds nothing extra', () => {
    const fha = keys({ ...base, mortgageType: 'fha' }).filter((k) => k.startsWith('cond_'))
    expect(fha).toEqual(keys(base).filter((k) => k.startsWith('cond_')))
  })
  it('condo', () => {
    expect(keys({ ...base, propertyType: 'condo' })).toEqual(expect.arrayContaining(['cond_condo_hoa', 'cond_condo_master']))
    expect(keys(base)).not.toContain('cond_condo_hoa')
  })
  it('DSCR with an LLC: leases or rent schedule, and the LLC papers naming the entity', () => {
    const s = allSuggestions({ ...base, purpose: 'investment_dscr', occupancy: 'investment', incomeDocType: 'dscr', entityVesting: 'Sample LLC' }, RULES)
    expect(s.map((x) => x.ruleKey)).toEqual(expect.arrayContaining(['cond_rent_schedule', 'cond_llc_docs']))
    expect(s.find((x) => x.ruleKey === 'cond_llc_docs')!.body).toMatch(/: Sample LLC$/)
    expect(keys(base)).not.toContain('cond_llc_docs')
  })
  it('Texas cash-out: the processor task to confirm the 12-day notice', () => {
    const s = allSuggestions({ ...base, purpose: 'refinance_cash_out', texasCashOut: true }, RULES)
    expect(s.find((x) => x.ruleKey === 'cond_tx_12_day')).toMatchObject({ party: 'processor_lo', stage: 'application' })
    expect(keys({ ...base, purpose: 'refinance_cash_out' })).not.toContain('cond_tx_12_day')
  })
  it('HELOC: first-lien statement', () => {
    expect(keys({ ...base, purpose: 'heloc' })).toContain('cond_first_lien')
  })
})

describe('specific to the file', () => {
  it('one per account, last 4 only', () => {
    const s = allSuggestions(base, RULES).find((x) => x.ruleKey === 'bank_statements')!
    expect(s.body).toBe('The last 2 months of statements for each bank account, all pages: Chase checking ••1234')
    expect(s.body).not.toContain('998')
    expect(s.key).toBe('bank_statements:pat:a1')
    expect(accountName({ assetType: 'savings', institutionName: null, accountLast4: null })).toBe('savings')
  })
  it('one per job, with the tax years', () => {
    const w2 = allSuggestions(base, RULES).find((x) => x.ruleKey === 'w2s')!
    expect(w2.body).toBe('W-2s for the last 2 years (2024, 2025): ABC Company')
    expect(w2.why).toBe('Job on the 1003: ABC Company')
  })
  it('the gift says how much and from whom', () => {
    const gift = { ...pat, assets: [{ id: 'g1', assetType: 'gift_cash', institutionName: null, accountLast4: null, amount: 15000, giftSource: 'relative' }] }
    const s = allSuggestions({ ...base, people: [gift] }, RULES).find((x) => x.ruleKey === 'gift_letter')!
    expect(s.why).toMatch(/^Purchase · |^Gift on the 1003: \$15,000/)
    expect(s.why).toContain('Gift on the 1003: $15,000')
  })
  it("a program's citation overrides the rule's months", () => {
    const bs = { ...base, incomeDocType: 'bank_statement' as const, programName: 'Sample Bank Statement', program: { bankStatementMonths: { value: 12, citation: 'p. 14: "12 months of statements"' } } }
    const s = allSuggestions(bs, RULES).find((x) => x.ruleKey === 'bank_statements_income')!
    expect(s.body).toBe('12 months of business bank statements, all pages')
    expect(s.source).toEqual({ kind: 'lender', label: 'Sample Bank Statement', citation: 'p. 14: "12 months of statements"' })
    const plain = allSuggestions({ ...bs, program: {} }, RULES).find((x) => x.ruleKey === 'bank_statements_income')!
    expect(plain.body).toBe('12 to 24 months of business bank statements, all pages')
    expect(plain.source.kind).toBe('company')
  })
})

describe('never the same item twice', () => {
  it('added and dismissed suggestions do not come back', () => {
    const r = suggestConditions(base, RULES, { ...none, conditions: [{ id: 'c1', sourceKey: 'cond_hoi_quote', status: 'outstanding' }], dismissed: ['cond_earnest_money'] })
    const k = r.suggestions.map((s) => s.ruleKey)
    expect(k).not.toContain('cond_hoi_quote')
    expect(k).not.toContain('cond_earnest_money')
    expect(k).toContain('cond_purchase_contract')
  })
  it('a received document request hides it; a requested one links to it', () => {
    const received = suggestConditions(base, RULES, { ...none, requests: [{ id: 'r1', contactId: 'pat', ruleKey: 'bank_statements', status: 'received' }] })
    expect(received.suggestions.map((s) => s.ruleKey)).not.toContain('bank_statements')
    const asked = suggestConditions(base, RULES, { ...none, requests: [{ id: 'r1', contactId: 'pat', ruleKey: 'bank_statements', status: 'requested' }] })
    expect(asked.suggestions.find((s) => s.ruleKey === 'bank_statements')!.request).toEqual({ id: 'r1', status: 'requested' })
  })
  it('removing a fact flags the condition instead of deleting it', () => {
    const existing = { ...none, conditions: [{ id: 'c1', sourceKey: 'cond_condo_master', status: 'requested' }, { id: 'c2', sourceKey: null, status: 'outstanding' }] }
    expect(suggestConditions({ ...base, propertyType: 'condo' }, RULES, existing).flagged).toEqual([])
    expect(suggestConditions(base, RULES, existing).flagged).toEqual([{ conditionId: 'c1', why: 'No longer matches the file (master insurance policy)' }])
  })
  it('a turned-off rule suggests nothing, and says so on its condition', () => {
    const off = RULES.map((r) => (r.key === 'cond_hoi_quote' ? { ...r, active: false } : r))
    const res = suggestConditions(base, off, { ...none, conditions: [{ id: 'c1', sourceKey: 'cond_hoi_quote', status: 'outstanding' }] })
    expect(res.flagged[0].why).toMatch(/turned off/)
  })
})

describe('the borrower checklist', () => {
  it('leaves out conditions-only rules', () => {
    const groups = documentChecklist({ people: [{ contactId: 'pat', firstName: 'Pat', jobs: [], otherIncomes: [], assetTypes: [], creditEvents: [] }], incomeDocType: null, homes: [] }, RULES)
    expect(groups.flatMap((g) => g.items.map((i) => i.key))).toEqual(['id'])
  })
  it('a filtered checklist rule needs the file facts, and fits them', () => {
    const vaOnly = { ...DEFAULT_DOCUMENT_RULES[0], ...NO_RULE_FILTERS, key: 'va_only', sortOrder: 5, mortgageTypes: ['va' as const] }
    const input = { people: [{ contactId: 'pat', firstName: 'Pat', jobs: [], otherIncomes: [], assetTypes: [], creditEvents: [] }], incomeDocType: null, homes: [] }
    const k = (i: typeof input & { file?: FileFacts }) => documentChecklist(i, [vaOnly]).flatMap((g) => g.items.map((x) => x.key))
    expect(k(input)).toEqual([])
    expect(k({ ...input, file: base })).toEqual([])
    expect(k({ ...input, file: { ...base, mortgageType: 'va' } })).toEqual(['va_only'])
  })
  it('the starter list matches the database script', () => {
    const scripts = import.meta.glob<string>('/supabase/migrations/*suggested_conditions.sql', { query: '?raw', import: 'default', eager: true })
    const sql = Object.values(scripts)[0]
    const seeded = [...sql.matchAll(/\(org, '(cond_[a-z0-9_]+)', 'everyone', '((?:[^']|'')*)', '((?:[^']|'')*)', '([a-z_]+)', (\d+), true, 'conditions', '(\w+)', '(\w+)', '(\w+)'/g)].map((m) => [m[1], m[2].replace(/''/g, "'"), m[3].replace(/''/g, "'"), m[4], Number(m[5]), m[6], m[7], m[8]])
    expect(seeded).toEqual(STARTER_CONDITION_RULES.map((r) => [r.key, r.shortText, r.fullText, r.kind, r.sortOrder, r.scope, r.party, r.stage]))
  })
})

describe('employment dates (Stage 3a)', () => {
  const dated: SuggestPerson = {
    ...pat,
    jobs: [{ id: 'excel', employerName: 'Excel', selfEmployed: false }],
    history: [
      { id: 'excel', employerName: 'Excel', selfEmployed: false, current: true, startDate: '2025-06-15', endDate: null },
      { id: 'hd', employerName: 'Home Depot', selfEmployed: false, current: false, startDate: '2024-06-01', endDate: '2025-04-30' },
    ],
  }
  const f = { ...base, people: [dated] }
  const bodies = (rule: string) => allSuggestions(f, RULES).filter((s) => s.ruleKey === rule).map((s) => s.body)
  it('pay stubs for the current job, a final pay stub for the last one', () => {
    expect(bodies('paystubs')).toEqual(['Pay stubs covering the last 30 days: Excel', 'Final pay stub (if available): Home Depot'])
  })
  it('one W-2 per year worked inside the window', () => {
    expect(bodies('w2s')).toEqual(['W-2 for 2025: Excel', 'W-2 for 2024: Home Depot', 'W-2 for 2025: Home Depot'])
  })
  it('a gap becomes a suggested letter of explanation, keyed so it is never suggested twice', () => {
    const gap = allSuggestions(f, RULES).find((s) => s.ruleKey === 'emp_gap')!
    expect(gap).toMatchObject({ key: 'emp_gap:pat:2025-05-01', body: 'Letter of explanation for the employment gap May 1, 2025 – Jun 14, 2025', party: 'borrower', kind: 'explanation_letter' })
    const added = suggestConditions(f, RULES, { ...none, conditions: [{ id: 'c1', sourceKey: gap.key, status: 'outstanding' }] })
    expect(added.suggestions.some((s) => s.key === gap.key)).toBe(false)
  })
  it('a requested W-2 year shows as requested, not suggested twice', () => {
    const w2 = allSuggestions(f, RULES).find((s) => s.body === 'W-2 for 2024: Home Depot')!
    const r = suggestConditions(f, RULES, { ...none, requests: [{ id: 'r1', contactId: 'pat', ruleKey: w2.requestKey!, status: 'received' }] })
    expect(r.suggestions.some((s) => s.key === w2.key)).toBe(false)
  })
  it('a condition from a gap that was fixed on the 1003 is flagged, not deleted', () => {
    const r = suggestConditions({ ...base, people: [pat] }, RULES, { ...none, conditions: [{ id: 'c1', sourceKey: 'emp_gap:pat:2025-05-01', status: 'outstanding' }] })
    expect(r.flagged).toEqual([{ conditionId: 'c1', why: 'No longer matches the file (the employment history changed)' }])
  })
})
