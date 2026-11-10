import { describe, expect, it } from 'vitest'
import * as matrix from '../../../supabase/functions/assistant/matrix'
import type { ReadGrid, ReadProgram } from '../../../supabase/functions/assistant/matrix'
import * as update from '../../../supabase/functions/assistant/productUpdate'
import { normalizeProposal, quoteFound, type UpdateChange } from '../../../supabase/functions/assistant/productUpdate'
import { applyChanges, changeLines, citeEmail, guessLender } from './productUpdate'
import { approvalPayload, cellsFromProgram, type ProgramNow, type ReviewProgram } from './matrixImport'

const EMAIL = `Subject: Sequoia DSCR updates

Effective for locks on or after 12/1/2026, the maximum DTI on Sequoia DSCR increases to 55%.
Florida is now an eligible state.
Primary purchase at 700+ FICO up to $1,000,000 is now limited to “75% LTV”.
Appraisal transfers are no longer accepted.`

const grid = (o: Partial<ReadGrid> = {}): ReadGrid => ({
  page: 1,
  title: 'Primary',
  ratio: 'ltv',
  occupancy: 'primary',
  propertyTypes: ['sfr_pud'],
  purposes: ['purchase'],
  docTypes: ['dscr'],
  unitsMin: 1,
  unitsMax: 1,
  rows: [
    { label: '700+', ficoMin: 700, ficoMax: 850 },
    { label: '660-699', ficoMin: 660, ficoMax: 699 },
  ],
  columns: [
    { label: '≤$1,000,000', loanAmountMin: 0, loanAmountMax: 1_000_000, occupancy: null, unitsMin: null, unitsMax: null, purposes: null, propertyTypes: null },
    { label: '≤$2,000,000', loanAmountMin: 1_000_001, loanAmountMax: 2_000_000, occupancy: null, unitsMin: null, unitsMax: null, purposes: null, propertyTypes: null },
  ],
  values: [
    [80, 75],
    [75, 70],
  ],
  printedRows: 2,
  printedColumns: 2,
  notes: null,
  ...o,
})

const program = (o: Partial<ReadProgram> = {}): ReadProgram => ({
  name: 'Sequoia DSCR',
  family: 'non_qm',
  lien: 'first',
  docTypes: ['dscr'],
  features: [],
  purposes: ['purchase'],
  termOptions: ['fixed_30'],
  loanAmountBasis: 'this_lien',
  description: null,
  grids: [grid()],
  rules: [
    { field: 'dti', op: '<=', value: 50, appliesWhen: null, severity: 'hard', message: 'Max DTI 50%', page: 3, quote: 'Max DTI 50%' },
    { field: 'state', op: 'in', value: ['TX', 'OK'], appliesWhen: null, severity: 'hard', message: 'States', page: 1, quote: '' },
    { field: 'reserves_months', op: '>=', value: 6, appliesWhen: null, severity: 'hard', message: '6 months reserves', page: 2, quote: '' },
  ],
  ...o,
})

const blankChange = { program_id: 'p1', rule_action: null, rule_field: null, rule_op: null, rule_number: null, rule_list: null, rule_min: null, rule_max: null, applies_purposes: null, applies_occupancies: null, limit_occupancy: null, limit_purposes: null, limit_property_types: null, limit_doc_type: null, limit_fico_min: null, limit_loan_amount_max: null, limit_ratio: null, limit_value: null }

describe('the lists the email reader uses', () => {
  it("are the matrix reader's lists", () => {
    for (const k of ['DOC_TYPES', 'PURPOSES', 'PROPERTY_TYPES', 'OCCUPANCIES', 'RULE_FIELDS', 'RULE_OPS'] as const) expect(update[k]).toEqual(matrix[k])
  })
})

describe('quote checking', () => {
  it('finds a quote word for word, ignoring case, spacing, curly quotes and a trailing period', () => {
    expect(quoteFound('the maximum DTI on Sequoia DSCR increases to 55%.', EMAIL)).toBe(true)
    expect(quoteFound('FLORIDA  is now an\neligible state', EMAIL)).toBe(true)
    expect(quoteFound('is now limited to "75% LTV"', EMAIL)).toBe(true)
  })
  it('rejects a quote that is not in the email, or too short to mean anything', () => {
    expect(quoteFound('the maximum DTI increases to 60%', EMAIL)).toBe(false)
    expect(quoteFound('DTI', EMAIL)).toBe(false)
  })
})

