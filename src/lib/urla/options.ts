// Answer lists for the 1003 (URLA). Values match the Postgres enums in
// supabase/migrations/20261027000000_urla.sql.

import type { AssetUse } from '@/lib/calc'

export type Citizenship = 'us_citizen' | 'permanent_resident_alien' | 'non_permanent_resident_alien'
export type MaritalStatus = 'married' | 'separated' | 'unmarried'
export type AddressKind = 'current' | 'former' | 'mailing'
export type HousingKind = 'no_primary_expense' | 'own' | 'rent'
export type EmploymentStatus = 'current' | 'previous'
export type PriorPropertyUsage = 'primary' | 'fha_secondary' | 'second_home' | 'investment'
export type PriorTitleHeld = 'sole' | 'joint_with_spouse' | 'joint_with_other'
export type ApplicationMethod = 'face_to_face' | 'telephone' | 'fax_or_mail' | 'email_or_internet'

interface Option<T extends string> {
  value: T
  label: string
}

export const CITIZENSHIP_OPTIONS: readonly Option<Citizenship>[] = [
  { value: 'us_citizen', label: 'U.S. citizen' },
  { value: 'permanent_resident_alien', label: 'Permanent resident alien' },
  { value: 'non_permanent_resident_alien', label: 'Non-permanent resident alien' },
]

export const MARITAL_STATUS_OPTIONS: readonly Option<MaritalStatus>[] = [
  { value: 'married', label: 'Married' },
  { value: 'separated', label: 'Separated' },
  { value: 'unmarried', label: 'Unmarried' },
]

export const ADDRESS_KIND_OPTIONS: readonly Option<AddressKind>[] = [
  { value: 'current', label: 'Current address' },
  { value: 'former', label: 'Former address' },
  { value: 'mailing', label: 'Mailing address' },
]

export const HOUSING_OPTIONS: readonly Option<HousingKind>[] = [
  { value: 'own', label: 'Own' },
  { value: 'rent', label: 'Rent' },
  { value: 'no_primary_expense', label: 'No primary housing expense' },
]

export const OTHER_INCOME_OPTIONS = [
  { value: 'alimony', label: 'Alimony' },
  { value: 'automobile_allowance', label: 'Automobile allowance' },
  { value: 'boarder_income', label: 'Boarder income' },
  { value: 'capital_gains', label: 'Capital gains' },
  { value: 'child_support', label: 'Child support' },
  { value: 'disability', label: 'Disability' },
  { value: 'foster_care', label: 'Foster care' },
  { value: 'housing_or_parsonage', label: 'Housing or parsonage' },
  { value: 'interest_and_dividends', label: 'Interest and dividends' },
  { value: 'mortgage_credit_certificate', label: 'Mortgage credit certificate' },
  { value: 'mortgage_differential', label: 'Mortgage differential payments' },
  { value: 'notes_receivable', label: 'Notes receivable' },
  { value: 'public_assistance', label: 'Public assistance' },
  { value: 'retirement', label: 'Retirement (pension, IRA, annuity)' },
  { value: 'royalty', label: 'Royalty payments' },
  { value: 'separate_maintenance', label: 'Separate maintenance' },
  { value: 'social_security', label: 'Social Security' },
  { value: 'trust', label: 'Trust' },
  { value: 'unemployment', label: 'Unemployment benefits' },
  { value: 'va_compensation', label: 'VA compensation' },
  { value: 'other', label: 'Other' },
] as const
export type OtherIncomeType = (typeof OTHER_INCOME_OPTIONS)[number]['value']

