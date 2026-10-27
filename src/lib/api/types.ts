import type { OrgRole } from '@/lib/auth/context'
import type { LoanPurpose, PipelineStage } from '@/lib/pipeline/stages'

export interface Contact {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

export interface MemberRef {
  id: string
  name: string
}

/** A loan as shown on the pipeline board, list and record page. */
export interface PipelineLoan {
  id: string
  purpose: LoanPurpose
  stage: PipelineStage
  lostReason: string | null
  referralSource: string | null
  stageChangedAt: string
  createdAt: string
  priorLoanId: string | null
  assignedLo: MemberRef | null
  /** The primary borrower. */
  borrower: Contact | null
  coBorrowerCount: number
}

export interface StageHistoryEntry {
  id: number
  fromStage: PipelineStage | null
  toStage: PipelineStage
  lostReason: string | null
  changedBy: MemberRef | null
  changedAt: string
}

export interface OrgMember {
  id: string
  name: string
  email: string
  role: OrgRole
}

/** A person plus a short summary of their loans, for the Contacts list and duplicate check. */
export interface ContactSummary extends Contact {
  createdAt: string
  loans: { id: string; stage: PipelineStage; purpose: LoanPurpose; stageChangedAt: string }[]
}

export type Occupancy = 'primary' | 'second_home' | 'investment'
export type PropertyStatus = 'interested' | 'offer_made' | 'under_contract' | 'passed' | 'current_home' | 'owned'
export type MortgageType = 'conventional' | 'fha' | 'va' | 'usda_rural' | 'other'
export type AmortizationType = 'fixed' | 'arm'
export type EstateType = 'fee_simple' | 'leasehold'
export type ReoDisposition = 'retain' | 'pending_sale' | 'sold'
export type PropertyType = 'single_family' | 'condo' | 'townhouse' | 'two_to_four_unit' | 'manufactured' | 'other'
export type NoteKind = 'note' | 'call' | 'text' | 'email' | 'meeting'

/** Deal facts stored on the loan (the single source for these values). */
export interface LoanDetails {
  occupancy: Occupancy
  purchasePrice: number | null
  loanAmount: number | null
  noteRate: number | null
  termMonths: number | null
  cashOutAmount: number | null
  /** Dates are YYYY-MM-DD. */
  contractDate: string | null
  optionEndDate: string | null
  closingDate: string | null
  vestingEntity: string | null
  financedPropertiesCount: number | null
  subjectPropertyId: string | null
  // Lender loan information (1003 sections 4 and L)
  mortgageType: MortgageType | null
  amortizationType: AmortizationType
  titleNames: string | null
  titleManner: string | null
  estateType: EstateType
  hasBalloon: boolean
  hasInterestOnly: boolean
  hasNegativeAmortization: boolean
  hasPrepaymentPenalty: boolean
  improvementsAmount: number | null
  estimatedClosingCosts: number | null
  prepaidItemsAmount: number | null
  discountPointsAmount: number | null
  sellerCredits: number | null
  lenderCredits: number | null
  // Prequal estimates for a home not picked yet (the subject property's figures win once entered)
  /** Yearly property tax as a percent of the price or value. */
  estimatedTaxRatePct: number | null
  estimatedAnnualInsurance: number | null
  estimatedMonthlyHoa: number | null
  /** Mortgage insurance overrides; null uses the loan type's default. */
  miRatePct: number | null
  upfrontFeePct: number | null
  /** The file's loan number in Arive. */
  ariveLoanNumber: string | null
  // Purchase contract terms (sales price, effective, option and closing dates and seller credits are above; earnest money is a 1003 asset)
  optionFee: number | null
  /** The financing amount in the contract's Third Party Financing addendum. */
  contractFinancingAmount: number | null
  financingDeadline: string | null
  surveyDeadline: string | null
  titlePolicyPaidBy: ContractParty | null
  possession: PossessionTerms | null
  /** Null = not known yet. */
  hasHoaAddendum: boolean | null
  // Readiness (call notes to pre-qual)
  /** How income will be documented; null = not decided (treated as full documentation). */
  incomeDocType: IncomeDocType | null
  /** When they want to buy or refinance, in their words. */
  timeline: string | null
  // Pricing (filled by "Use for this loan" on the Pricing tab, or typed)
  estimatedFundingDate: string | null
  firstPaymentDate: string | null
  impoundWaiver: ImpoundWaiver
  qualifyingRate: number | null
  buydown: Buydown | null
  supplementalInsuranceMonthly: number | null
  otherPaymentMonthly: number | null
  otherPaymentLabel: string | null
  /** The pricing scenario last used for this loan. */
  pricingScenarioId: string | null
  /** The lender program chosen on Loan · Pricing, and the quote it was chosen from. */
  programId: string | null
  chosenQuoteId: string | null
}

export type ImpoundWaiver = 'none' | 'taxes' | 'insurance' | 'all'
export type Buydown = '1-0' | '2-1' | '3-2-1'

export type ContractParty = 'seller' | 'buyer'
export type IncomeDocType = 'full_doc' | 'bank_statement' | 'form_1099' | 'asset_based' | 'dscr'
export type PossessionTerms = 'closing_and_funding' | 'temporary_lease'

/** The full borrower profile for one loan. */
export interface LoanProfile extends PipelineLoan {
  details: LoanDetails
  organizationId: string
}

export interface Lien {
  id: string
  propertyId: string
  position: 'first' | 'second'
  lender: string | null
  balance: number | null
  noteRate: number | null
  monthlyPayment: number | null
  isHeloc: boolean
  originatedOn: string | null
  isTexasCashOut: boolean
  toBePaidOff: boolean
  creditLimit: number | null
  mortgageType: MortgageType | null
}

export interface Property {
  id: string
  loanId: string
  addressLine: string
  city: string | null
  state: string
  zip: string | null
  county: string | null
  propertyType: PropertyType | null
  status: PropertyStatus
  listPrice: number | null
  estimatedValue: number | null
  annualTaxes: number | null
  annualInsurance: number | null
  monthlyHoa: number | null
  monthlyRent: number | null
  isHomestead: boolean
  listingUrl: string | null
  unitCount: number | null
  reoDisposition: ReoDisposition | null
  reoOccupancy: Occupancy | null
  /** Set from the Income tab: 75% of the lease, or the Schedule E figure. */
  rentalIncomeMethod: RentalIncomeMethod
  /** Schedule E monthly income before the property's payment (Income tab). */
  scheduleEMonthlyIncome: number | null
  createdAt: string
  liens: Lien[]
}

export type RentalIncomeMethod = 'lease' | 'schedule_e'

export interface Note {
  id: string
  contactId: string
  loanId: string | null
  kind: NoteKind
  body: string
  pinned: boolean
  author: MemberRef | null
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  loanId: string
  title: string
  dueOn: string | null
  completedAt: string | null
  assignedTo: MemberRef | null
  createdAt: string
  /** Set when the task was made from a contract deadline (e.g. "contract:option_end"). */
  sourceKey: string | null
}
