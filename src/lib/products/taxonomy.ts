// The product taxonomy: the fixed words every program, matrix cell and search
// uses (docs/plans/product-search-v2.md §3.2). The database enums match these
// lists exactly (a test checks); adding a feature means adding it here and in
// a database script.

import type { Occupancy, PropertyType } from '@/lib/api/types'
import type { LoanPurpose } from '@/lib/pipeline/stages'

const labels = <T extends string>(entries: readonly (readonly [T, string])[]) => ({
  values: entries.map(([v]) => v) as T[],
  label: Object.fromEntries(entries) as Record<T, string>,
})

export const PRODUCT_FAMILIES = labels([
  ['conventional', 'Conventional'],
  ['fha', 'FHA'],
  ['va', 'VA'],
  ['usda', 'USDA'],
  ['jumbo', 'Jumbo'],
  ['non_qm', 'Non-QM'],
] as const)
export type ProductFamily = (typeof PRODUCT_FAMILIES.values)[number]

export const LIENS = labels([
  ['first', '1st lien'],
  ['ces', 'Closed-end 2nd'],
  ['heloc', 'HELOC'],
] as const)
export type Lien = (typeof LIENS.values)[number]

export const DOC_TYPES = labels([
  ['full_doc', 'Full doc'],
  ['bank_statement_12', 'Bank statement (12 mo)'],
  ['bank_statement_24', 'Bank statement (24 mo)'],
  ['form_1099', '1099'],
  ['pnl_only', 'P&L only'],
  ['asset_depletion', 'Asset depletion'],
  ['dscr', 'DSCR'],
  ['wvoe', 'WVOE'],
  ['no_ratio', 'No ratio'],
] as const)
export type DocType = (typeof DOC_TYPES.values)[number]

export const FEATURES = labels([
  ['dpa', 'Down payment assistance'],
  ['itin', 'ITIN'],
  ['foreign_national', 'Foreign national'],
  ['interest_only', 'Interest-only'],
  ['non_warrantable_condo', 'Non-warrantable condo'],
  ['manufactured', 'Manufactured'],
  ['buydown', 'Buydown'],
  ['recent_credit_event', 'Recent credit event'],
  ['first_time_investor', 'First-time investor'],
  ['str_income', 'Short-term rental income'],
  ['homeready_possible', 'HomeReady / Home Possible'],
  ['llc_vesting', 'LLC vesting'],
] as const)
export type Feature = (typeof FEATURES.values)[number]

/** Features a program must have when the scenario asks for them; DPA programs are also left out unless asked for (plan §4.1). */
export const OPT_IN_FEATURES: readonly Feature[] = ['dpa']

export const MATRIX_PURPOSES = labels([
  ['purchase', 'Purchase'],
  ['rate_term', 'Rate/term'],
  ['cash_out', 'Cash-out'],
] as const)
export type MatrixPurpose = (typeof MATRIX_PURPOSES.values)[number]

export const MATRIX_PROPERTY_TYPES = labels([
  ['sfr_pud', 'SFR/PUD'],
  ['condo', 'Condo'],
  ['non_warrantable_condo', 'Non-warrantable condo'],
  ['two_to_four', '2–4 units'],
  ['manufactured', 'Manufactured'],
  ['mixed_use', 'Mixed-use'],
] as const)
export type MatrixPropertyType = (typeof MATRIX_PROPERTY_TYPES.values)[number]

export const OCCUPANCIES = labels([
  ['primary', 'Primary'],
  ['second_home', 'Second home'],
  ['investment', 'Investment'],
] as const)

export const LENDER_STATUSES = labels([
  ['approved', 'Approved'],
  ['pending', 'Application pending'],
  ['not_signed_up', 'Not signed up'],
  ['inactive', 'Inactive'],
] as const)
export type LenderStatus = (typeof LENDER_STATUSES.values)[number]

export const LENDER_CHANNELS = labels([
  ['wholesale', 'Wholesale'],
  ['correspondent', 'Correspondent'],
  ['non_delegated', 'Non-delegated'],
] as const)
export type LenderChannel = (typeof LENDER_CHANNELS.values)[number]

