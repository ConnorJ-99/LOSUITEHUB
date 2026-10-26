import type { Organization, Profile } from '@/lib/api/settings'
import type { LoanProfile, Property } from '@/lib/api/types'
import type { Application, ApplicationBorrower, Declarations } from '@/lib/api/urla'
import { fullName } from '@/lib/pipeline/helpers'
import { ownedProperties } from '@/lib/urla/realEstate'

// 1003 completeness: each URLA section's status and every missing required
// field, for the section checklist and Validate Application. Pure functions.

export type UrlaSectionId =
  | 'loan'
  | 'property'
  | 'borrower'
  | 'credit'
  | 'income'
  | 'assets'
  | 'liabilities'
  | 'reo'
  | 'declarations'
  | 'demographics'
  | 'origination'

export interface UrlaIssue {
  section: UrlaSectionId
  /** What's missing, in plain words, e.g. "Date of birth". */
  field: string
  /** Which borrower, when it's a person field. */
  borrower?: string
  contactId?: string
}

export interface UrlaSectionStatus {
  id: UrlaSectionId
  label: string
  /** Where the section starts on the 1003 tab. */
  anchor: string
  missing: number
  started: boolean
}

export interface UrlaValidation {
  sections: UrlaSectionStatus[]
  issues: UrlaIssue[]
  totalMissing: number
}

export const URLA_SECTIONS: readonly { id: UrlaSectionId; label: string; anchor: string }[] = [
  { id: 'loan', label: 'Loan Information', anchor: 'section-4' },
  { id: 'property', label: 'Subject Property', anchor: 'section-4' },
  { id: 'borrower', label: 'Borrower Info', anchor: 'section-1' },
  { id: 'credit', label: 'Credit Scores', anchor: 'section-1' },
  { id: 'income', label: 'Employment & Income', anchor: 'section-1-employment' },
  { id: 'assets', label: 'Assets', anchor: 'section-2' },
  { id: 'liabilities', label: 'Liabilities', anchor: 'section-2-liabilities' },
  { id: 'reo', label: 'Real Estate Owned', anchor: 'section-3' },
  { id: 'declarations', label: 'Declarations', anchor: 'section-5' },
  { id: 'demographics', label: 'Demographic Information', anchor: 'section-8' },
  { id: 'origination', label: 'Origination Party', anchor: 'section-9' },
]

export interface UrlaInput {
  loan: LoanProfile
  app: Application
  properties: Property[]
  organization: Organization | null
  originator: Profile | null
}

const YES_NO_QUESTIONS: readonly [keyof Declarations, string][] = [
  ['willOccupyAsPrimary', 'Will occupy as primary residence'],
  ['familyRelationshipWithSeller', 'Relationship with the seller'],
  ['borrowingUndisclosedMoney', 'Borrowing undisclosed money'],
  ['applyingOtherMortgage', 'Applying for another mortgage'],
  ['applyingNewCredit', 'Applying for new credit'],
  ['subjectToPriorityLien', 'Subject to a priority lien'],
  ['cosignerOrGuarantor', 'Co-signer or guarantor'],
  ['outstandingJudgments', 'Outstanding judgments'],
  ['delinquentFederalDebt', 'Delinquent federal debt'],
  ['partyToLawsuit', 'Party to a lawsuit'],
  ['deedInLieuPast7Years', 'Deed in lieu (7 years)'],
  ['shortSalePast7Years', 'Short sale (7 years)'],
  ['foreclosurePast7Years', 'Foreclosure (7 years)'],
  ['bankruptcyPast7Years', 'Bankruptcy (7 years)'],
]

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

