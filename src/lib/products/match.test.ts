import { describe, expect, it } from 'vitest'
import { gradeFor, matchContext, matchFamilies, hotFirst, matchLenders, matchScenario, onlyHot, shortLines } from './match'
import { cell, conventionalCatalog, conventionalPurchase, lender, program, rule, scenario } from './testCatalog'
import type { Catalog } from './types'

const base = { propertyTypes: ['sfr_pud' as const], purposes: ['purchase' as const] }

// Fictional lenders. File: $400,000 purchase, $360,000 loan (90% LTV), 720 FICO, DTI 44%.
const catalog: Catalog = {
  lenders: [lender('Alpha Wholesale'), lender('Bravo TPO'), lender('Charlie Bank', 'not_signed_up'), lender('Delta Lending'), lender('Echo Mortgage')],
  programs: [
    // Lots of room, DTI well under the max.
    program('Alpha Wholesale', 'Conv 30 Fixed', { cells: [cell({ ...base, ficoMin: 620, maxLtv: 97 })], rules: [rule({ field: 'dti', op: '<=', value: 50, message: 'Max DTI 50%' })] }),
    // At the LTV limit, DTI near its max.
    program('Bravo TPO', 'Conv Fixed', { cells: [cell({ ...base, ficoMin: 620, maxLtv: 90 })], rules: [rule({ field: 'dti', op: '<=', value: 45, message: 'Max DTI 45%' })] }),
    // Near miss: one failure (LTV max 85%).
    program('Charlie Bank', 'Conforming 30', { cells: [cell({ ...base, ficoMin: 620, maxLtv: 85 })] }),
    // Excluded: doesn't lend in Texas.
    program('Delta Lending', 'FHA 30', { family: 'fha', cells: [cell({ ...base, ficoMin: 580, maxLtv: 96.5 })] }),
    // VA: only for a VA-eligible borrower.
    program('Echo Mortgage', 'VA 30', { family: 'va', cells: [cell({ ...base, ficoMin: 580, maxLtv: 100 })] }),
  ],
  overlays: [],
}
catalog.lenders[3] = { ...catalog.lenders[3], states: ['OK'] }

// Matching starts from the file's scenario widened to every product type.
const file = matchScenario(scenario({ purchasePrice: 400000, value: 400000, loanAmount: 360000, fico: 720, dti: 44, family: 'conventional' }))

describe('grades', () => {
  it('A 90+, B 80–89, C 70–79, D below', () => {
    expect([100, 90, 89, 80, 79, 70, 69].map(gradeFor)).toEqual(['A', 'A', 'B', 'B', 'C', 'C', 'D'])
  })
})

