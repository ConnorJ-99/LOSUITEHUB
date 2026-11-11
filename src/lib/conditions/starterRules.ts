// The Phase 8 starter condition rules, as the database seeds them
// (20270112000000_suggested_conditions.sql; a test keeps the two the same).
// Conditions only, built in, editable and can be turned off in Settings.

import type { DocRule } from '@/lib/prequal/nextStep'
import { NO_RULE_FILTERS, type RuleFilters } from './ruleFilters'

type Row = [key: string, short: string, full: string, kind: DocRule['kind'], order: number, scope: RuleFilters['scope'], party: RuleFilters['party'], stage: RuleFilters['stage'], filters: Partial<RuleFilters>]

const REFI: RuleFilters['purposes'] = ['refinance_rate_term', 'refinance_cash_out', 'investment_dscr']

const ROWS: Row[] = [
  ['cond_purchase_contract', 'executed contract and addenda', 'Fully executed purchase contract and all addenda', 'purchase_contract', 300, 'file', 'realtor', 'processing', { purposes: ['purchase'] }],
  ['cond_earnest_money', 'earnest money proof', 'Proof the earnest money cleared (cancelled check or wire confirmation) and a statement for the account it came from', 'bank_statement', 310, 'file', 'borrower', 'processing', { purposes: ['purchase'] }],
  ['cond_hoi_quote', 'homeowners insurance quote', "Homeowners insurance quote and the agent's name, phone and email", 'other', 320, 'file', 'borrower', 'processing', { purposes: ['purchase'] }],
  ['cond_refi_statement', 'current mortgage statement', 'The latest mortgage statement for the home being refinanced', 'mortgage_statement', 330, 'file', 'borrower', 'application', { purposes: REFI }],
  ['cond_refi_dec_page', 'insurance declarations page', 'The homeowners insurance declarations page for the home being refinanced', 'other', 340, 'file', 'borrower', 'processing', { purposes: REFI }],
  ['cond_payoff_auth', 'payoff authorization', 'Signed payoff authorization for the current mortgage', 'other', 350, 'file', 'borrower', 'processing', { purposes: REFI }],
  ['cond_tx_12_day', 'confirm 12-day notice', 'Confirm the Texas 12-day notice was delivered and the earliest sign-off date', 'other', 360, 'file', 'processor_lo', 'application', { texasCashOut: true }],
  ['cond_tx_prior_equity', 'prior home-equity loan info', 'Details of any home-equity loan on this home in the last 12 months, if there was one', 'other', 370, 'file', 'borrower', 'processing', { texasCashOut: true }],
  ['cond_tx_survey', 'homestead survey', 'Survey of the homestead, if the title company requires one', 'other', 380, 'file', 'title', 'before_closing', { texasCashOut: true }],
  ['cond_first_lien', 'first-lien mortgage statement', 'The latest statement for the first mortgage on the home', 'mortgage_statement', 390, 'file', 'borrower', 'application', { purposes: ['heloc', 'heloan'] }],
  ['cond_va_coe', 'Certificate of Eligibility', 'VA Certificate of Eligibility', 'other', 400, 'person', 'processor_lo', 'application', { mortgageTypes: ['va'] }],
  ['cond_va_dd214', 'DD-214 or statement of service', 'DD-214, or a statement of service if still serving', 'other', 410, 'person', 'borrower', 'application', { mortgageTypes: ['va'] }],
  ['cond_va_exempt_letter', 'funding-fee exemption letter', 'VA disability award or funding-fee exemption letter', 'award_letter', 420, 'person', 'borrower', 'processing', { mortgageTypes: ['va'], vaExempt: true }],
  ['cond_usda_household', 'household income', 'Income documents for every adult in the household, including anyone not on the loan', 'other', 430, 'file', 'borrower', 'processing', { mortgageTypes: ['usda_rural'] }],
  ['cond_condo_hoa', 'HOA contact for the questionnaire', 'HOA or management company contact, for the condo questionnaire', 'other', 440, 'file', 'title', 'processing', { propertyTypes: ['condo'] }],
  ['cond_condo_master', 'master insurance policy', "The condo association's master insurance policy", 'other', 450, 'file', 'title', 'processing', { propertyTypes: ['condo'] }],
  ['cond_rent_schedule', 'leases or rent schedule', "Current leases for the property, or the appraiser's rent schedule", 'lease', 460, 'file', 'borrower', 'processing', { occupancies: ['investment'] }],
  ['cond_llc_docs', 'LLC documents', 'For the LLC: articles of organization, the operating agreement and the IRS EIN letter', 'other', 470, 'file', 'borrower', 'processing', { entityVesting: true }],
]

export const STARTER_CONDITION_RULES: DocRule[] = ROWS.map(([key, shortText, fullText, kind, sortOrder, scope, party, stage, filters]) => ({
  ...NO_RULE_FILTERS,
  ...filters,
  key,
  condition: 'everyone',
  shortText,
  fullText,
  kind,
  sortOrder,
  active: true,
  useFor: 'conditions',
  scope,
  party,
  stage,
}))
