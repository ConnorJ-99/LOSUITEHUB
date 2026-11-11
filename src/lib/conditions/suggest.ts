// Suggested conditions on a file (build plan Phase 8; plan
// docs/plans/suggested-conditions.md). Worked out from the company's rules
// (Settings → Document checklist) and the file, never stored until Connor
// adds one. Each suggestion has a stable key (rule + person + account or job)
// so it's recognized after it's added or dismissed, and is hidden when the
// same item is already a condition or a received document request.

import { appliesTo, type ConditionPartyValue, type RuleFacts, type RuleStage } from './ruleFilters'
import { AWARD_INCOMES, BANKABLE_ASSETS, FILE_RULE_CONDITIONS, GIFT_ASSETS, INVESTMENT_ASSETS, personConditions, type DocRule, type PersonCondition } from '@/lib/prequal/nextStep'
import type { CreditEventType } from '@/lib/prequal/readiness'
import { ASSET_OPTIONS, GIFT_SOURCE_OPTIONS, type OtherIncomeType } from '@/lib/urla/options'
import type { DocumentKind } from '@/lib/api/documents'

export interface SuggestPerson {
  contactId: string
  firstName: string
  jobs: { id: string; employerName: string; selfEmployed: boolean }[]
  otherIncomes: OtherIncomeType[]
  assets: { id: string; assetType: string; institutionName: string | null; accountLast4: string | null; amount: number; giftSource: string | null }[]
  creditEvents: CreditEventType[]
}

/** A number from the selected program's rules, with where it came from. */
export interface Cited {
  value: number
  citation: string | null
}

export interface ProgramLimits {
  bankStatementMonths?: Cited
  assetStatementMonths?: Cited
  taxReturnYears?: Cited
}

export interface FileFacts extends RuleFacts {
  people: SuggestPerson[]
  /** Homes they already own other than the subject: rented out or not. */
  homes: { rented: boolean }[]
  programName: string | null
  program: ProgramLimits
  /** This year (tax years count back from last year). */
  year: number
}

export interface Existing {
  conditions: { id: string; sourceKey: string | null; status: string }[]
  requests: { id: string; contactId: string | null; ruleKey: string; status: 'requested' | 'received' | 'reviewed' | 'waived' }[]
  dismissed: string[]
}

export interface SuggestionSource {
  kind: 'company' | 'lender' | 'ai'
  /** The rule's name, or the program. */
  label: string
  citation: string | null
}

export interface Suggestion {
  key: string
  ruleKey: string
  contactId: string | null
  body: string
  why: string
  source: SuggestionSource
  party: ConditionPartyValue
  stage: RuleStage
  kind: DocumentKind
  /** A document request already asked for (not in yet): adding links to it. */
  request: { id: string; status: 'requested' } | null
}

export interface Flagged {
  conditionId: string
  why: string
}

const conditionsOf = (p: SuggestPerson, doc: NonNullable<FileFacts['incomeDocType']>) => personConditions({ ...p, assetTypes: p.assets.map((a) => a.assetType) }, doc)

const STAGE_ORDER: Record<RuleStage, number> = { application: 0, processing: 1, before_closing: 2 }
const labelOf = (options: readonly { value: string; label: string }[], v: string | null) => (v ? (options.find((o) => o.value === v)?.label ?? v) : null)
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m)

/** "Chase checking ••1234" (last 4 only). */
export function accountName(a: Pick<SuggestPerson['assets'][number], 'assetType' | 'institutionName' | 'accountLast4'>): string {
  const type = (labelOf(ASSET_OPTIONS, a.assetType) ?? 'account').toLowerCase()
  const last4 = a.accountLast4?.replace(/\D/g, '').slice(-4)
  return [a.institutionName?.trim(), type, last4 ? `••${last4}` : null].filter(Boolean).join(' ')
}

/** Which program number replaces a rule's months or years. */
const MONTHS_FROM: Record<string, keyof ProgramLimits> = {
  bank_statements_income: 'bankStatementMonths',
  bank_statements: 'assetStatementMonths',
  asset_statements: 'assetStatementMonths',
  investment_statements: 'assetStatementMonths',
}
const YEARS_FROM: Record<string, keyof ProgramLimits> = { tax_returns: 'taxReturnYears', business_returns: 'taxReturnYears' }
const LISTS_YEARS = ['tax_returns', 'business_returns', 'w2s', 'forms_1099']

/** The rule's wording with the program's months or years, and the tax years named. */
function wording(rule: DocRule, facts: FileFacts): { text: string; cited: Cited | null } {
  let text = rule.fullText
  let cited: Cited | null = null
  const m = MONTHS_FROM[rule.key] ? facts.program[MONTHS_FROM[rule.key]] : undefined
  if (m) {
    text = text.replace(/\b\d+(?:\s*(?:to|-|–)\s*\d+)?\s+months\b/, `${m.value} months`)
    cited = m
  }
  const y = YEARS_FROM[rule.key] ? facts.program[YEARS_FROM[rule.key]] : undefined
  if (y) {
    text = text.replace(/\b\d+\s+years\b/, `${y.value} years`)
    cited = y
  }
  if (LISTS_YEARS.includes(rule.key)) {
    const n = Number(/\b(\d+)\s+years\b/.exec(text)?.[1] ?? 0)
    if (n > 0 && n <= 5) {
      const years = Array.from({ length: n }, (_, i) => facts.year - n + i)
      text = text.replace(/\b\d+\s+years\b/, (s) => `${s} (${years.join(', ')})`)
    }
  }
  return { text, cited }
}

