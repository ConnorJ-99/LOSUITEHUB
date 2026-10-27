// Golden tests for the Product Search engine. Lenders are fictional; the
// scenarios and expected answers come from the mockups and the Marcus case.

import { describe, expect, it } from 'vitest'
import { evaluateProgram, missingForSearch, search } from './engine'
import { cell, conventionalCatalog, conventionalPurchase, dscrCatalog, dscrSecond, lender, marcus, marcusCatalog, program, rule, scenario } from './testCatalog'
import type { Catalog, SearchResult } from './types'

const names = (rs: SearchResult['eligible']) => rs.map((r) => `${r.lender.name} · ${r.program.name}`)
const find = (r: SearchResult, name: string) => [...r.eligible, ...r.ineligible].find((x) => x.program.name === name)!

describe('mockup 02: DSCR closed-end second, 4-plex, $640K value, $310K 1st, $120K 2nd, 704', () => {
  const r = search(dscrSecond, dscrCatalog)

  it('CLTV is 67.19% (unrounded inside)', () => {
    expect(r.ratios.cltv).toBeCloseTo(67.1875, 6)
  })
  it('Keystone fits: CLTV 67.19% of 70% max, $18,000 of room', () => {
    expect(names(r.eligible)).toEqual(['Keystone Non-QM · DSCR Closed-End Second · 30-yr'])
    const k = r.eligible[0]
    expect(k.limit).toMatchObject({ ratio: 'cltv', max: 70, limitedBy: 'matrix', roomDollars: 18000 })
    expect(k.limit!.roomPts).toBeCloseTo(2.8125, 6)
    expect(k.maxLoan).toBe(138000)
    expect(k.cell).toMatchObject({ ficoMin: 700, ficoMax: 719, maxCltv: 70 })
  })
  it('Harbor Point is close: fits at $106,000 (−$14,000); not signed up', () => {
    const h = find(r, 'Investor Equity 2nd (DSCR)')
    expect(h.lender.status).toBe('not_signed_up')
    expect(h.reasons).toHaveLength(1)
    expect(h.reasons[0]).toMatchObject({ kind: 'ratio', message: 'Max CLTV 65% at 700–719; scenario is 67.19%', fix: { text: 'Lower loan amount to $106,000 (−$14,000)', loanAmount: 106000 }, unfixable: false })
  })
  it('Summit is close: 2–4 units need 720, and no loan amount fixes it', () => {
    const s = find(r, 'DSCR Second Lien Select')
    expect(s.reasons).toHaveLength(1)
    expect(s.reasons[0]).toMatchObject({ kind: 'not_offered', message: 'Not offered at 660–719', fix: { text: 'Needs 720 FICO (+16)', fico: 720 } })
  })
  it('the not-eligible list is ranked by fewest reasons, then the smallest gap', () => {
    expect(r.ineligible.map((x) => x.program.name)).toEqual(['DSCR Second Lien Select', 'Investor Equity 2nd (DSCR)'])
  })
})

