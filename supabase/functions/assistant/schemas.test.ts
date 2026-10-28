import { describe, expect, it } from 'vitest'
import { NOTES_SCHEMA } from './callNotes'
import { CONTRACT_SCHEMA } from './contract'
import { DRAFT_SCHEMA } from './followUp'
import { ANSWER_SCHEMA } from './guidelineAnswer'
import { MATRIX_SCHEMA } from './matrix'
import { SCENARIO_SCHEMA, normalizeScenarioRead } from './scenarioRead'

/** Places in a schema that are "one of several types" (anyOf, or a list of types). */
function unions(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n, x) => n + unions(x), 0)
  if (!node || typeof node !== 'object') return 0
  const o = node as Record<string, unknown>
  const here = Array.isArray(o.anyOf) || Array.isArray(o.type) ? 1 : 0
  return here + Object.values(o).reduce((n: number, v) => n + unions(v), 0)
}

describe('structured output limits', () => {
  // Claude rejects a schema with more than 16 union-typed parameters ("exponential compilation cost").
  it.each([
    ['call notes', NOTES_SCHEMA],
    ['contract', CONTRACT_SCHEMA],
    ['follow-up draft', DRAFT_SCHEMA],
    ['guideline answer', ANSWER_SCHEMA],
    ['matrix', MATRIX_SCHEMA],
    ['scenario', SCENARIO_SCHEMA],
  ])('the %s form has at most 16 "value or null" fields', (_name, schema) => {
    expect(unions(schema)).toBeLessThanOrEqual(16)
  })
  it('a scenario field left empty ("" or -1) means not stated', () => {
    const empty = { lien: '', family: '', docType: '', features: [], purpose: '', occupancy: '', propertyType: '', units: -1, state: '', county: '', purchasePrice: -1, value: -1, loanAmount: -1, downPaymentPct: -1, ltvPct: -1, firstLienBalance: -1, fico: -1, dti: -1, reservesMonths: -1, dscr: -1, citizenship: '', mortgageLates12: -1, mortgageLates24: -1, bkSeasoningMonths: -1, fcSeasoningMonths: -1, selfEmployedYears: -1, firstTimeBuyer: null, homestead: null }
    const r = normalizeScenarioRead({ read: { ...empty, fico: 720, state: 'tx' }, evidence: [], unclear: [] }, '720 FICO in TX')
    if ('error' in r) throw new Error(r.error)
    const filled = Object.entries(r.read).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0))
    expect(Object.fromEntries(filled)).toEqual({ fico: 720, state: 'TX' })
  })
})
