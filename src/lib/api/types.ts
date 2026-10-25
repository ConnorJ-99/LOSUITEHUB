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
export type PropertyStatus = 'interested' | 'offer_made' | 'under_contract' | 'passed' | 'current_home'
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
}

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
  createdAt: string
  liens: Lien[]
}

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
}