describe('mockups 03 and 04: conventional purchase, $400K, 5% down, 720, first-time buyer', () => {
  const r = search(conventionalPurchase, conventionalCatalog)

  it('four programs fit; approved lenders first, the not-signed-up lender last', () => {
    expect(names(r.eligible)).toEqual([
      'Northline Wholesale · Conventional 30-Year Fixed',
      'Pinecrest TPO · Conventional Fixed 30',
      'Ardent Mortgage · Conventional 30-Year Fixed',
      'Lakeline Wholesale · Conventional 30 Fixed',
    ])
    expect(r.eligible.at(-1)!.lender.status).toBe('not_signed_up')
  })
  it('at the limit still fits: Ardent, LTV 95% of 95% max', () => {
    expect(find(r, 'Conventional 30-Year Fixed') && r.eligible[2].limit).toMatchObject({ max: 95, roomDollars: 0 })
    expect(r.eligible[2].limit!.roomPts).toBeCloseTo(0, 9)
  })
  it("mockup 04: the borrower's cell is 720–739, primary 1-unit, 97%, from page 1", () => {
    const n = r.eligible[0]
    expect(n.cell).toMatchObject({ ficoMin: 720, ficoMax: 739, maxLtv: 97, sourcePage: 1 })
    expect(n.limit).toMatchObject({ ratio: 'ltv', max: 97, roomDollars: 8000 })
    expect(n.checklist.map((c) => [c.message, c.status, c.value])).toEqual([
      ['Max DTI 50% (DU Approve/Eligible)', 'pass', '38%'],
      ['Reserves per DU findings', 'pass', '3'],
      ['Above 95% LTV, at least one borrower must be a first-time buyer', 'na', 'Yes'],
    ])
  })
  it('badges: best fit, highest max loan and lowest FICO floor go to different cards on a tie', () => {
    expect(r.eligible.map((x) => x.badges)).toEqual([['best_fit'], ['highest_max_loan'], [], ['lowest_fico_floor']])
  })
  it('Crestview: max LTV 90% on purchases; fits with 10% down ($40,000)', () => {
    const c = find(r, 'Conforming Fixed')
    expect(c.reasons[0]).toMatchObject({ message: 'Max LTV 90% at 620+; scenario is 95%', fix: { text: 'Fits with 10% down ($40,000)', loanAmount: 360000 } })
  })
  it("HomeReady: income over 80% of AMI, and no change in this scenario fixes it", () => {
    const h = find(r, 'Conventional HomeReady')
    expect(h.reasons[0]).toMatchObject({ kind: 'rule', unfixable: true, fix: null, message: 'Income limit 80% of area median income ($92,400 in Collin County); scenario is 127.71%' })
    expect(r.ineligible.map((x) => x.program.name)).toEqual(['Conforming Fixed', 'Conventional HomeReady'])
  })
  it('3 programs of other types were not searched (DPA, FHA, a 2nd lien)', () => {
    expect(r.searchedCount).toBe(6)
    expect(r.notSearched).toEqual({ count: 3, families: { conventional: 2, fha: 1 } })
  })
  it('above 95% LTV without a first-time buyer fails the rule, and 5% down fixes it', () => {
    const n = evaluateProgram(conventionalCatalog.programs[0], conventionalCatalog.lenders[0], { ...conventionalPurchase, loanAmount: 386000, firstTimeBuyer: false })
    expect(n.eligible).toBe(false)
    expect(n.reasons).toEqual([expect.objectContaining({ kind: 'rule', message: 'Above 95% LTV, at least one borrower must be a first-time buyer; scenario is No', fix: { text: 'Fits with 5% down ($20,000)', loanAmount: 380000 } })])
  })
  it('a blank ("—") cell is not offered, never 0 and never a fit', () => {
    const inv = { ...conventionalPurchase, occupancy: 'investment' as const, fico: 640, loanAmount: 280000 }
    const n = evaluateProgram(conventionalCatalog.programs[0], conventionalCatalog.lenders[0], inv)
    expect(n.eligible).toBe(false)
    expect(n.limit).toBeNull()
    expect(n.reasons[0]).toMatchObject({ kind: 'not_offered', message: 'Not offered at 620–659', fix: { text: 'Needs 660 FICO (+20)', fico: 660 } })
    expect(n.reasons[0].trace?.page).toBe(1)
  })
})

