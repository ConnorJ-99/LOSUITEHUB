import type { Organization, Profile } from '@/lib/api/settings'
import type { LoanProfile, Property } from '@/lib/api/types'
import type { Application, Declarations } from '@/lib/api/urla'
import { fullName } from '@/lib/pipeline/helpers'

export interface ChecklistItem {
  /** Who or what the item is about: "Loan", a borrower's name, or "Originator". */
  area: string
  message: string
  /** 1003 section anchor to jump to. */
  section: string
}

const DECLARATION_KEYS: (keyof Declarations)[] = [
  'willOccupyAsPrimary', 'ownedPropertyPast3Years', 'borrowingUndisclosedMoney', 'applyingOtherMortgage', 'applyingNewCredit',
  'subjectToPriorityLien', 'cosignerOrGuarantor', 'outstandingJudgments', 'delinquentFederalDebt', 'partyToLawsuit',
  'deedInLieuPast7Years', 'shortSalePast7Years', 'foreclosurePast7Years', 'bankruptcyPast7Years',
]

/**
 * Items worth filling in before exporting to Arive. None of them block the
 * export; they're what an underwriter or Arive's import would otherwise flag.
 */
export function exportChecklist(input: {
  loan: LoanProfile
  application: Application
  properties: Property[]
  organization: Organization | null
  originator: Profile | null
}): ChecklistItem[] {
  const { loan, application, properties, organization, originator } = input
  const d = loan.details
  const items: ChecklistItem[] = []
  const add = (area: string, section: string, message: string) => items.push({ area, message, section })
  const subject = properties.find((p) => p.id === d.subjectPropertyId)
  const isPurchase = loan.purpose === 'purchase' || (loan.purpose === 'investment_dscr' && d.purchasePrice !== null)

  if (d.loanAmount === null) add('Loan', 'section-4', 'Loan amount')
  if (d.noteRate === null) add('Loan', 'section-4', 'Note rate')
  if (d.termMonths === null && loan.purpose !== 'heloc') add('Loan', 'section-4', 'Loan term')
  if (!d.mortgageType) add('Loan', 'section-4', 'Mortgage type (Conventional, FHA, VA, USDA)')
  if (isPurchase && d.purchasePrice === null) add('Loan', 'section-4', 'Sales contract price')
  if (!subject) add('Loan', 'section-4', isPurchase ? 'Subject property (choose it on Properties once under contract)' : 'Subject property: add the home on the Properties tab')
  else if (subject.estimatedValue === null) add('Loan', 'section-4', 'Subject property value')

  for (const b of application.borrowers) {
    const name = fullName(b.person)
    const p = b.person
    if (!p.dateOfBirth) add(name, 'section-1', 'Date of birth')
    if (!p.citizenship) add(name, 'section-1', 'Citizenship')
    if (!p.maritalStatus) add(name, 'section-1', 'Marital status')
    if (!p.phone && !p.homePhone && !p.email) add(name, 'section-1', 'A phone number or email')
    const current = b.addresses.find((a) => a.kind === 'current')
    if (!current) add(name, 'section-1-addresses', 'Current address')
    else if (current.monthsAtAddress === null) add(name, 'section-1-addresses', 'Time at current address')
    else if (current.monthsAtAddress < 24 && !b.addresses.some((a) => a.kind === 'former')) add(name, 'section-1-addresses', 'Former address (under 2 years at current)')
    if (!b.employments.some((e) => e.status === 'current') && b.otherIncomes.length === 0) add(name, 'section-1-employment', 'Current employment or other income')
    const unanswered = DECLARATION_KEYS.filter((k) => b.declarations[k] === null).length
    if (unanswered > 0) add(name, 'section-5', `${unanswered} declaration question${unanswered === 1 ? '' : 's'} unanswered`)
    const demo = b.declarations
    if (demo.ethnicities.length === 0 || demo.races.length === 0 || demo.sexes.length === 0) add(name, 'section-8', 'Demographic information (or "do not wish to provide")')
  }

  if (!organization?.nmls) add('Originator', 'section-9', 'Company NMLS # (Settings)')
  if (!organization?.addressLine) add('Originator', 'section-9', 'Company address (Settings)')
  if (!originator) add('Originator', 'section-9', 'Assigned loan officer')
  else if (!originator.nmls) add('Originator', 'section-9', 'Loan officer NMLS # (Settings)')

  return items
}

/** A safe file name like LOSuite_Borrower_2026-10-25.xml. */
export function exportFileName(lastName: string | undefined, isoDate: string): string {
  const cleaned = (lastName ?? 'Loan').replace(/[^A-Za-z0-9-]+/g, '') || 'Loan'
  return `LOSuite_MISMO34_${cleaned}_${isoDate}.xml`
}
