// Written first (Connor's non-negotiable): the product-type gate runs before
// anything else, so a DSCR closed-end second never evaluates FHA, VA,
// conventional, 1st-lien or DPA programs, even when their cells would fit.

import { describe, expect, it } from 'vitest'
import { gate, passesGate, search } from './engine'
import { isDpaProgram } from './taxonomy'
import { conventionalCatalog, conventionalPurchase, dscrCatalog, dscrSecond, program, scenario } from './testCatalog'

const names = (programs: { name: string }[]) => programs.map((p) => p.name).sort()
const shown = (r: ReturnType<typeof search>) => [...r.eligible, ...r.ineligible].map((x) => x.program.name)

describe('product-type gate', () => {
  it('a DSCR closed-end second never evaluates FHA, VA, conventional, 1st-lien, HELOC or DPA programs', () => {
    const lenders = new Map(dscrCatalog.lenders.map((l) => [l.id, l]))
    const { searched } = gate(dscrSecond, dscrCatalog.programs, lenders)
    expect(names(searched)).toEqual(['DSCR Closed-End Second · 30-yr', 'DSCR Second Lien Select', 'Investor Equity 2nd (DSCR)'])

    const result = search(dscrSecond, dscrCatalog)
    expect(shown(result).some((n) => n.includes('trap'))).toBe(false)
    expect(result.searchedCount).toBe(3)
    expect(result.notSearched.count).toBe(7)
    expect(result.notSearched.families).toEqual({ fha: 1, va: 1, conventional: 1, non_qm: 4 })
  })

  it('a conventional purchase leaves out DPA unless DPA is asked for', () => {
    const lenders = new Map(conventionalCatalog.lenders.map((l) => [l.id, l]))
    expect(names(gate(conventionalPurchase, conventionalCatalog.programs, lenders).searched)).not.toContain('Conventional with DPA')
    const withDpa = gate({ ...conventionalPurchase, features: ['dpa'] }, conventionalCatalog.programs, lenders).searched
    expect(names(withDpa)).toEqual(['Conventional with DPA'])
  })

  it('"Any" product family widens the family but keeps lien and doc type', () => {
    const lenders = new Map(conventionalCatalog.lenders.map((l) => [l.id, l]))
    const any = names(gate({ ...conventionalPurchase, family: 'any' }, conventionalCatalog.programs, lenders).searched)
    expect(any).toContain('FHA 30-Year Fixed')
    expect(any).not.toContain('Conventional Closed-End Second')
    expect(any).not.toContain('Conventional with DPA')
  })

  it('a HELOC search only looks at HELOCs', () => {
    const lenders = new Map(dscrCatalog.lenders.map((l) => [l.id, l]))
    expect(names(gate({ ...dscrSecond, lien: 'heloc' }, dscrCatalog.programs, lenders).searched)).toEqual(['DSCR HELOC (trap)'])
  })

  it('inactive programs and inactive lenders are never searched', () => {
    const catalog = { ...dscrCatalog, lenders: dscrCatalog.lenders.map((l) => (l.name === 'Summit Wholesale' ? { ...l, status: 'inactive' as const } : l)), programs: dscrCatalog.programs.map((p) => (p.lenderId === 'Keystone Non-QM' ? { ...p, active: false } : p)) }
    expect(shown(search(dscrSecond, catalog))).toEqual(['Investor Equity 2nd (DSCR)'])
  })
})

describe('DPA as an option, not the program', () => {
  it('a regular FHA program with a DPA option shows in a normal search; a dedicated DPA program only when asked', () => {
    const fha = program('A&D Mortgage', 'FHA', { family: 'fha', features: ['dpa'] })
    const dpa = program('Click n Close', 'SmartBuy DPA', { family: 'fha', features: ['dpa'] })
    const lender = new Map([['A&D Mortgage', { id: 'A&D Mortgage', name: 'A&D Mortgage', status: 'approved' as const, states: null }], ['Click n Close', { id: 'Click n Close', name: 'Click n Close', status: 'approved' as const, states: null }]])
    const s = scenario({ family: 'fha', lien: 'first', docType: 'full_doc' })
    expect(passesGate(fha, s, lender.get('A&D Mortgage'))).toBe(true)
    expect(passesGate(dpa, s, lender.get('Click n Close'))).toBe(false)
    expect(passesGate(dpa, { ...s, features: ['dpa'] }, lender.get('Click n Close'))).toBe(true)
  })
  it('DPA products named without "DPA" (MaxONE, Home Sweet Texas, 3.5% Forgivable) are still DPA programs', () => {
    for (const name of ['MaxONE', 'MaxONE Plus', 'Home Sweet Texas - FHA', '3.5% Forgivable', '3.5% Repayable', 'TDHCA HFA'])
      expect(isDpaProgram({ name, features: ['dpa'] }), name).toBe(true)
    // Without the DPA feature, a name alone doesn't make one.
    expect(isDpaProgram({ name: 'MaxONE', features: [] })).toBe(false)
    expect(isDpaProgram({ name: 'FHA', features: ['dpa'] })).toBe(false)
  })
})