describe('Marcus: closed-end second, bank statement, 652, $467K value, $282K 1st, $75K, Texas homestead', () => {
  const r = search(marcus, marcusCatalog)

  it('CLTV 76.45%; the HELOC is a different product and is not searched', () => {
    expect(r.ratios.cltv).toBeCloseTo(76.4454, 4)
    expect(r.notSearched.count).toBe(1)
  })
  it('three fit, with the Texas 80% cap and max cash worked out across tiers', () => {
    expect(names(r.eligible)).toEqual(['Cypress Lending · Bank Statement 2nd', 'Lonestar Equity · Equity Flex CES', 'Northgate Funding · Alt-Doc CES'])
    const [cypress, lonestar, northgate] = r.eligible
    expect(lonestar.limit).toMatchObject({ max: 80, limitedBy: 'matrix', roomDollars: 16600 })
    expect(lonestar.limit!.roomPts).toBeCloseTo(3.5546, 4)
    expect(lonestar.maxLoan).toBe(91600)
    expect(cypress.limit).toMatchObject({ max: 80, limitedBy: 'texas' })
    expect(cypress.maxLoan).toBe(91600)
    expect(northgate.maxLoan).toBe(82260)
    expect(northgate.limit!.roomPts).toBeCloseTo(1.5546, 4)
  })
  it('reserves unknown is Verify and never blocks', () => {
    const lonestar = r.eligible[1]
    expect(lonestar.eligible).toBe(true)
    expect(lonestar.checklist).toEqual([expect.objectContaining({ message: 'Three months of reserves', status: 'verify', value: null })])
  })
  it('badges land on three different cards', () => {
    expect(r.eligible.map((x) => x.badges)).toEqual([['best_fit'], ['highest_max_loan'], ['lowest_fico_floor']])
  })
  it('Cypress Prime is the closest fit: lower loan amount to $68,250 (−$6,750)', () => {
    expect(r.ineligible[0].program.name).toBe('Prime 2nd')
    expect(r.ineligible[0].reasons[0]).toMatchObject({ message: 'Max CLTV 75% at 640–659; scenario is 76.45%', fix: { text: 'Lower loan amount to $68,250 (−$6,750)', loanAmount: 68250 } })
  })
  it('Northgate Prime: needs 680 FICO (+28), no loan-amount change fixes it; ranked second (4.1% gap vs 1.9%)', () => {
    const n = r.ineligible[1]
    expect(n.program.name).toBe('Prime CES')
    expect(n.reasons[0]).toMatchObject({ kind: 'fico', fix: { text: 'Needs 680 FICO (+28); no loan-amount change fixes this', fico: 680 } })
    expect(n.reasons[0].gap).toBeCloseTo(28 / 680, 6)
    expect(r.ineligible[0].reasons[0].gap).toBeCloseTo(1.4454 / 75, 4)
  })
  it('no Texas cap when the home is not a homestead, or the loan is not cash-out', () => {
    const notHomestead = search({ ...marcus, homestead: false }, marcusCatalog).eligible.find((x) => x.program.name === 'Bank Statement 2nd')!
    expect(notHomestead.limit).toMatchObject({ max: 85, limitedBy: 'matrix' })
    expect(notHomestead.maxLoan).toBe(114950)
    expect(search({ ...marcus, state: 'OK' }, { ...marcusCatalog, lenders: marcusCatalog.lenders.map((l) => ({ ...l, states: null })) }).eligible.find((x) => x.program.name === 'Bank Statement 2nd')!.limit!.limitedBy).toBe('matrix')
  })
  it('a company overlay applies to every program and is marked as an overlay', () => {
    const withOverlay: Catalog = { ...marcusCatalog, overlays: [rule({ field: 'fico', op: '>=', value: 680, message: 'Company minimum 680', overlay: true, sourcePage: null })] }
    const o = search(marcus, withOverlay)
    expect(o.eligible).toHaveLength(0)
    const lonestar = o.ineligible.find((x) => x.program.name === 'Equity Flex CES')!
    expect(lonestar.reasons).toEqual([expect.objectContaining({ message: 'Company minimum 680; scenario is 652', fix: { text: 'Needs 680 FICO (+28)', fico: 680 } })])
    expect(lonestar.checklist.find((c) => c.overlay)?.status).toBe('fail')
  })
})

