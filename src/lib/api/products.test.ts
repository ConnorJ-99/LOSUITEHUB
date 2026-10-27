import { describe, expect, it } from 'vitest'
import { toCatalog, type CatalogRows, type CellRow, type RuleRow } from './products'

const cellRow = (id: string, version: string, over: Partial<CellRow> = {}): CellRow => ({
  id, matrix_version_id: version, occupancy: 'primary', property_types: ['sfr_pud'], purposes: ['purchase'], doc_type: 'full_doc', units_min: 1, units_max: 4, fico_min: 620, fico_max: 850,
  loan_amount_min: '0', loan_amount_max: '806500.00', dscr_min: null, citizenship: null, offered: true, max_ltv: '97.000', max_cltv: null, max_dti: null, reserves_months: null, source_page: 1, notes: null, ...over,
})
const ruleRow = (id: string, over: Partial<RuleRow>): RuleRow => ({ id, field: 'dti', op: '<=', value: 50, applies_when: null, severity: 'hard', message: 'Max DTI 50%', ...over })

const rows: CatalogRows = {
  lenders: [{ id: 'L', name: 'Sample', status: 'approved', states: ['TX'] }],
  programs: [{ id: 'P', lender_id: 'L', name: 'Conv 30', product_family: 'conventional', lien: 'first', doc_types: ['full_doc'], features: [], purposes: ['purchase'], loan_amount_basis: 'this_lien', active: true, last_verified_on: '2026-10-01' }],
  versions: [{ id: 'v2', program_id: 'P' }],
  cells: [cellRow('c-approved', 'v2'), cellRow('c-draft', 'v3', { max_ltv: '99' }), cellRow('c-blank', 'v2', { offered: false, max_ltv: null })],
  rules: [ruleRow('r-program', { program_id: 'P' }), ruleRow('r-v2', { program_id: 'P', matrix_version_id: 'v2', message: 'From v2' }), ruleRow('r-v3', { program_id: 'P', matrix_version_id: 'v3', message: 'From draft v3' })],
  overlays: [ruleRow('o-all', { scope: 'all', message: 'Company min' }), ruleRow('o-lender', { scope: 'lender', lender_id: 'L', message: 'Lender overlay' }), ruleRow('o-other', { scope: 'lender', lender_id: 'X', message: 'Other lender' })],
}

describe('toCatalog', () => {
  const c = toCatalog(rows)
  const p = c.programs[0]

  it('uses only the approved matrix version, and keeps blank cells as not offered', () => {
    expect(p.cells.map((x) => x.id)).toEqual(['c-approved', 'c-blank'])
    expect(p.cells[0]).toMatchObject({ maxLtv: 97, loanAmountMin: 0, loanAmountMax: 806500 })
    expect(p.cells[1]).toMatchObject({ offered: false, maxLtv: null })
  })
  it("drops rules from a version that isn't approved; adds this lender's overlays", () => {
    expect(p.rules.map((r) => r.message)).toEqual(['Max DTI 50%', 'From v2', 'Lender overlay'])
    expect(p.rules.at(-1)!.overlay).toBe(true)
    expect(c.overlays.map((o) => o.message)).toEqual(['Company min'])
  })
})
