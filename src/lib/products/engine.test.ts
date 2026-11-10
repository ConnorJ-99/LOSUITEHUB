// Golden tests for the Product Search engine. Lenders are fictional; the
// scenarios and expected answers come from the mockups and the Marcus case.

import { describe, expect, it } from 'vitest'
import { evaluateProgram, missingForSearch, search } from './engine'
import { cell, conventionalCatalog, conventionalPurchase, dscrCatalog, dscrSecond, lender, marcus, marcusCatalog, program, rule, scenario } from './testCatalog'
import type { Catalog, MatrixCell, SearchResult } from './types'

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
  it('grids by DSCR level: the highest level the DSCR reaches governs; unknown DSCR takes the lower limit', () => {
    const byDscr = program('Edge Bank', 'DSCR', { cells: [cell({ occupancy: 'investment', docType: 'dscr', dscrMin: 1, maxLtv: 80 }), cell({ occupancy: 'investment', docType: 'dscr', dscrMin: 0.75, maxLtv: 70 })] })
    const inv = { ...s, occupancy: 'investment' as const, docType: 'dscr' as const, loanAmount: 140000 }
    expect(evaluateProgram(byDscr, edge, { ...inv, dscr: 1.2 }).limit?.max).toBe(80)
    expect(evaluateProgram(byDscr, edge, { ...inv, dscr: 0.8 }).limit?.max).toBe(70)
    expect(evaluateProgram(byDscr, edge, { ...inv, dscr: 0.6 }).eligible).toBe(false)
    expect(evaluateProgram(byDscr, edge, { ...inv, dscr: null }).limit?.max).toBe(70)
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

// A DSCR ≥ 1.00 matrix printed as a row list: a maximum loan amount, a minimum credit score and a max LTV per row.
describe('loan-amount tiers printed as maximums (row-list matrix)', () => {
  const rows: [loanMax: number, ficoMin: number, purchaseRateTerm: number, cashOut: number][] = [
    [500000, 640, 75, 70],
    [1000000, 720, 80, 80],
    [1500000, 700, 80, 75],
    [1500000, 660, 75, 70],
    [2000000, 700, 75, 70],
    [2000000, 660, 70, 65],
    [2500000, 700, 70, 65],
    [2500000, 660, 65, 60],
    [3000000, 720, 70, 65],
    [3000000, 700, 65, 60],
    [3000000, 660, 60, 60],
  ]
  const base = { occupancy: 'investment' as const, docType: 'dscr' as const, dscrMin: 1, ficoMax: 850, loanAmountMode: 'max_tiers' as const, creditMode: 'minimums' as const, blankMode: 'not_specified' as const, sourcePage: 2 }
  const asTiers = () =>
    rows.flatMap(([loanAmountMax, ficoMin, prt, co]) => [cell({ ...base, purposes: ['purchase', 'rate_term'], loanAmountMax, ficoMin, maxLtv: prt }), cell({ ...base, purposes: ['cash_out'], loanAmountMax, ficoMin, maxLtv: co })])
  const rules = [
    rule({ field: 'loan_amount', op: '>=', value: 125000, message: 'Minimum loan amount $125,000' }),
    rule({ field: 'ltv', op: '<=', value: 70, appliesWhen: { loan_amount_below: 150000 }, message: 'Loan amounts under $150,000 max 70% LTV' }),
  ]
  const bank = lender('Tier Bank')
  const dscr = program('Tier Bank', 'DSCR 1.00+', { family: 'non_qm', docTypes: ['dscr'], cells: asTiers(), rules })
  // Unless a value is given, the loan is at 50% LTV: the answer under test is the maximum, not this scenario's ratio.
  const at = (fico: number, loanAmount: number, purpose: 'rate_term' | 'cash_out' = 'rate_term', value = loanAmount * 2) => evaluateProgram(dscr, bank, scenario({ family: 'non_qm', docType: 'dscr', occupancy: 'investment', dscr: 1.1, purpose, fico, loanAmount, value }))
  const maxes = (fico: number, loanAmount: number) => [at(fico, loanAmount).limit?.max, at(fico, loanAmount, 'cash_out').limit?.max]

  it('720 FICO, $400,000: 80% from the $1,000,000 row (not the $500,000 row), cash-out 80%', () => {
    expect(maxes(720, 400000)).toEqual([80, 80])
    expect(at(720, 400000).limit?.why).toBe('80% via the $1,000,000 tier at 720+ FICO')
    expect(at(720, 400000).eligible).toBe(true)
  })
  it('700 FICO, $750,000: 80% from the $1,500,000 row (not "not offered"), cash-out 75%', () => {
    expect(maxes(700, 750000)).toEqual([80, 75])
    expect(at(700, 750000).limit?.why).toBe('80% via the $1,500,000 tier at 700+ FICO')
  })
  it('700 FICO, $400,000: 80%', () => {
    expect(at(700, 400000).limit?.max).toBe(80)
  })
  it('660 FICO, $1,200,000: 75% / 70%', () => {
    expect(maxes(660, 1200000)).toEqual([75, 70])
  })
  it('640 FICO, $600,000: not eligible; lower the loan to $500,000 or score 660+', () => {
    const r = at(640, 600000, 'rate_term', 800000)
    expect(r.eligible).toBe(false)
    expect(r.reasons).toEqual([expect.objectContaining({ kind: 'loan_amount', message: '640–659 FICO maxes at $500,000', fix: { text: 'Lower loan amount to $500,000 (−$100,000) or score 660+', loanAmount: 500000, fico: 660 }, unfixable: false })])
  })
  it('$2,800,000: 720 FICO 70% / 65%; 660 FICO 60% / 60%', () => {
    expect(maxes(720, 2800000)).toEqual([70, 65])
    expect(maxes(660, 2800000)).toEqual([60, 60])
  })
  it('700 FICO, $140,000: 70%, the small-loan cap on top of the 80% tier', () => {
    const r = at(700, 140000)
    expect(r.limit).toMatchObject({ max: 70, limitedBy: 'rule', why: '70%: Loan amounts under $150,000 max 70% LTV (the matrix allows 80% via the $1,500,000 tier at 700+ FICO)' })
    expect(r.eligible).toBe(true)
    // Over the cap: one reason (the cap), and the fix is a loan that fits under it.
    const over = at(700, 140000, 'rate_term', 190000)
    expect(over.reasons).toEqual([expect.objectContaining({ kind: 'ratio', message: 'Loan amounts under $150,000 max 70% LTV; scenario is 73.68%', fix: { text: 'Lower loan amount to $133,000 (−$7,000)', loanAmount: 133000 } })])
  })
  it('$120,000: not eligible, below the $125,000 minimum', () => {
    const r = at(700, 120000)
    expect(r.eligible).toBe(false)
    expect(r.reasons.map((x) => x.message)).toEqual(['Minimum loan amount $125,000; scenario is $120,000'])
  })
  it('fixes use the same tiers: over the limit at 700 / $750,000 suggests the loan that fits at 80%, never a gap', () => {
    const r = at(700, 750000, 'rate_term', 900000)
    expect(r.reasons).toEqual([expect.objectContaining({ kind: 'ratio', message: 'Max LTV 80% via the $1,500,000 tier at 700+ FICO; scenario is 83.33%', fix: { text: 'Lower loan amount to $720,000 (−$30,000)', loanAmount: 720000 } })])
    expect(at(700, 400000).maxLoan).toBe(640000)
  })
  it('a state or property cap sits on top of the tier ("Florida condos max 75%")', () => {
    const capped = { ...dscr, rules: [...rules, rule({ field: 'ltv', op: '<=', value: 75, appliesWhen: { states: ['FL'], property_types: ['condo'] }, message: 'Florida condos max 75% LTV' })], cells: asTiers().map((c) => ({ ...c, propertyTypes: ['sfr_pud', 'condo'] as MatrixCell['propertyTypes'] })) }
    const s = scenario({ family: 'non_qm', docType: 'dscr', occupancy: 'investment', dscr: 1.1, purpose: 'rate_term', fico: 720, loanAmount: 400000, value: 800000 })
    expect(evaluateProgram(capped, lender('Tier Bank', 'approved', null), { ...s, state: 'FL', propertyType: 'condo' }).limit).toMatchObject({ max: 75, limitedBy: 'rule' })
    expect(evaluateProgram(capped, bank, { ...s, propertyType: 'condo' }).limit).toMatchObject({ max: 80, limitedBy: 'matrix' })
  })
  it("the same table saved as printed ranges and credit bands keeps today's results (the gap stays until it is re-approved)", () => {
    const ranges: [number, number | null][] = [[0, 500000], [500001, 1000000], [1000001, 1500000]]
    const bands: [number, number, (number | null)[]][] = [[720, 850, [75, 80, 80]], [700, 719, [75, null, 80]], [660, 699, [75, null, 75]], [640, 659, [75, null, null]]]
    const old = program('Tier Bank', 'DSCR (ranges)', { family: 'non_qm', docTypes: ['dscr'], cells: bands.flatMap(([ficoMin, ficoMax, limits]) => ranges.map(([loanAmountMin, loanAmountMax], i) => cell({ occupancy: 'investment', docType: 'dscr', dscrMin: 1, ficoMin, ficoMax, loanAmountMin, loanAmountMax, offered: limits[i] != null, maxLtv: limits[i] }))) })
    const s = scenario({ family: 'non_qm', docType: 'dscr', occupancy: 'investment', dscr: 1.1, purpose: 'rate_term', fico: 700, loanAmount: 750000, value: 1500000 })
    expect(evaluateProgram(old, bank, s).reasons[0]).toMatchObject({ kind: 'not_offered', message: 'Not offered at 700–719 up to $1,000,000' })
    expect(evaluateProgram(old, bank, { ...s, fico: 720, loanAmount: 400000, value: 800000 }).limit?.max).toBe(75)
  })
  it('overlapping circumstances still use the lower limit (a condo cell and a cash-out cell both apply)', () => {
    const tiers = { loanAmountMode: 'max_tiers' as const, creditMode: 'minimums' as const, blankMode: 'not_specified' as const }
    const overlap = program('Tier Bank', 'Overlap', {
      cells: [
        cell({ ...tiers, propertyTypes: ['sfr_pud', 'condo'], purposes: ['cash_out'], ficoMin: 700, loanAmountMax: 1000000, maxLtv: 75 }),
        cell({ ...tiers, propertyTypes: ['sfr_pud', 'condo'], purposes: ['cash_out'], ficoMin: 700, loanAmountMax: 2000000, maxLtv: 70 }),
        cell({ ...tiers, propertyTypes: ['condo'], ficoMin: 680, loanAmountMax: 1500000, maxLtv: 65 }),
      ],
    })
    const s = scenario({ purpose: 'cash_out', fico: 720, loanAmount: 400000, value: 800000 })
    // Cash-out alone: the best tier (75%). On a condo, the condo cell also applies and is lower.
    expect(evaluateProgram(overlap, bank, s).limit?.max).toBe(75)
    expect(evaluateProgram(overlap, bank, { ...s, propertyType: 'condo' }).limit?.max).toBe(65)
  })
  it('a blank set to "not offered" still blocks; set to "not specified" another tier covers it', () => {
    const blank = (blankMode: 'not_offered' | 'not_specified') =>
      program('Tier Bank', 'Blank', {
        cells: [
          cell({ loanAmountMode: 'max_tiers', creditMode: 'minimums', blankMode, ficoMin: 700, loanAmountMax: 1000000, offered: false }),
          cell({ loanAmountMode: 'max_tiers', creditMode: 'minimums', blankMode, ficoMin: 700, loanAmountMax: 1500000, maxLtv: 80 }),
        ],
      })
    const s = scenario({ purpose: 'rate_term', fico: 700, loanAmount: 750000, value: 1500000 })
    const blocked = evaluateProgram(blank('not_offered'), bank, s)
    expect(blocked.eligible).toBe(false)
    expect(blocked.reasons[0]).toMatchObject({ kind: 'not_offered' })
    expect(evaluateProgram(blank('not_specified'), bank, s).limit?.max).toBe(80)
    // Above the blank's tier, the $1,500,000 tier applies either way.
    expect(evaluateProgram(blank('not_offered'), bank, { ...s, loanAmount: 1200000, value: 2400000 }).limit?.max).toBe(80)
  })
})