export const ASSET_GROUPS = [
  {
    label: 'Accounts (2a)',
    options: [
      { value: 'checking', label: 'Checking' },
      { value: 'savings', label: 'Savings' },
      { value: 'money_market', label: 'Money market' },
      { value: 'certificate_of_deposit', label: 'Certificate of deposit' },
      { value: 'mutual_fund', label: 'Mutual fund' },
      { value: 'stocks', label: 'Stocks' },
      { value: 'stock_options', label: 'Stock options' },
      { value: 'bonds', label: 'Bonds' },
      { value: 'retirement', label: 'Retirement (401k, IRA)' },
      { value: 'bridge_loan_proceeds', label: 'Bridge loan proceeds' },
      { value: 'individual_development_account', label: 'Individual development account' },
      { value: 'trust_account', label: 'Trust account' },
      { value: 'cash_value_life_insurance', label: 'Cash value of life insurance' },
    ],
  },
  {
    label: 'Other assets and credits (2b)',
    options: [
      { value: 'proceeds_real_estate_sale', label: 'Proceeds from real estate sale' },
      { value: 'proceeds_non_real_estate_sale', label: 'Proceeds from sale of non-real estate' },
      { value: 'secured_borrowed_funds', label: 'Secured borrowed funds' },
      { value: 'unsecured_borrowed_funds', label: 'Unsecured borrowed funds' },
      { value: 'other_liquid', label: 'Other liquid asset' },
      { value: 'earnest_money', label: 'Earnest money' },
      { value: 'employer_assistance', label: 'Employer assistance' },
      { value: 'lot_equity', label: 'Lot equity' },
      { value: 'relocation_funds', label: 'Relocation funds' },
      { value: 'rent_credit', label: 'Rent credit' },
      { value: 'sweat_equity', label: 'Sweat equity' },
      { value: 'trade_equity', label: 'Trade equity' },
      { value: 'other_credit', label: 'Other credit' },
    ],
  },
  {
    label: 'Gifts and grants (4d)',
    options: [
      { value: 'gift_cash', label: 'Cash gift' },
      { value: 'gift_equity', label: 'Gift of equity' },
      { value: 'grant', label: 'Grant' },
    ],
  },
] as const
export type AssetType = (typeof ASSET_GROUPS)[number]['options'][number]['value']
export const ASSET_OPTIONS: readonly { value: AssetType; label: string }[] = ASSET_GROUPS.flatMap((g) => [...g.options] as { value: AssetType; label: string }[])
export const ASSET_USE_OPTIONS = [
  { value: 'down_payment', label: 'Down payment and closing' },
  { value: 'depletion', label: 'Asset-depletion income' },
  { value: 'reserves', label: 'Reserves only' },
] as const satisfies readonly { value: AssetUse; label: string }[]

export const isGift = (t: AssetType) => t === 'gift_cash' || t === 'gift_equity' || t === 'grant'

export const GIFT_SOURCE_OPTIONS = [
  { value: 'relative', label: 'Relative' },
  { value: 'unmarried_partner', label: 'Unmarried partner' },
  { value: 'employer', label: 'Employer' },
  { value: 'religious_nonprofit', label: 'Religious nonprofit' },
  { value: 'community_nonprofit', label: 'Community nonprofit' },
  { value: 'federal_agency', label: 'Federal agency' },
  { value: 'state_agency', label: 'State agency' },
  { value: 'local_agency', label: 'Local agency' },
  { value: 'lender', label: 'Lender' },
  { value: 'other', label: 'Other' },
] as const
export type GiftSource = (typeof GIFT_SOURCE_OPTIONS)[number]['value']

export const LIABILITY_GROUPS = [
  {
    label: 'Debts (2c)',
    options: [
      { value: 'revolving', label: 'Revolving (credit card)' },
      { value: 'installment', label: 'Installment (auto, student, personal)' },
      { value: 'open_30_day', label: 'Open 30-day (balance paid monthly)' },
      { value: 'lease', label: 'Lease (not real estate)' },
      { value: 'other', label: 'Other debt' },
    ],
  },
  {
    label: 'Other liabilities and expenses (2d)',
    options: [
      { value: 'alimony', label: 'Alimony' },
      { value: 'child_support', label: 'Child support' },
      { value: 'separate_maintenance', label: 'Separate maintenance' },
      { value: 'job_related_expenses', label: 'Job-related expenses' },
      { value: 'other_expense', label: 'Other expense' },
    ],
  },
] as const
export type LiabilityType = (typeof LIABILITY_GROUPS)[number]['options'][number]['value']
export const LIABILITY_OPTIONS: readonly { value: LiabilityType; label: string }[] = LIABILITY_GROUPS.flatMap((g) => [...g.options] as { value: LiabilityType; label: string }[])
export const isExpenseLiability = (t: LiabilityType) =>
  t === 'alimony' || t === 'child_support' || t === 'separate_maintenance' || t === 'job_related_expenses' || t === 'other_expense'

export const PRIOR_USAGE_OPTIONS: readonly Option<PriorPropertyUsage>[] = [
  { value: 'primary', label: 'Primary residence' },
  { value: 'fha_secondary', label: 'FHA secondary residence' },
  { value: 'second_home', label: 'Second home' },
  { value: 'investment', label: 'Investment property' },
]

export const PRIOR_TITLE_OPTIONS: readonly Option<PriorTitleHeld>[] = [
  { value: 'sole', label: 'By yourself' },
  { value: 'joint_with_spouse', label: 'Jointly with your spouse' },
  { value: 'joint_with_other', label: 'Jointly with another person' },
]

export const APPLICATION_METHOD_OPTIONS: readonly Option<ApplicationMethod>[] = [
  { value: 'face_to_face', label: 'Face-to-face interview' },
  { value: 'telephone', label: 'Telephone interview' },
  { value: 'fax_or_mail', label: 'Fax or mail' },
  { value: 'email_or_internet', label: 'Email or internet' },
]

