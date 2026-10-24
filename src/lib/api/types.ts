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