describe('match lenders', () => {
  const m = matchLenders(file, catalog, false)

  it('searches every product type, not just the file loan type', () => {
    expect(m.excluded.map((r) => r.result.program.name)).toContain('FHA 30')
  })
  it('leaves VA out unless the borrower is VA eligible', () => {
    const all = [...m.fits, ...m.nearMisses, ...m.excluded].map((r) => r.result.program.name)
    expect(all).not.toContain('VA 30')
    expect(matchLenders(file, catalog, true).fits.map((r) => r.result.program.name)).toContain('VA 30')
  })
  it('the parameters can narrow it: picking VA shows VA, picking Conventional shows only conventional', () => {
    expect(matchLenders({ ...file, family: 'va' }, catalog, false).fits.map((r) => r.result.program.name)).toEqual(['VA 30'])
    const conv = matchLenders({ ...file, family: 'conventional' }, catalog, false)
    expect([...conv.fits, ...conv.nearMisses, ...conv.excluded].every((r) => r.result.program.family === 'conventional')).toBe(true)
  })
  it('ranks fits by score: room and DTI headroom score higher', () => {
    expect(m.fits.map((r) => [r.result.program.name, r.score, r.grade])).toEqual([
      ['Conv 30 Fixed', 100, 'A'],
      ['Conv Fixed', 87, 'B'],
    ])
  })
  it('writes short reason lines', () => {
    expect(m.fits[0].lines).toEqual([
      { tone: 'pass', text: 'FICO 720 meets 620 min' },
      { tone: 'pass', text: 'LTV 90% · max 97%' },
      { tone: 'pass', text: 'DTI 44% · max 50%' },
    ])
    expect(m.fits[1].lines).toEqual([
      { tone: 'pass', text: 'FICO 720 meets 620 min' },
      { tone: 'limit', text: 'LTV 90% at max' },
      { tone: 'limit', text: 'DTI 44% near 45% max' },
    ])
  })
  it('a near miss fails exactly one thing and says by how much', () => {
    expect(m.nearMisses).toHaveLength(1)
    const n = m.nearMisses[0]
    expect(n.result.program.name).toBe('Conforming 30')
    expect(n.miss).toMatch(/^Max LTV 85% .*; scenario is 90%/)
    expect(n.score!).toBeLessThan(80)
    expect(n.lines).toContainEqual({ tone: 'limit', text: 'Lender: not signed up' })
  })
  it('excluded: a lender that does not lend in the state', () => {
    expect(m.excluded.map((r) => [r.result.program.name, r.score])).toEqual([['FHA 30', null]])
  })
  it('context line', () => {
    expect(matchContext(file, m, 'Conventional')).toBe('Purchase · Conventional · 720 FICO · 90% LTV · TX · 2 programs fit · 1 near miss')
  })
  it('family chips only for types with a fit or near miss', () => {
    expect(matchFamilies(m)).toEqual(['conventional'])
  })
  it('unknown DTI is a Verify line and costs points, never a failure', () => {
    const r = matchLenders({ ...file, dti: null }, catalog, false)
    const alpha = r.fits.find((x) => x.result.program.name === 'Conv 30 Fixed')!
    expect(alpha.lines).toContainEqual({ tone: 'verify', text: 'Verify: Max DTI 50%' })
    expect(alpha.score).toBe(97)
  })
})

describe('hot programs', () => {
  it('only the programs Hot for the type they are matched as, in every group', () => {
    const hot = new Map([['Bravo TPO · Conv Fixed', ['conventional']], ['Delta Lending · FHA 30', ['fha']], ['Alpha Wholesale · Conv 30 Fixed', ['fha']]])
    const m = onlyHot(matchLenders(file, catalog, false), hot, file)
    expect([m.fits, m.nearMisses, m.excluded].map((g) => g.map((r) => r.result.program.name))).toEqual([['Conv Fixed'], [], ['FHA 30']])
  })
  it('hot first in a list, order kept otherwise', () => {
    const list = ['a', 'b', 'c', 'd'].map((programId) => ({ programId }))
    expect(hotFirst(list, new Set(['c', 'a'])).map((p) => p.programId)).toEqual(['a', 'c', 'b', 'd'])
  })
})

describe('short lines', () => {
  it('keeps two Verify lines and counts the rest, with the failure still shown', () => {
    const lines = [
      { tone: 'pass' as const, text: 'FICO 680 meets 620 min' },
      { tone: 'verify' as const, text: 'Verify: a' },
      { tone: 'verify' as const, text: 'Verify: b' },
      { tone: 'verify' as const, text: 'Verify: c' },
      { tone: 'verify' as const, text: 'Verify: d' },
      { tone: 'fail' as const, text: 'Max LTV 95%; scenario is 96.5%' },
    ]
    expect(shortLines(lines).map((l) => l.text)).toEqual(['FICO 680 meets 620 min', 'Verify: a', 'Verify: b', '+2 more to verify', 'Max LTV 95%; scenario is 96.5%'])
    expect(shortLines(lines.slice(0, 3))).toHaveLength(3)
  })
})

describe('the golden conventional catalog', () => {
  it('every searched program lands in exactly one group', () => {
    const m = matchLenders(matchScenario(conventionalPurchase), conventionalCatalog, false)
    const counted = m.fits.length + m.nearMisses.length + m.excluded.length
    expect(counted + m.notSearched).toBe(conventionalCatalog.programs.length)
    expect(m.fits.every((r) => r.result.eligible)).toBe(true)
  })
})