describe('edges', () => {
  const tiered = program('Edge Bank', 'Tiered', {
    cells: [cell({ ficoMin: 680, ficoMax: 850, loanAmountMax: 150000, maxLtv: 80, sourcePage: 2 }), cell({ ficoMin: 680, ficoMax: 850, loanAmountMin: 150001, maxLtv: 70, sourcePage: 2 }), cell({ ficoMin: 640, ficoMax: 679, maxLtv: 75, sourcePage: 2 })],
  })
  const edge = lender('Edge Bank')
  const s = scenario({ purpose: 'rate_term', value: 200000, loanAmount: 150000, fico: 680 })

  it('$150,000 is in the ≤$150K tier; $150,001 is in the next tier', () => {
    expect(evaluateProgram(tiered, edge, s).limit?.max).toBe(80)
    const over = evaluateProgram(tiered, edge, { ...s, loanAmount: 150001 })
    expect(over.limit?.max).toBe(70)
    expect(over.reasons[0].fix).toEqual({ text: 'Lower loan amount to $150,000 (−$1)', loanAmount: 150000 })
  })
  it('credit 679 is in the 640–679 band, 680 in the 680+ band', () => {
    expect(evaluateProgram(tiered, edge, { ...s, fico: 679, loanAmount: 140000 }).cell?.maxLtv).toBe(75)
    expect(evaluateProgram(tiered, edge, { ...s, loanAmount: 140000 }).cell?.maxLtv).toBe(80)
  })
  it('exactly at the max fits', () => {
    const one = program('Edge Bank', 'One', { cells: [cell({ maxLtv: 80 })] })
    expect(evaluateProgram(one, edge, { ...s, loanAmount: 160000 }).eligible).toBe(true)
    expect(evaluateProgram(one, edge, { ...s, loanAmount: 160001 }).eligible).toBe(false)
  })
  it('overlapping cells: the lower limit wins', () => {
    const overlap = program('Edge Bank', 'Overlap', { cells: [cell({ maxLtv: 85 }), cell({ ficoMin: 700, maxLtv: 80 })] })
    expect(evaluateProgram(overlap, edge, { ...s, fico: 720, loanAmount: 165000 }).limit?.max).toBe(80)
  })
  it("a lender that doesn't lend in the state", () => {
    const one = program('Edge Bank', 'One', { cells: [cell({ maxLtv: 80 })] })
    expect(evaluateProgram(one, lender('Edge Bank', 'approved', ['OK']), s).reasons[0]).toMatchObject({ kind: 'state', message: "Edge Bank doesn't lend in TX", unfixable: true })
  })
  it('asks for a credit score (and other basics) before searching', () => {
    expect(missingForSearch({ ...s, fico: null })).toEqual(['credit score'])
    expect(missingForSearch({ ...dscrSecond, firstLienBalance: 0 })).toEqual(['1st lien balance'])
  })
})

describe('every result traces to a matrix cell or a rule with its source page', () => {
  for (const [label, r] of [
    ['DSCR', search(dscrSecond, dscrCatalog)],
    ['conventional', search(conventionalPurchase, conventionalCatalog)],
    ['Marcus', search(marcus, marcusCatalog)],
  ] as const) {
    it(label, () => {
      for (const e of r.eligible) expect(e.cell?.sourcePage, e.program.name).not.toBeNull()
      for (const i of r.ineligible) for (const reason of i.reasons) if (reason.kind !== 'fico') expect(reason.trace?.page, `${i.program.name}: ${reason.message}`).not.toBeNull()
      for (const x of [...r.eligible, ...r.ineligible]) for (const c of x.checklist) expect(c.trace.page ?? c.overlay, c.message).toBeTruthy()
    })
  }
})

describe('speed', () => {
  it('searches 300 programs with 30,000 cells in well under a second', () => {
    const lenders = Array.from({ length: 20 }, (_, i) => lender(`Lender ${i}`))
    const programs = Array.from({ length: 300 }, (_, i) =>
      program(`Lender ${i % 20}`, `Program ${i}`, {
        cells: Array.from({ length: 100 }, (_, j) => cell({ ficoMin: 600 + (j % 10) * 20, ficoMax: 619 + (j % 10) * 20, loanAmountMin: Math.floor(j / 10) * 100000, loanAmountMax: Math.floor(j / 10) * 100000 + 99999, maxLtv: 80 + (j % 10) })),
      }),
    )
    const started = performance.now()
    const r = search(scenario({ value: 500000, loanAmount: 350000, fico: 700 }), { lenders, programs, overlays: [] })
    expect(performance.now() - started).toBeLessThan(1000)
    expect(r.searchedCount).toBe(300)
  })
})

describe('a purchase price left over from editing', () => {
  it('never counts on a refinance or a 2nd lien', () => {
    expect(search({ ...dscrSecond, purchasePrice: 400000 }, dscrCatalog).ratios.cltv).toBeCloseTo(67.1875, 6)
    expect(search({ ...conventionalPurchase, purpose: 'rate_term', value: 500000 }, conventionalCatalog).ratios.ltv).toBe(76)
  })
})