export const ETHNICITY_OPTIONS = [
  { value: 'hispanic_or_latino', label: 'Hispanic or Latino', children: [
    { value: 'mexican', label: 'Mexican' },
    { value: 'puerto_rican', label: 'Puerto Rican' },
    { value: 'cuban', label: 'Cuban' },
    { value: 'other_hispanic', label: 'Other Hispanic or Latino' },
  ] },
  { value: 'not_hispanic_or_latino', label: 'Not Hispanic or Latino', children: [] },
  { value: 'not_provided', label: 'I do not wish to provide this information', children: [] },
] as const
export type HmdaEthnicity =
  | (typeof ETHNICITY_OPTIONS)[number]['value']
  | (typeof ETHNICITY_OPTIONS)[0]['children'][number]['value']

export const RACE_OPTIONS = [
  { value: 'american_indian_or_alaska_native', label: 'American Indian or Alaska Native', children: [] },
  { value: 'asian', label: 'Asian', children: [
    { value: 'asian_indian', label: 'Asian Indian' },
    { value: 'chinese', label: 'Chinese' },
    { value: 'filipino', label: 'Filipino' },
    { value: 'japanese', label: 'Japanese' },
    { value: 'korean', label: 'Korean' },
    { value: 'vietnamese', label: 'Vietnamese' },
    { value: 'other_asian', label: 'Other Asian' },
  ] },
  { value: 'black_or_african_american', label: 'Black or African American', children: [] },
  { value: 'native_hawaiian_or_pacific_islander', label: 'Native Hawaiian or Other Pacific Islander', children: [
    { value: 'native_hawaiian', label: 'Native Hawaiian' },
    { value: 'guamanian_or_chamorro', label: 'Guamanian or Chamorro' },
    { value: 'samoan', label: 'Samoan' },
    { value: 'other_pacific_islander', label: 'Other Pacific Islander' },
  ] },
  { value: 'white', label: 'White', children: [] },
  { value: 'not_provided', label: 'I do not wish to provide this information', children: [] },
] as const
export type HmdaRace =
  | (typeof RACE_OPTIONS)[number]['value']
  | (typeof RACE_OPTIONS)[1]['children'][number]['value']
  | (typeof RACE_OPTIONS)[3]['children'][number]['value']

export const SEX_OPTIONS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'not_provided', label: 'I do not wish to provide this information' },
] as const
export type HmdaSex = (typeof SEX_OPTIONS)[number]['value']

/** Section 5 questions, worded like the 1003. `purchaseOnly` hides B on refinances. */
export const DECLARATION_QUESTIONS_5A = [
  { key: 'willOccupyAsPrimary', letter: 'A', text: 'Will you occupy the property as your primary residence?' },
  { key: 'ownedPropertyPast3Years', letter: 'A.1', text: 'Have you had an ownership interest in another property in the last three years?' },
  { key: 'familyRelationshipWithSeller', letter: 'B', text: 'Do you have a family relationship or business affiliation with the seller of the property?', purchaseOnly: true },
  { key: 'borrowingUndisclosedMoney', letter: 'C', text: 'Are you borrowing any money for this transaction (e.g., closing costs or down payment) or obtaining money from another party that you have not disclosed on this application?' },
  { key: 'applyingOtherMortgage', letter: 'D.1', text: 'Have you or will you be applying for a mortgage loan on another property before closing this transaction that is not disclosed on this application?' },
  { key: 'applyingNewCredit', letter: 'D.2', text: 'Have you or will you be applying for any new credit (e.g., installment loan, credit card) before closing this loan that is not disclosed on this application?' },
  { key: 'subjectToPriorityLien', letter: 'E', text: 'Will this property be subject to a lien that could take priority over the first mortgage lien, such as a clean energy (PACE) lien?' },
] as const

export const DECLARATION_QUESTIONS_5B = [
  { key: 'cosignerOrGuarantor', letter: 'F', text: 'Are you a co-signer or guarantor on any debt or loan that is not disclosed on this application?' },
  { key: 'outstandingJudgments', letter: 'G', text: 'Are there any outstanding judgments against you?' },
  { key: 'delinquentFederalDebt', letter: 'H', text: 'Are you currently delinquent or in default on a federal debt?' },
  { key: 'partyToLawsuit', letter: 'I', text: 'Are you a party to a lawsuit in which you potentially have any personal financial liability?' },
  { key: 'deedInLieuPast7Years', letter: 'J', text: 'Have you conveyed title to any property in lieu of foreclosure in the past 7 years?' },
  { key: 'shortSalePast7Years', letter: 'K', text: 'Within the past 7 years, have you completed a pre-foreclosure sale or short sale?' },
  { key: 'foreclosurePast7Years', letter: 'L', text: 'Have you had property foreclosed upon in the last 7 years?' },
  { key: 'bankruptcyPast7Years', letter: 'M', text: 'Have you declared bankruptcy within the past 7 years?' },
] as const

export const labelFor = <T extends string>(options: readonly { value: T; label: string }[], value: T | null | undefined) =>
  options.find((o) => o.value === value)?.label ?? '—'