const PURPOSE_WHY: Record<string, string> = { purchase: 'Purchase', refinance_rate_term: 'Rate/term refinance', refinance_cash_out: 'Cash-out refinance', heloc: 'HELOC', heloan: 'HELOAN', investment_dscr: 'Investment / DSCR' }
const TYPE_WHY: Record<string, string> = { conventional: 'Conventional loan', fha: 'FHA loan', va: 'VA loan', usda_rural: 'USDA loan', other: 'Non-QM loan' }
const PROPERTY_WHY: Record<string, string> = { condo: 'Condo', two_to_four_unit: '2–4 units', manufactured: 'Manufactured home', townhouse: 'Townhouse', single_family: 'Single family', other: 'Other property type' }
const OCC_WHY: Record<string, string> = { primary: 'Primary residence', second_home: 'Second home', investment: 'Investment property' }
const DOC_WHY: Record<string, string> = { full_doc: 'Full doc', bank_statement: 'Bank statement income', form_1099: '1099 income', asset_based: 'Asset-based income', dscr: 'DSCR' }

/** Why a rule's filters fit: "Purchase · Condo". */
function filterWhy(r: DocRule, f: FileFacts): string[] {
  const out: string[] = []
  if (r.purposes?.length) out.push(PURPOSE_WHY[f.purpose] ?? f.purpose)
  if (r.mortgageTypes?.length && f.mortgageType) out.push(TYPE_WHY[f.mortgageType])
  if (r.propertyTypes?.length && f.propertyType) out.push(PROPERTY_WHY[f.propertyType])
  if (r.occupancies?.length && f.occupancy) out.push(OCC_WHY[f.occupancy])
  if (r.incomeDocTypes?.length) out.push(DOC_WHY[f.incomeDocType ?? 'full_doc'])
  if (r.texasCashOut) out.push('Texas §50(a)(6) cash-out')
  if (r.entityVesting && f.entityVesting) out.push(`Vests in ${f.entityVesting.trim()}`)
  if (r.vaExempt) out.push('VA funding fee exempt')
  if (r.programId && f.programName) out.push(f.programName)
  return out
}

interface Item {
  key: string
  contactId: string | null
  /** Who / which account or job, added after the wording. */
  detail: string | null
  why: string
  requestRuleKey: string
  fill?: Record<string, string>
}

/** The items one person-level rule gives one borrower: one per account or job where that's what it's about. */
function personItems(rule: DocRule, p: SuggestPerson, has: Record<PersonCondition, boolean>): Item[] {
  const base = { contactId: p.contactId, requestRuleKey: rule.key }
  const k = (...parts: string[]) => [rule.key, p.contactId, ...parts].join(':')
  const c = rule.condition
  if (c === 'award_income') {
    return [...new Set(p.otherIncomes.filter((t) => AWARD_INCOMES[t]))].map((t) => ({
      ...base,
      key: k(t),
      requestRuleKey: `${rule.key}_${t}`,
      detail: p.firstName,
      why: `${AWARD_INCOMES[t]} income on the 1003`,
      fill: { income: AWARD_INCOMES[t]! },
    }))
  }
  if (!has[c as PersonCondition]) return []
  const accounts = (types: string[]) => p.assets.filter((a) => types.includes(a.assetType))
  if (c === 'bank_accounts' || c === 'investment_accounts') {
    return accounts(c === 'bank_accounts' ? BANKABLE_ASSETS : INVESTMENT_ASSETS).map((a) => ({ ...base, key: k(a.id), detail: accountName(a), why: `${accountName(a)} on the 1003` }))
  }
  if (c === 'gift') {
    return accounts(GIFT_ASSETS).map((a) => {
      const from = labelOf(GIFT_SOURCE_OPTIONS, a.giftSource)
      return { ...base, key: k(a.id), detail: p.firstName, why: `Gift on the 1003: ${money(a.amount)}${from ? ` from ${from}` : ''}` }
    })
  }
  if (c === 'wage_earner') {
    return p.jobs.filter((j) => !j.selfEmployed).map((j) => ({ ...base, key: k(j.id), detail: j.employerName, why: `Job on the 1003: ${j.employerName}`, fill: { each_job: '' } }))
  }
  if (c === 'self_employed' && rule.key !== 'tax_returns') {
    return p.jobs.filter((j) => j.selfEmployed).map((j) => ({ ...base, key: k(j.id), detail: j.employerName, why: `Self-employed: ${j.employerName}` }))
  }
  const WHY: Partial<Record<PersonCondition, string>> = {
    everyone: 'Every borrower',
    self_employed: 'Self-employed income',
    bank_statement_income: 'Bank statement income',
    form_1099_income: '1099 income',
    asset_based_income: 'Asset-based income',
    support_income: 'Child support or alimony on the 1003',
    bankruptcy: 'Bankruptcy on the profile',
    foreclosure: 'Foreclosure, short sale or deed in lieu on the profile',
    late_or_collection: 'Late payment or collection on the profile',
  }
  return [{ ...base, key: k(), detail: p.firstName, why: WHY[c as PersonCondition] ?? 'From the profile' }]
}