/** Fields a program rule can check (plan §3.4). */
export const RULE_FIELDS = labels([
  ['dti', 'DTI'],
  ['reserves_months', 'Reserves (months)'],
  ['mortgage_lates_12', 'Mortgage lates, last 12 months'],
  ['mortgage_lates_24', 'Mortgage lates, last 24 months'],
  ['bk_seasoning_months', 'Bankruptcy seasoning (months)'],
  ['fc_seasoning_months', 'Foreclosure / short sale seasoning (months)'],
  ['state', 'State'],
  ['citizenship', 'Citizenship'],
  ['self_employed_years', 'Years self-employed'],
  ['loan_amount', 'Loan amount'],
  ['fico', 'Credit score'],
  ['ltv', 'LTV'],
  ['cltv', 'CLTV'],
  ['dscr', 'DSCR'],
  ['units', 'Units'],
  ['first_time_buyer', 'First-time buyer'],
  ['income_vs_ami', 'Income as % of area median'],
] as const)
export type RuleField = (typeof RULE_FIELDS.values)[number]

export const RULE_OPS = ['<=', '>=', 'in', 'not_in', 'required', 'between'] as const
export type RuleOp = (typeof RULE_OPS)[number]

export const CITIZENSHIPS = labels([
  ['us_citizen', 'US citizen'],
  ['permanent_resident', 'Permanent resident'],
  ['non_permanent_resident', 'Non-permanent resident'],
  ['itin', 'ITIN'],
  ['foreign_national', 'Foreign national'],
] as const)
export type Citizenship = (typeof CITIZENSHIPS.values)[number]

// ---------------------------------------------------------------------------
// From a borrower file to the taxonomy
// ---------------------------------------------------------------------------

/** Which lien a loan purpose is: a HELOC is a HELOC, a HELOAN is a closed-end second, everything else is a 1st. */
export function lienFor(purpose: LoanPurpose): Lien {
  return purpose === 'heloc' ? 'heloc' : purpose === 'heloan' ? 'ces' : 'first'
}

/** The matrix purpose of a loan. 2nd liens and DSCR files are treated as cash-out unless they're purchases. */
export function matrixPurposeFor(purpose: LoanPurpose): MatrixPurpose {
  if (purpose === 'purchase') return 'purchase'
  if (purpose === 'refinance_rate_term') return 'rate_term'
  return 'cash_out'
}

/** The matrix property type for a home. Condos are warrantable unless flagged; townhouses price as SFR/PUD. */
export function matrixPropertyTypeFor(type: PropertyType | null, units: number | null, nonWarrantable = false): MatrixPropertyType | null {
  if ((units ?? 1) >= 2 || type === 'two_to_four_unit') return 'two_to_four'
  switch (type) {
    case 'single_family':
    case 'townhouse':
      return 'sfr_pud'
    case 'condo':
      return nonWarrantable ? 'non_warrantable_condo' : 'condo'
    case 'manufactured':
      return 'manufactured'
    default:
      return null
  }
}

/** The doc type for the file's income documentation (`loans.income_doc_type`). Bank statements need the months to pick 12 or 24. */
export function docTypeFor(incomeDocType: 'full_doc' | 'bank_statement' | 'form_1099' | 'asset_based' | 'dscr' | null, bankStatementMonths: 12 | 24 = 12): DocType {
  switch (incomeDocType) {
    case 'bank_statement':
      return bankStatementMonths === 24 ? 'bank_statement_24' : 'bank_statement_12'
    case 'form_1099':
      return 'form_1099'
    case 'asset_based':
      return 'asset_depletion'
    case 'dscr':
      return 'dscr'
    default:
      return 'full_doc'
  }
}

/** The matrix citizenship for the 1003's citizenship (ITIN and foreign national are set on the search itself). */
export function citizenshipFor(urla: 'us_citizen' | 'permanent_resident_alien' | 'non_permanent_resident_alien' | null): Citizenship {
  return urla === 'permanent_resident_alien' ? 'permanent_resident' : urla === 'non_permanent_resident_alien' ? 'non_permanent_resident' : 'us_citizen'
}

export const occupancyLabel =(o: Occupancy) => OCCUPANCIES.label[o]
