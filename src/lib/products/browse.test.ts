import { describe, expect, it } from 'vitest'
import { allBrowseFilters, browseCounts, browseGroup, browseRows, filterBrowse, groupBrowse, programSummary } from './browse'
import { cell, lender, program, rule } from './testCatalog'
import type { Catalog } from './types'

const catalog: Catalog = {
  lenders: [lender('Northline Wholesale'), lender('Keystone Non-QM'), lender('Harbor Point Lending', 'not_signed_up'), lender('Old Bank', 'inactive')],
  programs: [
    program('Northline Wholesale', 'Conventional 30-Year Fixed', { cells: [cell({ ficoMin: 620, ficoMax: 679, maxLtv: 95, loanAmountMax: 806500 }), cell({ ficoMin: 680, maxLtv: 97, loanAmountMax: 806500 }), cell({ ficoMin: 580, ficoMax: 619, offered: false })] }),
    program('Northline Wholesale', 'Conventional HomeReady', { features: ['homeready_possible'], cells: [cell({ maxLtv: 97, loanAmountMax: 806500 })] }),
    program('Northline Wholesale', 'FHA with DPA', { family: 'fha', features: ['dpa'], cells: [cell({ ficoMin: 600, maxLtv: 96.5 })] }),
    program('Keystone Non-QM', 'DSCR Closed-End Second', { family: 'non_qm', lien: 'ces', docTypes: ['dscr'], features: ['llc_vesting'], cells: [cell({ occupancy: 'investment', docType: 'dscr', ficoMin: 680, maxCltv: 75, loanAmountMax: 500000, dscrMin: 1 })] }),
    program('Harbor Point Lending', 'Investor Equity 2nd (DSCR)', { family: 'non_qm', lien: 'ces', docTypes: ['dscr'], cells: [cell({ occupancy: 'investment', docType: 'dscr', ficoMin: 660, maxCltv: 70 })], rules: [rule({ field: 'dscr', op: '>=', value: 0.75, message: 'Min DSCR 0.75' })] }),
    program('Keystone Non-QM', 'Bank Statement 1st', { family: 'non_qm', docTypes: ['bank_statement_12'], cells: [cell({ docType: 'bank_statement_12', ficoMin: 620, maxLtv: 90 })] }),
    program('Keystone Non-QM', 'Retired', { active: false, cells: [cell({ maxLtv: 80 })] }),
    program('Old Bank', 'Inactive lender program', { cells: [cell({ maxLtv: 80 })] }),
  ],
  overlays: [],
}
const rows = browseRows(catalog)
const labels = { llc_vesting: 'LLC vesting' }
const names = (rs: { program: { name: string } }[]) => rs.map((r) => r.program.name)

describe('browse all programs', () => {
  it('retired programs and inactive lenders are left out', () => {
    expect(names(rows)).not.toContain('Retired')
    expect(names(rows)).not.toContain('Inactive lender program')
    expect(rows).toHaveLength(6)
  })
  it('an FHA program that only offers a DPA option stays under FHA', () => {
    expect(browseGroup(program('A&D Mortgage', 'FHA', { family: 'fha', features: ['dpa', 'manufactured', 'buydown'] }))).toBe('fha')
    expect(browseGroup(program('Click n Close', 'SmartBuy', { family: 'fha', features: ['dpa'] }))).toBe('dpa')
  })
  it('product groups: Non-QM by doc type; DPA on its own', () => {
    expect(rows.map((r) => [r.program.name, r.group])).toEqual([
      ['Conventional 30-Year Fixed', 'conventional'],
      ['Conventional HomeReady', 'conventional'],
      ['FHA with DPA', 'dpa'],
      ['DSCR Closed-End Second', 'non_qm_dscr'],
      ['Investor Equity 2nd (DSCR)', 'non_qm_dscr'],
      ['Bank Statement 1st', 'non_qm_bank_statement'],
    ])
    expect(browseGroup(catalog.programs[0])).toBe('conventional')
  })
  it('headline numbers come from offered cells only (a blank 580 cell does not lower the FICO floor)', () => {
    expect(programSummary(catalog.programs[0])).toEqual({ minFico: 620, maxRatio: 97, ratio: 'LTV', maxLoan: 806500, minDscr: null })
    expect(programSummary(catalog.programs[3])).toEqual({ minFico: 680, maxRatio: 75, ratio: 'CLTV', maxLoan: 500000, minDscr: 1 })
    expect(programSummary(catalog.programs[4])).toMatchObject({ maxLoan: null, minDscr: 0.75 })
  })
  it('filters: product group, lien, lender status, quick limits', () => {
    expect(names(filterBrowse(rows, { ...allBrowseFilters(), groups: ['non_qm_dscr'] }))).toEqual(['DSCR Closed-End Second', 'Investor Equity 2nd (DSCR)'])
    expect(names(filterBrowse(rows, { ...allBrowseFilters(), liens: ['ces'], statuses: ['approved'] }))).toEqual(['DSCR Closed-End Second'])
    expect(names(filterBrowse(rows, { ...allBrowseFilters(), ficoAtOrBelow: 660, ltvAtLeast: 80 }))).toEqual(['Conventional 30-Year Fixed', 'Conventional HomeReady', 'FHA with DPA', 'Bank Statement 1st'])
  })
  it('the search box matches program, lender and feature names, plus guideline text hits', () => {
    expect(filterBrowse(rows, { ...allBrowseFilters(), text: 'llc' }, labels).map((r) => [r.program.name, r.matchedBy])).toEqual([['DSCR Closed-End Second', 'name']])
    const viaGuidelines = filterBrowse(rows, { ...allBrowseFilters(), text: 'non-warrantable', guidelineHits: new Set([catalog.programs[5].id]) })
    expect(viaGuidelines.map((r) => [r.program.name, r.matchedBy])).toEqual([['Bank Statement 1st', 'guidelines']])
  })
  it('counts show what each option would show, given the other filters', () => {
    const c = browseCounts(rows, { ...allBrowseFilters(), groups: ['conventional'], liens: ['first'] })
    expect(c.groups).toMatchObject({ conventional: 2, dpa: 1, non_qm_dscr: 0, non_qm_bank_statement: 1 })
    expect(c.statuses).toMatchObject({ approved: 2, not_signed_up: 0 })
  })
  it('grouped by product type in filter order, or by lender, or most recently verified', () => {
    const all = filterBrowse(rows, allBrowseFilters())
    expect(groupBrowse(all, 'type', new Map()).map((g) => [g.group, g.rows.length])).toEqual([
      ['conventional', 2],
      ['non_qm_dscr', 2],
      ['non_qm_bank_statement', 1],
      ['dpa', 1],
    ])
    const verified = new Map([[catalog.programs[4].id, '2026-08-30'], [catalog.programs[3].id, '2026-10-14']])
    expect(names(groupBrowse(all, 'updated', verified)[0].rows).slice(0, 2)).toEqual(['DSCR Closed-End Second', 'Investor Equity 2nd (DSCR)'])
    expect(groupBrowse(all, 'lender', new Map())[0].rows[0].lender.name).toBe('Harbor Point Lending')
  })
})
