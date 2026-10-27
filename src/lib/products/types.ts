// Shapes for the Product Search engine (docs/plans/product-search-v2.md §4).
// The search form, the assistant and the borrower file all produce the same
// Scenario; the catalog is what the database holds (approved versions only).

import type { Occupancy } from '@/lib/api/types'
import type { Citizenship, DocType, Feature, LenderStatus, Lien, MatrixPropertyType, MatrixPurpose, ProductFamily, RuleField, RuleOp } from './taxonomy'

export interface Scenario {
  // 1 · What kind of loan (the product-type gate)
  lien: Lien
  /** 'any' widens the family but keeps lien and doc type. */
  family: ProductFamily | 'any'
  docType: DocType
  /** Must-have features. DPA programs are only searched when 'dpa' is here. */
  features: Feature[]
  // 2 · Scenario
  purpose: MatrixPurpose
  occupancy: Occupancy
  propertyType: MatrixPropertyType
  units: number
  /** Two-letter state, e.g. "TX". */
  state: string
  county: string | null
  /** Purchase price (purchases only). */
  purchasePrice: number | null
  /** Appraised or estimated value. For a purchase, LTV uses the lower of price and value. */
  value: number
  /** The new loan (for a 2nd lien: the new 2nd alone). */
  loanAmount: number
  /** Existing 1st lien balance that stays (2nd liens only; 0 otherwise). */
  firstLienBalance: number
  fico: number | null
  /** Unknown values become "Verify" items, never failures. */
  dti: number | null
  reservesMonths: number | null
  dscr: number | null
  citizenship: Citizenship
  mortgageLates12: number | null
  mortgageLates24: number | null
  /** Months since a bankruptcy / foreclosure-type event; null = none; 'unknown' = an event with no date (rules show Verify). */
  bkSeasoningMonths: number | 'unknown' | null
  fcSeasoningMonths: number | 'unknown' | null
  selfEmployedYears: number | null
  firstTimeBuyer: boolean
  /** Household income as a percent of the area median, when known. */
  incomeVsAmiPct: number | null
  /** Texas homestead (with cash-out, §50(a)(6) caps CLTV at 80%). */
  homestead: boolean
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface CatalogLender {
  id: string
  name: string
  status: LenderStatus
  /** Null = not recorded (not checked). */
  states: string[] | null
}

export interface MatrixCell {
  id: string
  occupancy: Occupancy
  propertyTypes: MatrixPropertyType[]
  purposes: MatrixPurpose[]
  docType: DocType
  unitsMin: number
  unitsMax: number
  ficoMin: number
  ficoMax: number
  loanAmountMin: number
  /** Null = no upper limit. */
  loanAmountMax: number | null
  dscrMin: number | null
  citizenship: Citizenship | null
  /** False for a blank ("—") cell in the lender's grid. */
  offered: boolean
  maxLtv: number | null
  maxCltv: number | null
  maxDti: number | null
  reservesMonths: number | null
  sourcePage: number | null
  notes: string | null
}

export interface AppliesWhen {
  purposes?: MatrixPurpose[]
  occupancies?: Occupancy[]
  /** Only when the scenario's LTV (1st lien) or CLTV (2nd) is above this. */
  ltv_above?: number
}

export interface ProgramRule {
  id: string
  field: RuleField
  op: RuleOp
  /** Number, list, {min,max}, or null for required. */
  value: number | string[] | { min: number; max: number } | null
  appliesWhen: AppliesWhen | null
  severity: 'hard' | 'verify'
  message: string
  sourcePage: number | null
  sourceQuote: string | null
  /** Set for company overlays (not the lender's own rule). */
  overlay?: boolean
}

export interface CatalogProgram {
  id: string
  lenderId: string
  name: string
  family: ProductFamily
  lien: Lien
  docTypes: DocType[]
  features: Feature[]
  purposes: MatrixPurpose[]
  loanAmountBasis: 'this_lien' | 'combined'
  active: boolean
  /** The approved matrix version's cells (none = no approved matrix). */
  cells: MatrixCell[]
  rules: ProgramRule[]
}

export interface Catalog {
  lenders: CatalogLender[]
  programs: CatalogProgram[]
  /** Company overlays that apply to every program (lender/program overlays are already in each program's rules). */
  overlays: ProgramRule[]
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Where a result came from: a matrix cell or a rule, with its source page. */
export interface Trace {
  cellId?: string
  ruleId?: string
  page: number | null
}

export interface Fix {
  /** e.g. "Lower loan amount to $68,250 (−$6,750)". */
  text: string
  /** The loan amount (this lien) that would fit, when the fix is a loan-amount change. */
  loanAmount?: number
  /** The credit score needed, when the fix is a higher score. */
  fico?: number
}

export interface Reason {
  kind: 'not_offered' | 'ratio' | 'fico' | 'loan_amount' | 'rule' | 'purpose' | 'state' | 'no_matrix'
  /** e.g. "Max CLTV 75% at 640–659; scenario is 76.45%". */
  message: string
  trace: Trace | null
  /** How far off, as a share of the limit (1 = no change fixes it). */
  gap: number
  fix: Fix | null
  /** "No change in this scenario fixes it." */
  unfixable: boolean
}

export interface CheckItem {
  message: string
  /** 'na' = the rule doesn't apply to this scenario (e.g. only above 95% LTV). */
  status: 'pass' | 'fail' | 'verify' | 'na'
  /** The scenario's value, formatted, e.g. "38%". */
  value: string | null
  trace: Trace
  overlay: boolean
}

export interface Limit {
  ratio: 'ltv' | 'cltv'
  /** The scenario's ratio (unrounded). */
  actual: number
  /** The effective maximum (lowest of matrix cell and Texas cap). */
  max: number
  limitedBy: 'matrix' | 'texas'
  /** Percentage points and dollars of room left (negative = over). */
  roomPts: number
  roomDollars: number
}

export type Badge = 'best_fit' | 'highest_max_loan' | 'lowest_fico_floor'

export interface ProgramResult {
  program: CatalogProgram
  lender: CatalogLender
  eligible: boolean
  cell: MatrixCell | null
  limit: Limit | null
  /** The largest loan (this lien) that fits at this credit score and value, across loan tiers. */
  maxLoan: number | null
  /** Lowest credit score any offered cell accepts for this occupancy, property and purpose. */
  ficoFloor: number | null
  reasons: Reason[]
  checklist: CheckItem[]
  badges: Badge[]
}

export interface SearchResult {
  eligible: ProgramResult[]
  ineligible: ProgramResult[]
  /** Programs that passed the product-type gate (were evaluated). */
  searchedCount: number
  /** Programs of other types, never evaluated, by family. */
  notSearched: { count: number; families: Partial<Record<ProductFamily, number>> }
  ratios: { ltv: number; cltv: number }
}
