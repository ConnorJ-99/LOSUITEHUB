// "Applies when" on a checklist / condition rule (build plan Phase 8). The
// same filters decide the borrower document checklist and the Conditions
// tab's suggestions, so one rule list in Settings drives both. A rule with no
// filters applies to every file, as before. Pure, no imports beyond types.

import type { IncomeDocType, MortgageType, Occupancy, PropertyType } from '@/lib/api/types'
import type { LoanPurpose } from '@/lib/pipeline/stages'

export type ConditionPartyValue = 'borrower' | 'title' | 'realtor' | 'processor_lo' | 'appraisal'
export type RuleStage = 'application' | 'processing' | 'before_closing'

/** The filters and where a rule shows (null / empty = any). */
export interface RuleFilters {
  /** "both" = the borrower checklist and conditions; "conditions" = conditions only. */
  useFor: 'both' | 'conditions'
  /** Per borrower, or once for the whole file. */
  scope: 'person' | 'file'
  party: ConditionPartyValue
  stage: RuleStage
  mortgageTypes: MortgageType[] | null
  purposes: LoanPurpose[] | null
  occupancies: Occupancy[] | null
  propertyTypes: PropertyType[] | null
  incomeDocTypes: IncomeDocType[] | null
  /** true = only Texas §50(a)(6) cash-out; false = never; null = any. */
  texasCashOut: boolean | null
  /** true = only when the file vests in an entity (LLC). */
  entityVesting: boolean | null
  /** true = only a VA loan marked funding-fee exempt. */
  vaExempt: boolean | null
  lenderId: string | null
  programId: string | null
}

export const NO_RULE_FILTERS: RuleFilters = {
  useFor: 'both',
  scope: 'person',
  party: 'borrower',
  stage: 'processing',
  mortgageTypes: null,
  purposes: null,
  occupancies: null,
  propertyTypes: null,
  incomeDocTypes: null,
  texasCashOut: null,
  entityVesting: null,
  vaExempt: null,
  lenderId: null,
  programId: null,
}

/** What the filters look at on a file. */
export interface RuleFacts {
  mortgageType: MortgageType | null
  purpose: LoanPurpose
  occupancy: Occupancy | null
  /** The subject home's type, when there is one. */
  propertyType: PropertyType | null
  incomeDocType: IncomeDocType | null
  texasCashOut: boolean
  /** The entity the file vests in ("Sample LLC"), or null. */
  entityVesting: string | null
  vaExempt: boolean
  lenderId: string | null
  programId: string | null
}

const listOk = <T>(list: T[] | null | undefined, value: T | null) => !list?.length || (value != null && list.includes(value))
const flagOk = (want: boolean | null | undefined, has: boolean) => want == null || want === has

export function hasFilters(f: Partial<RuleFilters>): boolean {
  return !!(f.mortgageTypes?.length || f.purposes?.length || f.occupancies?.length || f.propertyTypes?.length || f.incomeDocTypes?.length || f.texasCashOut != null || f.entityVesting != null || f.vaExempt != null || f.lenderId || f.programId)
}

/** Whether a rule's filters fit this file. */
export function appliesTo(f: Partial<RuleFilters>, facts: RuleFacts): boolean {
  return (
    listOk(f.mortgageTypes, facts.mortgageType) &&
    listOk(f.purposes, facts.purpose) &&
    listOk(f.occupancies, facts.occupancy) &&
    listOk(f.propertyTypes, facts.propertyType) &&
    listOk(f.incomeDocTypes, facts.incomeDocType ?? 'full_doc') &&
    flagOk(f.texasCashOut, facts.texasCashOut) &&
    flagOk(f.entityVesting, !!facts.entityVesting?.trim()) &&
    flagOk(f.vaExempt, facts.vaExempt) &&
    (!f.lenderId || f.lenderId === facts.lenderId) &&
    (!f.programId || f.programId === facts.programId)
  )
}

/** A VA loan with its upfront fee set to 0 is marked exempt. */
export const isVaExempt = (mortgageType: MortgageType | null, upfrontFeePct: number | null) => mortgageType === 'va' && upfrontFeePct === 0