describe('the assistant reply', () => {
  const raw = {
    program_ids: ['p1', 'nope'],
    effective_date: '2026-12-01',
    notes: 'DTI, states and an LTV cut.',
    changes: [
      { ...blankChange, kind: 'rule', summary: 'Max DTI raised to 55%', quote: 'the maximum DTI on Sequoia DSCR increases to 55%', rule_action: 'set', rule_field: 'dti', rule_op: '<=', rule_number: 55 },
      { ...blankChange, kind: 'rule', summary: 'Florida added', quote: 'Florida is now an eligible state.', rule_action: 'set', rule_field: 'state', rule_op: 'in', rule_list: ['tx', 'OK', 'FL'] },
      { ...blankChange, kind: 'rule', summary: 'Min FICO 600', quote: 'minimum FICO lowered to 600', rule_action: 'set', rule_field: 'fico', rule_op: '>=', rule_number: 600 },
      { ...blankChange, program_id: 'other', kind: 'text', summary: 'Other lender', quote: 'Appraisal transfers are no longer accepted.' },
      { ...blankChange, kind: 'limit', summary: 'LTV 75%', quote: 'Primary purchase at 700+ FICO up to $1,000,000 is now limited to', limit_occupancy: 'primary', limit_purposes: ['purchase'], limit_fico_min: 700, limit_loan_amount_max: 1_000_000, limit_ratio: 'ltv', limit_value: 75 },
      { ...blankChange, kind: 'text', summary: 'No appraisal transfers', quote: 'Appraisal transfers are no longer accepted.' },
    ],
  }
  const p = normalizeProposal(raw, EMAIL, ['p1'])
  it('keeps only changes with a real quote and one of the lender’s programs', () => {
    if ('error' in p) throw new Error(p.error)
    expect(p.changes.map((c) => c.summary)).toEqual(['Max DTI raised to 55%', 'Florida added', 'LTV 75%', 'No appraisal transfers'])
    expect(p.leftOut).toEqual(["Min FICO 600 (its quote isn't in the email word for word)", "Other lender (not one of this lender's programs)"])
    expect(p.programIds).toEqual(['p1'])
    expect(p.effectiveDate).toBe('2026-12-01')
  })
  it('puts values in the rule shape (state codes upper case)', () => {
    if ('error' in p) throw new Error(p.error)
    expect(p.changes[1].rule).toMatchObject({ field: 'state', op: 'in', value: ['TX', 'OK', 'FL'] })
    expect(p.changes[2].target).toMatchObject({ occupancy: 'primary', purposes: ['purchase'], ficoMin: 700, loanAmountMax: 1_000_000 })
  })
  it('refuses something unreadable', () => {
    expect(normalizeProposal(null, EMAIL, ['p1'])).toHaveProperty('error')
  })
})

const rule = (o: Partial<UpdateChange>): UpdateChange => ({ id: 'c', programId: 'p1', kind: 'rule', summary: 's', quote: 'q', action: 'set', ...o })

