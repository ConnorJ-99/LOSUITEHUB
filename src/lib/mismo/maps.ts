// LOSuite values -> MISMO 3.4 enumerations (Fannie Mae ULAD / DU usage).
// Values marked "best effort" could not be confirmed against a public copy
// of the spec; check them first if Arive rejects or misplaces a field.

import type { LoanPurposeKind } from '@/lib/calc'
import type { AssetType, Citizenship, GiftSource, HousingKind, LiabilityType, MaritalStatus, OtherIncomeType, PriorPropertyUsage, PriorTitleHeld } from '@/lib/urla/options'

export const NAMESPACES = {
  mismo: 'http://www.mismo.org/residential/2009/schemas',
  xlink: 'http://www.w3.org/1999/xlink',
  ulad: 'http://www.datamodelextension.org/Schema/ULAD',
}

/** MISMO v3.4 reference model build 324. */
export const MISMO_REFERENCE_MODEL = '3.4.032420160128'

export const ARCROLE = (from: string, to: string) => `urn:fdc:mismo.org:2009:residential/${from}_IsAssociatedWith_${to}`

export const citizenship: Record<Citizenship, string> = {
  us_citizen: 'USCitizen',
  permanent_resident_alien: 'PermanentResidentAlien',
  non_permanent_resident_alien: 'NonPermanentResidentAlien',
}

export const maritalStatus: Record<MaritalStatus, string> = { married: 'Married', separated: 'Separated', unmarried: 'Unmarried' }

export const residencyBasis: Record<HousingKind, string> = { own: 'Own', rent: 'Rent', no_primary_expense: 'LivingRentFree' }

export const priorUsage: Record<PriorPropertyUsage, string> = {
  primary: 'PrimaryResidence',
  fha_secondary: 'FHASecondaryResidence',
  second_home: 'SecondHome',
  investment: 'Investment',
}

export const priorTitle: Record<PriorTitleHeld, string> = { sole: 'Sole', joint_with_spouse: 'JointWithSpouse', joint_with_other: 'JointWithOtherThanSpouse' }

export const otherIncome: Record<OtherIncomeType, string> = {
  alimony: 'Alimony',
  automobile_allowance: 'AutomobileAllowance',
  boarder_income: 'BoarderIncome',
  capital_gains: 'CapitalGains',
  child_support: 'ChildSupport',
  disability: 'Disability',
  foster_care: 'FosterCare',
  housing_or_parsonage: 'HousingAllowance',
  interest_and_dividends: 'DividendsInterest',
  mortgage_credit_certificate: 'MortgageCreditCertificate',
  mortgage_differential: 'MortgageDifferential',
  notes_receivable: 'NotesReceivableInstallment',
  public_assistance: 'PublicAssistance',
  retirement: 'Pension',
  royalty: 'Royalties',
  separate_maintenance: 'SeparateMaintenance',
  social_security: 'SocialSecurity',
  trust: 'Trust',
  unemployment: 'Unemployment',
  va_compensation: 'VABenefitsNonEducational',
  other: 'Other',
}

/**
 * Account-style assets (DEAL/ASSETS). AssetType names are best effort: the
 * public model viewer didn't show this list. Credits are handled separately
 * as purchase credits on the loan.
 */
export const assetType: Partial<Record<AssetType, string>> = {
  checking: 'CheckingAccount',
  savings: 'SavingsAccount',
  money_market: 'MoneyMarketFund',
  certificate_of_deposit: 'CertificateOfDepositTimeDeposit',
  mutual_fund: 'MutualFund',
  stocks: 'Stock',
  stock_options: 'StockOptions',
  bonds: 'Bond',
  retirement: 'RetirementFund',
  bridge_loan_proceeds: 'BridgeLoanNotDeposited',
  individual_development_account: 'IndividualDevelopmentAccount',
  trust_account: 'TrustAccount',
  cash_value_life_insurance: 'LifeInsurance',
  proceeds_real_estate_sale: 'PendingNetSaleProceedsFromRealEstateAssets',
  proceeds_non_real_estate_sale: 'ProceedsFromSaleOfNonRealEstateAsset',
  secured_borrowed_funds: 'ProceedsFromSecuredLoan',
  unsecured_borrowed_funds: 'ProceedsFromUnsecuredLoan',
  other_liquid: 'OtherLiquidAssets',
  gift_cash: 'GiftOfCash',
  gift_equity: 'GiftOfPropertyEquity',
  grant: 'Grant',
}

