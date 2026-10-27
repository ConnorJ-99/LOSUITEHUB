import { describe, expect, it } from 'vitest'
import { evaluateProgram } from './engine'
import { defaultFilters, fitLine, gridOptions, matrixGrid } from './matrixGrid'
import { conventionalCatalog, conventionalPurchase, dscrCatalog, dscrSecond, marcus, marcusCatalog } from './testCatalog'

const northline = conventionalCatalog.programs[0]

describe('mockup 04: the matrix grid', () => {
  const f = defaultFilters(northline, conventionalPurchase)
  const g = matrixGrid(northline, f, conventionalPurchase)

  it("filters start at the borrower's purpose, property, doc type and loan tier", () => {
    expect(f).toEqual({ purpose: 'purchase', propertyType: 'sfr_pud', docType: 'full_doc', tier: 0 })
    expect(gridOptions(northline).tiers.map((t) => t.label)).toEqual(['Up to $806,500'])
  })
  it('rows are credit bands, high to low; columns are occupancy and units', () => {
    expect(g.rows.map((r) => r.label)).toEqual(['780+', '740 – 779', '720 – 739', '680 – 719', '660 – 679', '620 – 659'])
    expect(g.columns.map((c) => c.label)).toEqual(['Primary · 1 unit', 'Primary · 2 units', 'Second home', 'Investment'])
    expect(g.ratio).toBe('LTV')
  })
  it('limits per square; a blank cell and a missing one are both "not offered"', () => {
    expect(g.squares.map((row) => row.map((sq) => sq.limit))).toEqual([
      [97, 85, 90, 85],
      [97, 85, 90, 85],
      [97, 85, 90, 85],
      [97, 85, 90, 80],
      [95, 80, 85, 75],
      [95, 80, 85, null],
    ])
    expect(g.squares[5][3].cell?.offered).toBe(false)
  })
  it("the borrower's square is 720–739, primary 1 unit", () => {
    expect(g.highlight).toEqual({ row: 2, col: 0 })
    expect(g.pages).toEqual([1])
  })
  it('exploring another purpose drops the highlight', () => {
    expect(matrixGrid(northline, { ...f, purpose: 'rate_term' }, conventionalPurchase).highlight).toBeNull()
  })
  it('the fit line', () => {
    const r = evaluateProgram(northline, conventionalCatalog.lenders[0], conventionalPurchase)
    expect(fitLine(r, conventionalPurchase)).toBe('Fits: 720 FICO · Primary 1-unit · LTV 95% against 97% max · $380,000 within the $806,500 limit')
  })
})

describe('2nd liens', () => {
  it('a DSCR second: a CLTV grid filtered to 2–4 units', () => {
    const summit = dscrCatalog.programs[2]
    const g = matrixGrid(summit, defaultFilters(summit, dscrSecond), dscrSecond)
    expect(g.ratio).toBe('CLTV')
    expect(g.columns.map((c) => c.label)).toEqual(['Investment · 2–4 units'])
    expect(g.squares.map((row) => row.map((sq) => sq.limit))).toEqual([
      [70],
      [null],
    ])
    expect(g.highlight).toEqual({ row: 1, col: 0 })
    // Single-family shows the 1-unit column, which takes 660 and up.
    const sfr = matrixGrid(summit, { ...defaultFilters(summit, dscrSecond), propertyType: 'sfr_pud' }, dscrSecond)
    expect(sfr.columns.map((c) => c.label)).toEqual(['Investment'])
    expect(sfr.highlight).toBeNull()
  })
  it("Marcus: the fit line says the Texas cap set the limit, and the most he can take", () => {
    const cypress = marcusCatalog.programs[1]
    const r = evaluateProgram(cypress, marcusCatalog.lenders[1], marcus)
    expect(fitLine(r, marcus)).toBe('Fits: 652 FICO · Primary 1-unit · CLTV 76.45% against 80% max (Texas §50(a)(6) cap) · $75,000 within the $500,000 limit · up to $91,600')
  })
  it("a program that doesn't fit says why", () => {
    const harbor = dscrCatalog.programs[1]
    expect(fitLine(evaluateProgram(harbor, dscrCatalog.lenders[1], dscrSecond), dscrSecond)).toBe("Doesn't fit: Max CLTV 65% at 700–719; scenario is 67.19%")
  })
})