describe('applying changes', () => {
  it('replaces a rule on the same field, adds a new one, removes one, and leaves the rest alone', () => {
    const before = program()
    const { program: after, notApplied } = applyChanges(before, [
      rule({ id: 'a', quote: 'the maximum DTI on Sequoia DSCR increases to 55%', rule: { field: 'dti', op: '<=', value: 55, appliesWhen: null, severity: 'hard', message: 'Max DTI 55%' } }),
      rule({ id: 'b', rule: { field: 'fico', op: '>=', value: 660, appliesWhen: null, severity: 'hard', message: 'Min FICO 660' } }),
      rule({ id: 'c', action: 'remove', rule: { field: 'reserves_months', op: '>=', value: null, appliesWhen: null, severity: 'hard', message: '' } }),
    ])
    expect(notApplied).toEqual([])
    expect(after.rules.find((r) => r.field === 'dti')).toMatchObject({ value: 55, page: 1, quote: 'the maximum DTI on Sequoia DSCR increases to 55%' })
    expect(after.rules.find((r) => r.field === 'fico')).toMatchObject({ value: 660 })
    expect(after.rules.some((r) => r.field === 'reserves_months')).toBe(false)
    expect(after.rules.find((r) => r.field === 'state')).toEqual(before.rules[1])
    expect(after.grids).toEqual(before.grids)
    // The program on file is never changed in place.
    expect(before.rules[0].value).toBe(50)
  })
  it('replaces a state list (in) with the new one', () => {
    const { program: after } = applyChanges(program(), [rule({ rule: { field: 'state', op: 'in', value: ['TX', 'OK', 'FL'], appliesWhen: null, severity: 'hard', message: 'States' } })])
    expect(after.rules.filter((r) => r.field === 'state')).toHaveLength(1)
    expect(after.rules.find((r) => r.field === 'state')?.value).toEqual(['TX', 'OK', 'FL'])
  })
  it('a rule with conditions is its own rule', () => {
    const { program: after } = applyChanges(program(), [rule({ rule: { field: 'dti', op: '<=', value: 45, appliesWhen: { purposes: ['cash_out'] }, severity: 'hard', message: 'Cash-out max DTI 45%' } })])
    expect(after.rules.filter((r) => r.field === 'dti').map((r) => r.value)).toEqual([50, 45])
  })
  it('changes one matrix square and nothing else', () => {
    const before = program()
    const change: UpdateChange = { id: 'l', programId: 'p1', kind: 'limit', summary: '', quote: '', target: { occupancy: 'primary', purposes: ['purchase'], propertyTypes: null, docType: null, ficoMin: 700, loanAmountMax: 1_000_000, ratio: 'ltv' }, value: 75 }
    const { program: after, notApplied } = applyChanges(before, [change])
    expect(notApplied).toEqual([])
    expect(after.grids[0].values).toEqual([
      [75, 75],
      [75, 70],
    ])
    expect(changeLines(before, change).lines).toEqual(['Primary · SFR/PUD · Purchase · 700+ · ≤$1,000,000: 80% → 75%'])
  })
  it('a whole tier (every score) and no longer offered', () => {
    const { program: after } = applyChanges(program(), [{ id: 'l', programId: 'p1', kind: 'limit', summary: '', quote: '', target: { occupancy: null, purposes: null, propertyTypes: null, docType: null, ficoMin: null, loanAmountMax: 2_000_000, ratio: 'ltv' }, value: null }])
    expect(after.grids[0].values).toEqual([
      [80, null],
      [75, null],
    ])
  })
  it("won't change a square that also covers loans the email doesn't mention", () => {
    const before = program({ grids: [grid({ purposes: ['purchase', 'rate_term'] })] })
    const { program: after, notApplied } = applyChanges(before, [{ id: 'l', programId: 'p1', kind: 'limit', summary: '', quote: '', target: { occupancy: 'primary', purposes: ['purchase'], propertyTypes: null, docType: null, ficoMin: 700, loanAmountMax: null, ratio: 'ltv' }, value: 70 }])
    expect(after.grids).toEqual(before.grids)
    expect(notApplied[0].reason).toMatch(/also covers loans the email doesn't mention/)
  })
  it('says when no square matches, and when there is no rule to remove', () => {
    const { notApplied } = applyChanges(program(), [
      { id: 'l', programId: 'p1', kind: 'limit', summary: '', quote: '', target: { occupancy: 'investment', purposes: null, propertyTypes: null, docType: null, ficoMin: null, loanAmountMax: null, ratio: 'ltv' }, value: 70 },
      rule({ id: 'r', action: 'remove', rule: { field: 'fico', op: '>=', value: null, appliesWhen: null, severity: 'hard', message: '' } }),
    ])
    expect(notApplied.map((n) => n.change.id)).toEqual(['l', 'r'])
  })
  it('guideline-text changes make no change to the matrix', () => {
    const before = program()
    expect(applyChanges(before, [{ id: 't', programId: 'p1', kind: 'text', summary: '', quote: '' }]).program).toEqual(before)
  })
  it('shows rules before and after', () => {
    expect(changeLines(program(), rule({ rule: { field: 'dti', op: '<=', value: 55, appliesWhen: null, severity: 'hard', message: '' } })).lines).toEqual(['DTI: ≤ 50 → ≤ 55'])
    expect(changeLines(program(), rule({ rule: { field: 'fico', op: '>=', value: 640, appliesWhen: null, severity: 'hard', message: '' } })).lines).toEqual(['Credit score: not on file → ≥ 640'])
  })
})

describe('the lender in the email', () => {
  const lenders = [
    { id: 'newfi', name: 'Newfi Wholesale' },
    { id: 'uwm', name: 'United Wholesale Mortgage' },
    { id: 'acra', name: 'Acra Lending' },
  ]
  it('finds the lender by its own name words', () => {
    expect(guessLender('From the Newfi team: Sequoia DSCR updates', lenders)).toBe('newfi')
    expect(guessLender('United Wholesale Mortgage product bulletin', lenders)).toBe('uwm')
  })
  it('gives no guess when no lender or two lenders are named equally', () => {
    expect(guessLender('Rate update for all wholesale partners', lenders)).toBeNull()
    expect(guessLender('Newfi and Acra both changed', lenders)).toBeNull()
  })
})

describe('citations at approval', () => {
  it('changed cells and rules cite the email; unchanged ones keep their source', () => {
    const before = program()
    const now: ProgramNow = { id: 'p1', name: before.name, cells: cellsFromProgram(before), rules: before.rules, docTypes: before.docTypes, purposes: before.purposes, features: before.features, termOptions: before.termOptions, description: null, sourceDocumentId: 'pdf' }
    const { program: after } = applyChanges(before, [
      rule({ rule: { field: 'dti', op: '<=', value: 55, appliesWhen: null, severity: 'hard', message: 'Max DTI 55%' } }),
      { id: 'l', programId: 'p1', kind: 'limit', summary: '', quote: '', target: { occupancy: 'primary', purposes: ['purchase'], propertyTypes: null, docType: null, ficoMin: 700, loanAmountMax: 1_000_000, ratio: 'ltv' }, value: 75 },
    ])
    const review: ReviewProgram = { ...after, include: true, programId: 'p1', mode: 'replace' }
    const cited = citeEmail(approvalPayload([review], [now]), [now], 'email')
    const changedCells = cited[0].cells.filter((c) => 'source_document_id' in c)
    expect(changedCells).toHaveLength(1)
    expect(changedCells[0]).toMatchObject({ fico_min: 700, loan_amount_max: 1_000_000, max_ltv: 75 })
    expect(cited[0].rules.filter((r) => 'source_document_id' in r).map((r) => r.field)).toEqual(['dti'])
  })
})
