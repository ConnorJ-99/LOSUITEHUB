// Fictional lenders and programs for the engine's golden tests (all names and
// numbers are sample data). Shaped like the Product Search mockups and the
// Marcus case from the 2026-10-25 design.

import type { Catalog, CatalogLender, CatalogProgram, MatrixCell, ProgramRule, Scenario } from './types'

let seq = 0
const id = (prefix: string) => `${prefix}-${++seq}`

export const lender = (name: string, status: CatalogLender['status'] = 'approved', states: string[] | null = ['TX']): CatalogLender => ({ id: name, name, status, states })

export function cell(over: Partial<MatrixCell>): MatrixCell {
  return {
    id: id('cell'),
    occupancy: 'primary',
    propertyTypes: ['sfr_pud'],
    purposes: ['purchase', 'rate_term', 'cash_out'],
    docType: 'full_doc',
    unitsMin: 1,
    unitsMax: 4,
    ficoMin: 620,
    ficoMax: 850,
    loanAmountMin: 0,
    loanAmountMax: null,
    dscrMin: null,
    citizenship: null,
    offered: true,
    maxLtv: null,
    maxCltv: null,
    maxDti: null,
    reservesMonths: null,
    sourcePage: 1,
    notes: null,
    ...over,
  }
}

/** Credit bands for one column of a grid: [ficoMin, ficoMax, limit or null for "—"]. */
export function column(base: Partial<MatrixCell>, bands: [number, number, number | null][], ratio: 'maxLtv' | 'maxCltv' = 'maxLtv'): MatrixCell[] {
  return bands.map(([ficoMin, ficoMax, limit]) => cell({ ...base, ficoMin, ficoMax, offered: limit !== null, [ratio]: limit }))
}

export function rule(over: Partial<ProgramRule> & Pick<ProgramRule, 'field' | 'op' | 'message'>): ProgramRule {
  return { id: id('rule'), value: null, appliesWhen: null, severity: 'hard', sourcePage: 3, sourceQuote: null, ...over }
}

export function program(lenderId: string, name: string, over: Partial<CatalogProgram>): CatalogProgram {
  return {
    id: `${lenderId} · ${name}`,
    lenderId,
    name,
    family: 'conventional',
    lien: 'first',
    docTypes: ['full_doc'],
    features: [],
    purposes: ['purchase', 'rate_term', 'cash_out'],
    loanAmountBasis: 'this_lien',
    active: true,
    cells: [],
    rules: [],
    ...over,
  }
}