function borrowerIssues(b: ApplicationBorrower, isPurchase: boolean): UrlaIssue[] {
  const who = { borrower: fullName(b.person), contactId: b.contactId }
  const issues: UrlaIssue[] = []
  const add = (section: UrlaSectionId, field: string) => issues.push({ section, field, ...who })

  const p = b.person
  if (blank(p.firstName)) add('borrower', 'First name')
  if (blank(p.lastName)) add('borrower', 'Last name')
  if (blank(p.dateOfBirth)) add('borrower', 'Date of birth')
  if (blank(p.citizenship)) add('borrower', 'Citizenship')
  if (blank(p.maritalStatus)) add('borrower', 'Marital status')
  if (blank(p.phone) && blank(p.email)) add('borrower', 'Phone or email')
  const current = b.addresses.find((a) => a.kind === 'current')
  if (!current) add('borrower', 'Current address')
  else if (current.monthsAtAddress === null) add('borrower', 'Time at current address')
  else if (current.monthsAtAddress < 24 && !b.addresses.some((a) => a.kind === 'former')) add('borrower', 'Former address (under 2 years at current)')

  if (b.estimatedCreditScore === null) add('credit', 'Credit score')

  const jobs = b.employments.filter((e) => e.status === 'current')
  if (jobs.length === 0 && b.otherIncomes.length === 0) add('income', 'Current job or other income')
  for (const e of jobs) {
    if (blank(e.startDate)) add('income', `Start date (${e.employerName})`)
    if (e.isSelfEmployed ? e.selfEmployedIncome === null : e.baseIncome === null) add('income', `Monthly income (${e.employerName})`)
  }

  const d = b.declarations
  for (const [key, label] of YES_NO_QUESTIONS) {
    if (key === 'familyRelationshipWithSeller' && !isPurchase) continue
    if (d[key] === null) add('declarations', label)
  }
  if (d.ownedPropertyPast3Years === null) add('declarations', 'Owned property in the last 3 years')

  if (d.ethnicities.length === 0) add('demographics', 'Ethnicity (or chose not to provide)')
  if (d.races.length === 0) add('demographics', 'Race (or chose not to provide)')
  if (d.sexes.length === 0) add('demographics', 'Sex (or chose not to provide)')
  if (d.applicationMethod === null) add('demographics', 'How the application was taken')
  return issues
}

/** Every missing required 1003 field, grouped into URLA sections with a status for each. */
export function validateApplication({ loan, app, properties, organization, originator }: UrlaInput): UrlaValidation {
  const isPurchase = loan.purpose === 'purchase'
  const d = loan.details
  const issues: UrlaIssue[] = []
  const add = (section: UrlaSectionId, field: string) => issues.push({ section, field })

  if (d.loanAmount === null) add('loan', 'Loan amount')
  if (d.mortgageType === null) add('loan', 'Loan type')
  if (d.termMonths === null) add('loan', 'Term')
  if (d.noteRate === null) add('loan', 'Interest rate')
  if (isPurchase && d.purchasePrice === null) add('loan', 'Purchase price')

  const subject = properties.find((p) => p.id === d.subjectPropertyId) ?? null
  if (!subject) {
    // A purchase can be pre-approved before a home is chosen ("TBD").
    if (!isPurchase) add('property', 'Subject property')
  } else {
    if (blank(subject.city)) add('property', 'City')
    if (blank(subject.zip)) add('property', 'ZIP')
    if (subject.propertyType === null) add('property', 'Property type')
    if (!isPurchase && subject.estimatedValue === null) add('property', 'Estimated value')
  }

  for (const b of app.borrowers) issues.push(...borrowerIssues(b, isPurchase))

  for (const p of ownedProperties(properties).filter((p) => p.id !== d.subjectPropertyId)) {
    if (p.estimatedValue === null) issues.push({ section: 'reo', field: `Value (${p.addressLine})` })
  }

  if (blank(organization?.nmls)) add('origination', 'Company NMLS (Settings)')
  if (blank(originator?.fullName)) add('origination', 'Loan officer name (Settings)')
  if (blank(originator?.nmls)) add('origination', 'Loan officer NMLS (Settings)')

  const started: Record<UrlaSectionId, boolean> = {
    loan: d.loanAmount !== null || d.mortgageType !== null || d.noteRate !== null,
    property: subject !== null,
    borrower: app.borrowers.some((b) => b.person.dateOfBirth !== null || b.addresses.length > 0),
    credit: app.borrowers.some((b) => b.estimatedCreditScore !== null),
    income: app.borrowers.some((b) => b.employments.length > 0 || b.otherIncomes.length > 0),
    assets: app.assets.length > 0,
    liabilities: app.liabilities.length > 0,
    reo: ownedProperties(properties).some((p) => p.id !== d.subjectPropertyId),
    declarations: app.borrowers.some((b) => YES_NO_QUESTIONS.some(([k]) => b.declarations[k] !== null)),
    demographics: app.borrowers.some((b) => b.declarations.ethnicities.length > 0 || b.declarations.races.length > 0 || b.declarations.applicationMethod !== null),
    origination: !blank(organization?.nmls) || !blank(originator?.nmls),
  }

  const sections = URLA_SECTIONS.map((s) => ({
    ...s,
    missing: issues.filter((i) => i.section === s.id).length,
    // Optional sections (assets, liabilities, REO) never count as missing; empty just shows as not started.
    started: started[s.id],
  }))
  return { sections, issues, totalMissing: issues.length }
}