/** Every suggestion for the file (before hiding the ones already handled), in stage order. */
export function allSuggestions(facts: FileFacts, rules: DocRule[]): Suggestion[] {
  const doc = facts.incomeDocType ?? 'full_doc'
  const several = facts.people.length > 1
  const out: (Suggestion & { order: number })[] = []
  for (const rule of rules.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!appliesTo(rule, facts)) continue
    const filters = filterWhy(rule, facts)
    const { text, cited } = wording(rule, facts)
    const source: SuggestionSource = cited
      ? { kind: 'lender', label: facts.programName ?? 'Selected program', citation: cited.citation }
      : { kind: 'company', label: rule.shortText, citation: null }
    const party = rule.party ?? 'borrower'
    const stage = rule.stage ?? 'processing'
    const push = (it: Item) =>
      out.push({
        key: it.key,
        ruleKey: rule.key,
        contactId: it.contactId,
        body: it.detail ? `${fill(text, it.fill ?? {})}: ${it.detail}` : fill(text, it.fill ?? {}),
        why: [...filters, it.why].filter(Boolean).join(' · ') || 'Company rule',
        source,
        party,
        stage,
        kind: rule.kind,
        request: null,
        order: STAGE_ORDER[stage] * 10_000 + rule.sortOrder,
      })

    if (FILE_RULE_CONDITIONS.includes(rule.condition)) {
      const owns = facts.homes.length
      const fits = rule.condition === 'owns_home' ? owns > 0 : facts.homes.some((h) => h.rented) || doc === 'dscr'
      if (fits) push({ key: rule.key, contactId: null, detail: null, why: rule.condition === 'owns_home' ? `Owns ${owns} other home${owns === 1 ? '' : 's'}` : 'Rents a home out, or DSCR', requestRuleKey: rule.key })
      continue
    }
    if ((rule.scope ?? 'person') === 'file') {
      // Once for the whole file, when any borrower fits (or always, for "everyone").
      const fits = rule.condition === 'everyone' || facts.people.some((p) => conditionsOf(p, doc)[rule.condition as PersonCondition])
      if (fits) push({ key: rule.key, contactId: null, detail: rule.entityVesting && facts.entityVesting ? facts.entityVesting.trim() : null, why: filters.length ? '' : 'Company rule', requestRuleKey: rule.key })
      continue
    }
    for (const p of facts.people) {
      for (const it of personItems(rule, p, conditionsOf(p, doc))) push({ ...it, detail: it.detail === p.firstName && !several ? null : it.detail })
    }
  }
  return out.sort((a, b) => a.order - b.order).map(({ order: _order, ...s }) => s)
}

/**
 * What to show in Suggested: the file's suggestions minus the ones already a
 * condition, dismissed, or received / reviewed / waived as a document
 * request; plus conditions added from a suggestion that no longer fits.
 */
export function suggestConditions(facts: FileFacts, rules: DocRule[], existing: Existing): { suggestions: Suggestion[]; flagged: Flagged[] } {
  const all = allSuggestions(facts, rules)
  const used = new Set(existing.conditions.map((c) => c.sourceKey).filter(Boolean))
  const dismissed = new Set(existing.dismissed)
  const requestFor = (s: Suggestion) =>
    existing.requests.find((r) => r.ruleKey === requestKeyOf(s) && (r.contactId === s.contactId || (s.contactId === null && r.contactId === null)))
  const suggestions = all
    .filter((s) => !used.has(s.key) && !dismissed.has(s.key))
    .flatMap((s) => {
      const r = requestFor(s)
      if (r && r.status !== 'requested') return []
      return [{ ...s, request: r ? { id: r.id, status: 'requested' as const } : null }]
    })
  const live = new Set(all.map((s) => s.key))
  const flagged = existing.conditions
    .filter((c) => c.sourceKey && !live.has(c.sourceKey) && c.status !== 'cleared' && c.status !== 'waived')
    .map((c) => {
      const rule = rules.find((r) => r.key === c.sourceKey!.split(':')[0])
      const why = !rule ? 'its rule was removed' : !rule.active ? 'its rule is turned off' : rule.shortText
      return { conditionId: c.id, why: `No longer matches the file (${why})` }
    })
  return { suggestions, flagged }
}

/** The document request key a suggestion matches: the rule, or the rule + income type for award letters. */
function requestKeyOf(s: Suggestion): string {
  const parts = s.key.split(':')
  return parts.length === 3 && s.ruleKey === parts[0] && /^[a-z_]+$/.test(parts[2]) && AWARD_INCOMES[parts[2] as OtherIncomeType] ? `${s.ruleKey}_${parts[2]}` : s.ruleKey
}