/** 1003 section 2b credits -> LOAN/PURCHASE_CREDITS (confirmed PurchaseCreditType values). */
export const purchaseCredit: Partial<Record<AssetType, [type: string, otherDescription?: string]>> = {
  earnest_money: ['EarnestMoney'],
  employer_assistance: ['EmployerAssistedHousing'],
  lot_equity: ['Other', 'Lot Equity'],
  relocation_funds: ['RelocationFunds'],
  rent_credit: ['LeasePurchaseFund'],
  sweat_equity: ['SweatEquity'],
  trade_equity: ['TradeEquity'],
  other_credit: ['Other', 'Other Credit'],
}

export const giftSource: Record<GiftSource, string> = {
  relative: 'Relative',
  unmarried_partner: 'UnmarriedPartner',
  employer: 'Employer',
  religious_nonprofit: 'ReligiousNonProfit',
  community_nonprofit: 'CommunityNonProfit',
  federal_agency: 'FederalAgency',
  state_agency: 'StateAgency',
  local_agency: 'LocalAgency',
  lender: 'Lender',
  other: 'Other',
}

/** 1003 section 2c debts -> DEAL/LIABILITIES (confirmed LiabilityType values). */
export const liabilityType: Partial<Record<LiabilityType, string>> = {
  revolving: 'Revolving',
  installment: 'Installment',
  open_30_day: 'Open30DayChargeAccount',
  lease: 'LeasePayment',
  other: 'Other',
}

/** 1003 section 2d obligations -> DEAL/EXPENSES (confirmed ExpenseType values). */
export const expenseType: Partial<Record<LiabilityType, string>> = {
  alimony: 'Alimony',
  child_support: 'ChildSupport',
  separate_maintenance: 'SeparateMaintenanceExpense',
  job_related_expenses: 'JobRelatedExpenses',
  other_expense: 'Other',
}

export const mortgageType: Record<string, string> = {
  conventional: 'Conventional',
  fha: 'FHA',
  va: 'VA',
  usda_rural: 'USDARuralDevelopment',
  other: 'Other',
}

export const propertyUsage: Record<string, string> = { primary: 'PrimaryResidence', second_home: 'SecondHome', investment: 'Investment' }

export const ownedDisposition: Record<string, string> = { retain: 'Retain', pending_sale: 'PendingSale', sold: 'Sold' }

/** Loan purpose and lien position. Second liens (HELOC/HELOAN) are refinances of the existing home behind the 1st. */
export function loanPurpose(purpose: LoanPurposeKind, hasPurchasePrice: boolean): { purpose: string; lien: string; cashOut?: string } {
  switch (purpose) {
    case 'purchase':
      return { purpose: 'Purchase', lien: 'FirstLien' }
    case 'refinance_rate_term':
      return { purpose: 'Refinance', lien: 'FirstLien', cashOut: 'LimitedCashOut' }
    case 'refinance_cash_out':
      return { purpose: 'Refinance', lien: 'FirstLien', cashOut: 'CashOut' }
    case 'heloc':
    case 'heloan':
      return { purpose: 'Refinance', lien: 'SecondLien', cashOut: 'CashOut' }
    case 'investment_dscr':
      return hasPurchasePrice ? { purpose: 'Purchase', lien: 'FirstLien' } : { purpose: 'Refinance', lien: 'FirstLien', cashOut: 'CashOut' }
  }
}

export const applicationMethod: Record<string, string> = {
  face_to_face: 'FaceToFace',
  telephone: 'Telephone',
  fax_or_mail: 'Mail',
  email_or_internet: 'Internet',
}

export const raceDesignation: Record<string, string> = {
  asian_indian: 'AsianIndian',
  chinese: 'Chinese',
  filipino: 'Filipino',
  japanese: 'Japanese',
  korean: 'Korean',
  vietnamese: 'Vietnamese',
  other_asian: 'OtherAsian',
  native_hawaiian: 'NativeHawaiian',
  guamanian_or_chamorro: 'GuamanianOrChamorro',
  samoan: 'Samoan',
  other_pacific_islander: 'OtherPacificIslander',
}

export const raceType: Record<string, string> = {
  american_indian_or_alaska_native: 'AmericanIndianOrAlaskaNative',
  asian: 'Asian',
  black_or_african_american: 'BlackOrAfricanAmerican',
  native_hawaiian_or_pacific_islander: 'NativeHawaiianOrOtherPacificIslander',
  white: 'White',
}

export const ethnicityOrigin: Record<string, string> = { mexican: 'Mexican', puerto_rican: 'PuertoRican', cuban: 'Cuban', other_hispanic: 'Other' }