export function scenario(over: Partial<Scenario>): Scenario {
  return {
    lien: 'first',
    family: 'conventional',
    docType: 'full_doc',
    features: [],
    purpose: 'purchase',
    occupancy: 'primary',
    propertyType: 'sfr_pud',
    units: 1,
    state: 'TX',
    county: null,
    purchasePrice: null,
    value: 400000,
    loanAmount: 300000,
    firstLienBalance: 0,
    fico: 720,
    dti: null,
    reservesMonths: null,
    dscr: null,
    citizenship: 'us_citizen',
    mortgageLates12: 0,
    mortgageLates24: 0,
    bkSeasoningMonths: null,
    fcSeasoningMonths: null,
    selfEmployedYears: null,
    firstTimeBuyer: false,
    incomeVsAmiPct: null,
    homestead: false,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Mockup 02: DSCR closed-end second, plus "trap" programs that would fit the
// same scenario if the product-type gate were missing.
// ---------------------------------------------------------------------------

const dscrInvestment: Partial<MatrixCell> = { occupancy: 'investment', propertyTypes: ['sfr_pud', 'two_to_four'], purposes: ['cash_out'], docType: 'dscr', loanAmountMin: 50000, loanAmountMax: 500000 }
const everything: Partial<MatrixCell> = { occupancy: 'investment', propertyTypes: ['sfr_pud', 'two_to_four'], purposes: ['purchase', 'rate_term', 'cash_out'], maxLtv: 90, maxCltv: 90, ficoMin: 300 }

export const dscrCatalog: Catalog = {
  lenders: [lender('Keystone Non-QM'), lender('Harbor Point Lending', 'not_signed_up'), lender('Summit Wholesale'), lender('Trapdoor Lending')],
  programs: [
    program('Keystone Non-QM', 'DSCR Closed-End Second · 30-yr', { family: 'non_qm', lien: 'ces', docTypes: ['dscr'], features: ['llc_vesting'], cells: column(dscrInvestment, [[720, 850, 75], [700, 719, 70], [680, 699, 65]], 'maxCltv') }),
    program('Harbor Point Lending', 'Investor Equity 2nd (DSCR)', { family: 'non_qm', lien: 'ces', docTypes: ['dscr'], cells: column(dscrInvestment, [[720, 850, 70], [700, 719, 65], [660, 699, 60]], 'maxCltv') }),
    program('Summit Wholesale', 'DSCR Second Lien Select', {
      family: 'non_qm',
      lien: 'ces',
      docTypes: ['dscr'],
      cells: [
        ...column({ ...dscrInvestment, propertyTypes: ['sfr_pud'], unitsMin: 1, unitsMax: 1 }, [[660, 850, 70]], 'maxCltv'),
        ...column({ ...dscrInvestment, propertyTypes: ['two_to_four'], unitsMin: 2, unitsMax: 4 }, [[720, 850, 70], [660, 719, null]], 'maxCltv'),
      ],
    }),
    // Traps: each one's cells would fit the DSCR second scenario.
    program('Trapdoor Lending', 'FHA 30 (trap)', { family: 'fha', lien: 'ces', docTypes: ['dscr'], cells: [cell({ ...everything, docType: 'dscr' })] }),
    program('Trapdoor Lending', 'VA 30 (trap)', { family: 'va', lien: 'ces', docTypes: ['dscr'], cells: [cell({ ...everything, docType: 'dscr' })] }),
    program('Trapdoor Lending', 'Conventional 2nd (trap)', { family: 'conventional', lien: 'ces', docTypes: ['dscr'], cells: [cell({ ...everything, docType: 'dscr' })] }),
    program('Trapdoor Lending', 'DSCR 1st lien (trap)', { family: 'non_qm', lien: 'first', docTypes: ['dscr'], cells: [cell({ ...everything, docType: 'dscr' })] }),
    program('Trapdoor Lending', 'DSCR HELOC (trap)', { family: 'non_qm', lien: 'heloc', docTypes: ['dscr'], cells: [cell({ ...everything, docType: 'dscr' })] }),
    program('Trapdoor Lending', 'DSCR 2nd with DPA (trap)', { family: 'non_qm', lien: 'ces', docTypes: ['dscr'], features: ['dpa'], cells: [cell({ ...everything, docType: 'dscr' })] }),
    program('Trapdoor Lending', 'Bank statement 2nd (trap)', { family: 'non_qm', lien: 'ces', docTypes: ['bank_statement_12'], cells: [cell({ ...everything, docType: 'bank_statement_12' })] }),
  ],
  overlays: [],
}

/** Closed-end second, DSCR: 4-plex in Fort Worth worth $640K, owes $310K, wants $120K, 704 credit. */
export const dscrSecond = scenario({
  lien: 'ces',
  family: 'non_qm',
  docType: 'dscr',
  purpose: 'cash_out',
  occupancy: 'investment',
  propertyType: 'two_to_four',
  units: 4,
  county: 'Tarrant',
  value: 640000,
  firstLienBalance: 310000,
  loanAmount: 120000,
  fico: 704,
  dscr: 1.21,
  features: [],
})

// ---------------------------------------------------------------------------
// Mockups 03 and 04: conventional purchase, $400K, 5% down, 720, first-time buyer
// ---------------------------------------------------------------------------

const conv1Unit: Partial<MatrixCell> = { propertyTypes: ['sfr_pud', 'condo'], purposes: ['purchase', 'rate_term'], unitsMin: 1, unitsMax: 1, loanAmountMax: 806500, sourcePage: 1 }

export const conventionalCatalog: Catalog = {
  lenders: [lender('Northline Wholesale'), lender('Pinecrest TPO'), lender('Ardent Mortgage'), lender('Lakeline Wholesale', 'not_signed_up'), lender('Crestview Bank')],
  programs: [
    program('Northline Wholesale', 'Conventional 30-Year Fixed', {
      cells: [
        // Mockup 04's grid: rows are credit bands, columns occupancy/units.
        ...column(conv1Unit, [[780, 850, 97], [740, 779, 97], [720, 739, 97], [680, 719, 97], [660, 679, 95], [620, 659, 95]]),
        ...column({ ...conv1Unit, propertyTypes: ['sfr_pud', 'two_to_four'], unitsMin: 2, unitsMax: 2 }, [[680, 850, 85], [620, 679, 80]]),
        ...column({ ...conv1Unit, occupancy: 'second_home' }, [[680, 850, 90], [620, 679, 85]]),
        ...column({ ...conv1Unit, occupancy: 'investment', purposes: ['purchase'] }, [[720, 850, 85], [680, 719, 80], [660, 679, 75], [620, 659, null]]),
      ],
      rules: [
        rule({ field: 'dti', op: '<=', value: 50, message: 'Max DTI 50% (DU Approve/Eligible)', sourcePage: 3 }),
        rule({ field: 'reserves_months', op: '>=', value: 0, severity: 'verify', message: 'Reserves per DU findings', sourcePage: 3 }),
        rule({ field: 'first_time_buyer', op: 'required', appliesWhen: { ltv_above: 95, purposes: ['purchase'] }, message: 'Above 95% LTV, at least one borrower must be a first-time buyer', sourcePage: 11 }),
      ],
    }),
    program('Pinecrest TPO', 'Conventional Fixed 30', { cells: column(conv1Unit, [[620, 850, 97]]), rules: [rule({ field: 'dti', op: '<=', value: 50, message: 'Max DTI 50%' })] }),
    program('Ardent Mortgage', 'Conventional 30-Year Fixed', { cells: column(conv1Unit, [[640, 850, 95]]), rules: [rule({ field: 'dti', op: '<=', value: 45, message: 'Max DTI 45%' })] }),
    program('Lakeline Wholesale', 'Conventional 30 Fixed', { cells: column(conv1Unit, [[620, 850, 97]]) }),
    program('Northline Wholesale', 'Conventional HomeReady', {
      features: ['homeready_possible'],
      cells: column(conv1Unit, [[620, 850, 97]]),
      rules: [rule({ field: 'income_vs_ami', op: '<=', value: 80, message: 'Income limit 80% of area median income ($92,400 in Collin County)', sourcePage: 2 })],
    }),
    program('Crestview Bank', 'Conforming Fixed', { cells: column({ ...conv1Unit, purposes: ['purchase'] }, [[620, 850, 90]]) }),
    // Not searched for a plain conventional search: DPA, FHA, a 2nd lien.
    program('Northline Wholesale', 'Conventional with DPA', { features: ['dpa'], cells: column(conv1Unit, [[620, 850, 97]]) }),
    program('Northline Wholesale', 'FHA 30-Year Fixed', { family: 'fha', cells: column(conv1Unit, [[580, 850, 96.5]]) }),
    program('Pinecrest TPO', 'Conventional Closed-End Second', { lien: 'ces', cells: column(conv1Unit, [[680, 850, null]], 'maxCltv') }),
  ],
  overlays: [],
}

/** TBD purchase, $400,000, 5% down ($380,000), 720, primary SFR, Collin County, DTI 38%, first-time buyer, income $118,000 (128% of AMI). */
export const conventionalPurchase = scenario({
  purchasePrice: 400000,
  value: 400000,
  loanAmount: 380000,
  county: 'Collin',
  fico: 720,
  dti: 38,
  reservesMonths: 3,
  firstTimeBuyer: true,
  incomeVsAmiPct: 127.71,
})

// ---------------------------------------------------------------------------
// Marcus (2026-10-25 design): closed-end second, bank statement, Texas homestead
// ---------------------------------------------------------------------------

const bsCes: Partial<MatrixCell> = { propertyTypes: ['sfr_pud'], purposes: ['cash_out'], docType: 'bank_statement_12', loanAmountMin: 25000, loanAmountMax: 500000 }

export const marcusCatalog: Catalog = {
  lenders: [lender('Lonestar Equity'), lender('Cypress Lending'), lender('Northgate Funding'), lender('Bluebonnet Bank')],
  programs: [
    program('Lonestar Equity', 'Equity Flex CES', {
      family: 'non_qm',
      lien: 'ces',
      docTypes: ['bank_statement_12'],
      cells: column(bsCes, [[680, 850, 85], [640, 679, 80]], 'maxCltv'),
      rules: [rule({ field: 'reserves_months', op: '>=', value: 3, message: 'Three months of reserves', sourcePage: 6 })],
    }),
    program('Cypress Lending', 'Bank Statement 2nd', { family: 'non_qm', lien: 'ces', docTypes: ['bank_statement_12'], cells: column(bsCes, [[680, 850, 90], [640, 679, 85]], 'maxCltv') }),
    program('Northgate Funding', 'Alt-Doc CES', { family: 'non_qm', lien: 'ces', docTypes: ['bank_statement_12'], cells: column(bsCes, [[680, 850, 85], [620, 679, 78]], 'maxCltv') }),
    program('Cypress Lending', 'Prime 2nd', { family: 'non_qm', lien: 'ces', docTypes: ['bank_statement_12'], cells: column(bsCes, [[680, 850, 85], [640, 659, 75]], 'maxCltv') }),
    program('Northgate Funding', 'Prime CES', { family: 'non_qm', lien: 'ces', docTypes: ['bank_statement_12'], cells: column({ ...bsCes, loanAmountMax: 350000 }, [[680, 850, 80]], 'maxCltv') }),
    program('Bluebonnet Bank', 'HELOC Select', { family: 'non_qm', lien: 'heloc', docTypes: ['full_doc'], cells: column({ ...bsCes, docType: 'full_doc' }, [[700, 850, 80]], 'maxCltv') }),
  ],
  overlays: [],
}

/** 652 FICO, $467,000 value, $282,000 1st, $75,000 closed-end 2nd, cash-out, primary SFR, bank statement, DTI 36%, Texas homestead. */
export const marcus = scenario({
  lien: 'ces',
  family: 'non_qm',
  docType: 'bank_statement_12',
  purpose: 'cash_out',
  value: 467000,
  firstLienBalance: 282000,
  loanAmount: 75000,
  fico: 652,
  dti: 36,
  reservesMonths: null,
  selfEmployedYears: 6,
  homestead: true,
})
