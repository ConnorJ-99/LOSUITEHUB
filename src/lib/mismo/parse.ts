import type { AmortizationType, EstateType, LoanDetails, MortgageType, Occupancy, ReoDisposition } from '@/lib/api/types'
import { emptyDeclarations, type Address, type Asset, type Declarations, type Employment, type Liability, type OtherIncome, type PersonDetails } from '@/lib/api/urla'
import type { LoanPurposeKind } from '@/lib/calc'
import type { AssetType, HmdaEthnicity, HmdaRace, HmdaSex, LiabilityType, OtherIncomeType } from '@/lib/urla/options'
import * as map from './maps'
import { attr, descendants, kid, parseXml, path, textAt, type XElement } from './xmlRead'

// Reads a MISMO v3.4 (Fannie Mae ULAD) file into LOSuite's 1003 shape.
// Social Security numbers are counted and ignored, never kept (decisions log).

export type ImportedAddress = Omit<Address, 'id' | 'contactId'>
export type ImportedEmployment = Omit<Employment, 'id' | 'contactId'>
export type ImportedOtherIncome = Omit<OtherIncome, 'id' | 'contactId'>

export interface ImportedBorrower {
  isPrimary: boolean
  person: PersonDetails
  addresses: ImportedAddress[]
  employments: ImportedEmployment[]
  otherIncomes: ImportedOtherIncome[]
  declarations: Declarations
}

/** Owners are indexes into `borrowers`; more than one means joint. */
export type ImportedAsset = Omit<Asset, 'id' | 'loanId' | 'contactId' | 'isJoint'> & { owners: number[] }
export type ImportedLiability = Omit<Liability, 'id' | 'loanId' | 'contactId' | 'isJoint'> & { owners: number[] }

export interface ImportedLien {
  position: 'first' | 'second'
  lender: string | null
  balance: number | null
  monthlyPayment: number | null
  isHeloc: boolean
  creditLimit: number | null
  toBePaidOff: boolean
  mortgageType: MortgageType | null
}

export interface ImportedProperty {
  addressLine: string
  unit: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  estimatedValue: number | null
  unitCount: number | null
  reoDisposition: ReoDisposition | null
  reoOccupancy: Occupancy | null
  monthlyRent: number | null
  /** ULAD sends taxes, insurance and HOA as one monthly amount. */
  monthlyMaintenance: number | null
  liens: ImportedLien[]
}

export interface ImportResult {
  borrowers: ImportedBorrower[]
  assets: ImportedAsset[]
  liabilities: ImportedLiability[]
  /** The home this loan is on (address and value), with its existing liens. */
  subject: ImportedProperty | null
  /** Other real estate owned. */
  ownedProperties: ImportedProperty[]
  loan: Partial<LoanDetails>
  /** The file's loan purpose, for comparison only; imports never change the loan's purpose. */
  filePurpose: LoanPurposeKind | null
  ssnCount: number
  warnings: string[]
}

export class MismoImportError extends Error {}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

const invert = <K extends string>(m: Partial<Record<K, string>>): Record<string, K> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [String(v).toLowerCase(), k])) as Record<string, K>

const lookup = <K extends string>(m: Record<string, K>, value: string | null): K | null => (value ? (m[value.toLowerCase()] ?? null) : null)

const num = (v: string | null): number | null => {
  if (v === null) return null
  const n = Number(v.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
const int = (v: string | null) => {
  const n = num(v)
  return n === null ? null : Math.round(n)
}
const bool = (v: string | null): boolean | null => (v === null ? null : v.toLowerCase() === 'true' ? true : v.toLowerCase() === 'false' ? false : null)
const yesNo = (v: string | null): boolean | null => (v === null ? null : v.toLowerCase() === 'yes' ? true : v.toLowerCase() === 'no' ? false : null)
const isoDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
const last4 = (v: string | null) => {
  const digits = (v ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}
const months = (years: string | null, monthsPart: string | null) => {
  const y = int(years)
  const m = int(monthsPart)
  return y === null && m === null ? null : (y ?? 0) * 12 + (m ?? 0)
}

const rev = {
  citizenship: invert(map.citizenship),
  maritalStatus: invert(map.maritalStatus),
  residencyBasis: invert(map.residencyBasis),
  priorUsage: invert(map.priorUsage),
  priorTitle: invert(map.priorTitle),
  otherIncome: invert(map.otherIncome),
  assetType: invert(map.assetType),
  giftSource: invert(map.giftSource),
  liabilityType: invert(map.liabilityType),
  expenseType: invert(map.expenseType),
  mortgageType: invert(map.mortgageType),
  propertyUsage: invert(map.propertyUsage) as Record<string, Occupancy>,
  disposition: invert(map.ownedDisposition) as Record<string, ReoDisposition>,
  applicationMethod: invert(map.applicationMethod),
  raceDesignation: invert(map.raceDesignation),
  raceType: invert(map.raceType),
  ethnicityOrigin: invert(map.ethnicityOrigin),
}

/** PurchaseCreditType (+ other description) -> LOSuite credit asset type. */
function creditType(type: string | null, description: string | null): AssetType | null {
  const t = (type ?? '').toLowerCase()
  if (t === 'other') return /lot/i.test(description ?? '') ? 'lot_equity' : 'other_credit'
  for (const [ours, [mismo]] of Object.entries(map.purchaseCredit) as [AssetType, [string]][]) if (mismo.toLowerCase() === t) return ours
  return t ? 'other_credit' : null
}

const MORTGAGE_LIABILITY_TYPES = new Set(['mortgageloan', 'heloc', 'firstpositionmortgagelien', 'secondpositionmortgagelien', 'thirdpositionmortgagelien'])

function addressOf(a: XElement | null) {
  return {
    addressLine: textAt(a, 'AddressLineText') ?? '',
    unit: textAt(a, 'AddressUnitIdentifier'),
    city: textAt(a, 'CityName'),
    state: textAt(a, 'StateCode')?.toUpperCase().slice(0, 2) ?? null,
    zip: textAt(a, 'PostalCode'),
    county: textAt(a, 'CountyName'),
    country: textAt(a, 'CountryCode') ?? 'US',
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface Rel {
  from: string
  to: string
  kind: string
}

/** Parses a MISMO 3.4 file. Throws MismoImportError when it isn't one. */
export function parseMismo34(xmlText: string): ImportResult {
  let root: XElement
  try {
    root = parseXml(xmlText)
  } catch (e) {
    throw new MismoImportError(`This file isn't valid XML (${(e as Error).message}).`)
  }
  if (root.local !== 'MESSAGE') throw new MismoImportError('This is not a MISMO file (no MESSAGE element).')
  const deal = path(root, 'DEAL_SETS', 'DEAL_SET', 'DEALS', 'DEAL')[0]
  if (!deal) throw new MismoImportError('This MISMO file has no loan (DEAL) in it.')

  const warnings: string[] = []
  const version = attr(root, 'MISMOReferenceModelIdentifier') ?? attr(deal, 'MISMOReferenceModelIdentifier')
  if (version && !version.startsWith('3.4')) warnings.push(`File is MISMO ${version}; LOSuite reads 3.4. Some fields may be missed.`)

  // Count SSNs/TINs present so the preview can say they were ignored. Values are never read out.
  const ssnCount = descendants(root, 'TAXPAYER_IDENTIFIER').length

  const rels: Rel[] = path(deal, 'RELATIONSHIPS', 'RELATIONSHIP').map((r) => {
    const arc = attr(r, 'arcrole') ?? ''
    return { from: attr(r, 'from') ?? '', to: attr(r, 'to') ?? '', kind: arc.slice(arc.lastIndexOf('/') + 1).toLowerCase() }
  })
  const relTargets = (from: string | null, kind: string) => (from ? rels.filter((r) => r.from === from && r.kind === kind).map((r) => r.to) : [])

  // --- Borrowers (primary first; owner indexes are assigned after sorting) ---
  const found: { label: string | null; borrower: ImportedBorrower }[] = []
  for (const party of path(deal, 'PARTIES', 'PARTY')) {
    for (const role of path(party, 'ROLES', 'ROLE')) {
      if (textAt(role, 'ROLE_DETAIL', 'PartyRoleType') !== 'Borrower') continue
      found.push({ label: attr(role, 'label'), borrower: readBorrower(party, kid(role, 'BORROWER'), rels, warnings) })
    }
  }
  if (found.length === 0) throw new MismoImportError('No borrowers were found in this file.')
  if (!found.some((f) => f.borrower.isPrimary)) found[0].borrower.isPrimary = true
  found.sort((a, b) => Number(b.borrower.isPrimary) - Number(a.borrower.isPrimary))
  const borrowers = found.map((f) => f.borrower)
  const roleIndex = new Map(found.flatMap((f, i) => (f.label ? [[f.label, i] as const] : [])))
  /** Borrower indexes for a set of ROLE labels; unlinked items go to the primary borrower. */
  const owners = (labels: string[]) => {
    const idx = [...new Set(labels.map((l) => roleIndex.get(l)).filter((i): i is number => i !== undefined))]
    return idx.length ? idx : [0]
  }

  // --- Loan ---
  const loanEl = path(deal, 'LOANS', 'LOAN').find((l) => attr(l, 'LoanRoleType') === 'SubjectLoan') ?? path(deal, 'LOANS', 'LOAN')[0] ?? null
  const terms = kid(loanEl, 'TERMS_OF_LOAN')
  const urla = path(loanEl, 'DOCUMENT_SPECIFIC_DATA_SETS', 'DOCUMENT_SPECIFIC_DATA_SET', 'URLA', 'URLA_DETAIL')[0] ?? null
  const amort = path(loanEl, 'AMORTIZATION', 'AMORTIZATION_RULE')[0] ?? null
  const maturity = path(loanEl, 'MATURITY', 'MATURITY_RULE')[0] ?? null
  const detail = kid(loanEl, 'LOAN_DETAIL')
  const periodMonths = (count: string | null, type: string | null) => {
    const n = int(count)
    return n === null ? null : (type ?? 'Month').toLowerCase() === 'year' ? n * 12 : n
  }
  const subjectEl = path(deal, 'COLLATERALS', 'COLLATERAL', 'SUBJECT_PROPERTY')[0] ?? null
  const subjectDetail = kid(subjectEl, 'PROPERTY_DETAIL')
  const purposeType = textAt(terms, 'LoanPurposeType')
  const lien = textAt(terms, 'LienPriorityType')
  const cashOutType = textAt(loanEl, 'REFINANCE', 'RefinanceCashOutDeterminationType')
  const filePurpose: LoanPurposeKind | null =
    purposeType === 'Purchase'
      ? 'purchase'
      : purposeType === 'Refinance'
        ? lien === 'SecondLien'
          ? bool(textAt(detail, 'HELOCIndicator'))
            ? 'heloc'
            : 'heloan'
          : cashOutType === 'CashOut'
            ? 'refinance_cash_out'
            : 'refinance_rate_term'
        : null

  const loan: Partial<LoanDetails> = {}
  const set = <K extends keyof LoanDetails>(key: K, value: LoanDetails[K] | null | undefined) => {
    if (value !== null && value !== undefined) loan[key] = value
  }
  set('loanAmount', num(textAt(terms, 'BaseLoanAmount')) ?? num(textAt(terms, 'NoteAmount')) ?? num(textAt(urla, 'BorrowerRequestedLoanAmount')))
  set('noteRate', num(textAt(terms, 'NoteRatePercent')))
  set('mortgageType', lookup(rev.mortgageType, textAt(terms, 'MortgageType')) as MortgageType | null)
  set('termMonths', periodMonths(textAt(amort, 'LoanAmortizationPeriodCount'), textAt(amort, 'LoanAmortizationPeriodType')) ?? periodMonths(textAt(maturity, 'LoanMaturityPeriodCount'), textAt(maturity, 'LoanMaturityPeriodType')))
  const amortType = textAt(amort, 'AmortizationType')
  set('amortizationType', (amortType ? (amortType === 'AdjustableRate' ? 'arm' : 'fixed') : null) as AmortizationType | null)
  set('purchasePrice', num(textAt(urla, 'PurchasePriceAmount')) ?? num(textAt(subjectEl, 'SALES_CONTRACTS', 'SALES_CONTRACT', 'SALES_CONTRACT_DETAIL', 'SalesContractAmount')))
  set('cashOutAmount', num(textAt(loanEl, 'REFINANCE', 'RefinanceCashOutAmount')))
  set('estimatedClosingCosts', num(textAt(urla, 'EstimatedClosingCostsAmount')))
  set('prepaidItemsAmount', num(textAt(urla, 'PrepaidItemsEstimatedAmount')))
  set('discountPointsAmount', num(textAt(urla, 'BorrowerPaidDiscountPointsTotalAmount')))
  set('improvementsAmount', num(textAt(urla, 'AlterationsImprovementsAndRepairsAmount')))
  set('sellerCredits', num(textAt(urla, 'SellerPaidClosingCostsAmount')))
  set('hasBalloon', bool(textAt(detail, 'BalloonIndicator')))
  set('hasInterestOnly', bool(textAt(detail, 'InterestOnlyIndicator')))
  set('hasNegativeAmortization', bool(textAt(detail, 'NegativeAmortizationIndicator')))
  set('hasPrepaymentPenalty', bool(textAt(detail, 'PrepaymentPenaltyIndicator')))
  set('occupancy', lookup(rev.propertyUsage, textAt(subjectDetail, 'PropertyUsageType')))
  const estate = textAt(subjectDetail, 'PropertyEstateType')
  set('estateType', (estate ? (estate === 'Leasehold' ? 'leasehold' : 'fee_simple') : null) as EstateType | null)

  const method = lookup(rev.applicationMethod, textAt(urla, 'ApplicationTakenMethodType'))
  if (method) borrowers[0].declarations = { ...borrowers[0].declarations, applicationMethod: method as Declarations['applicationMethod'] }

  // --- Assets, credits, real estate owned ---
  const assets: ImportedAsset[] = []
  const ownedByLabel = new Map<string, ImportedProperty & { isSubject: boolean }>()
  for (const a of path(deal, 'ASSETS', 'ASSET')) {
    const label = attr(a, 'label')
    const owned = kid(a, 'OWNED_PROPERTY')
    if (owned) {
      const od = kid(owned, 'OWNED_PROPERTY_DETAIL')
      const prop = kid(owned, 'PROPERTY')
      const pd = kid(prop, 'PROPERTY_DETAIL')
      const addr = addressOf(kid(prop, 'ADDRESS'))
      const property = {
        ...addr,
        estimatedValue: num(textAt(pd, 'PropertyEstimatedValueAmount')),
        unitCount: int(textAt(od, 'OwnedPropertyOwnedUnitCount')),
        reoDisposition: lookup(rev.disposition, textAt(od, 'OwnedPropertyDispositionStatusType')),
        reoOccupancy: lookup(rev.propertyUsage, textAt(pd, 'PropertyUsageType')),
        monthlyRent: num(textAt(od, 'OwnedPropertyRentalIncomeGrossAmount')),
        monthlyMaintenance: num(textAt(od, 'OwnedPropertyMaintenanceExpenseAmount')),
        liens: [],
        isSubject: bool(textAt(od, 'OwnedPropertySubjectIndicator')) === true,
      }
      ownedByLabel.set(label ?? `owned-${ownedByLabel.size}`, property)
      continue
    }
    const d = kid(a, 'ASSET_DETAIL')
    const mismoType = textAt(d, 'AssetType')
    let type = lookup(rev.assetType, mismoType) as AssetType | null
    if (!type) {
      if (mismoType) warnings.push(`Asset type "${mismoType}" isn't in LOSuite's list; imported as "Other liquid asset".`)
      type = 'other_liquid'
    }
    assets.push({
      assetType: type,
      institutionName: textAt(a, 'ASSET_HOLDER', 'NAME', 'FullName'),
      accountLast4: last4(textAt(d, 'AssetAccountIdentifier')),
      amount: num(textAt(d, 'AssetCashOrMarketValueAmount')) ?? 0,
      giftSource: lookup(rev.giftSource, textAt(d, 'FundsSourceType')) as ImportedAsset['giftSource'],
      giftDeposited: null,
      description: textAt(d, 'AssetDescription'),
      owners: owners(relTargets(label, 'asset_isassociatedwith_role')),
    })
  }
  for (const c of path(loanEl, 'PURCHASE_CREDITS', 'PURCHASE_CREDIT')) {
    const type = creditType(textAt(c, 'PurchaseCreditType'), textAt(c, 'PurchaseCreditTypeOtherDescription'))
    const amount = num(textAt(c, 'PurchaseCreditAmount'))
    if (!type || amount === null) continue
    assets.push({ assetType: type, institutionName: null, accountLast4: null, amount, giftSource: null, giftDeposited: null, description: null, owners: [0] })
  }

  // --- Liabilities (mortgages become liens on their property) ---
  const liabilities: ImportedLiability[] = []
  const lienOwner = new Map<string, string>()
  for (const [assetLabel] of ownedByLabel) for (const to of relTargets(assetLabel, 'asset_isassociatedwith_liability')) lienOwner.set(to, assetLabel)
  for (const l of path(deal, 'LIABILITIES', 'LIABILITY')) {
    const label = attr(l, 'label')
    const d = kid(l, 'LIABILITY_DETAIL')
    const type = textAt(d, 'LiabilityType')
    const holder = textAt(l, 'LIABILITY_HOLDER', 'NAME', 'FullName')
    const propertyLabel = label ? lienOwner.get(label) : undefined
    if (propertyLabel || MORTGAGE_LIABILITY_TYPES.has((type ?? '').toLowerCase())) {
      const property = propertyLabel ? ownedByLabel.get(propertyLabel) : undefined
      if (!property) {
        warnings.push(`A mortgage${holder ? ` with ${holder}` : ''} isn't linked to a property, so it was skipped.`)
        continue
      }
      property.liens.push({
        position: (type ?? '').toLowerCase() === 'secondpositionmortgagelien' || property.liens.length > 0 ? 'second' : 'first',
        lender: holder,
        balance: num(textAt(d, 'LiabilityUnpaidBalanceAmount')),
        monthlyPayment: num(textAt(d, 'LiabilityMonthlyPaymentAmount')),
        isHeloc: (type ?? '').toLowerCase() === 'heloc',
        creditLimit: num(textAt(d, 'HELOCMaximumBalanceAmount')),
        toBePaidOff: bool(textAt(d, 'LiabilityPayoffStatusIndicator')) === true,
        mortgageType: lookup(rev.mortgageType, textAt(d, 'MortgageType')) as MortgageType | null,
      })
      continue
    }
    let ours = lookup(rev.liabilityType, type) as LiabilityType | null
    if (!ours) {
      if (type) warnings.push(`Liability type "${type}" isn't in LOSuite's list; imported as "Other debt".`)
      ours = 'other'
    }
    liabilities.push({
      liabilityType: ours,
      creditorName: holder,
      accountLast4: last4(textAt(d, 'LiabilityAccountIdentifier')),
      unpaidBalance: num(textAt(d, 'LiabilityUnpaidBalanceAmount')),
      monthlyPayment: num(textAt(d, 'LiabilityMonthlyPaymentAmount')) ?? 0,
      monthsRemaining: int(textAt(d, 'LiabilityRemainingTermMonthsCount')),
      toBePaidOff: bool(textAt(d, 'LiabilityPayoffStatusIndicator')) === true,
      description: textAt(d, 'LiabilityTypeOtherDescription'),
      owners: owners(relTargets(label, 'liability_isassociatedwith_role')),
    })
  }
  for (const e of path(deal, 'EXPENSES', 'EXPENSE')) {
    const label = attr(e, 'label')
    const ours = (lookup(rev.expenseType, textAt(e, 'ExpenseType')) as LiabilityType | null) ?? 'other_expense'
    liabilities.push({
      liabilityType: ours,
      creditorName: null,
      accountLast4: null,
      unpaidBalance: null,
      monthlyPayment: num(textAt(e, 'ExpenseMonthlyPaymentAmount')) ?? 0,
      monthsRemaining: null,
      toBePaidOff: false,
      description: textAt(e, 'ExpenseTypeOtherDescription'),
      owners: owners(relTargets(label, 'expense_isassociatedwith_role')),
    })
  }

  for (const p of ownedByLabel.values()) {
    if (p.liens.length > 2) {
      warnings.push(`${p.addressLine || 'A property'} has ${p.liens.length} mortgages; LOSuite keeps the first two.`)
      p.liens = p.liens.slice(0, 2)
    }
  }

  // --- Subject property: address/value from SUBJECT_PROPERTY, liens from its REO entry ---
  const strip = ({ isSubject, ...rest }: ImportedProperty & { isSubject: boolean }): ImportedProperty => {
    void isSubject
    return rest
  }
  const allOwned = [...ownedByLabel.values()]
  const subjectReo = allOwned.find((p) => p.isSubject)
  const subjectAddress = addressOf(kid(subjectEl, 'ADDRESS'))
  let subject: ImportedProperty | null = null
  if (subjectAddress.addressLine || subjectReo) {
    const reo = subjectReo ? strip(subjectReo) : null
    subject = {
      addressLine: subjectAddress.addressLine || reo?.addressLine || '',
      unit: subjectAddress.unit ?? reo?.unit ?? null,
      city: subjectAddress.city ?? reo?.city ?? null,
      state: subjectAddress.state ?? reo?.state ?? null,
      zip: subjectAddress.zip ?? reo?.zip ?? null,
      county: subjectAddress.county ?? reo?.county ?? null,
      estimatedValue: num(textAt(subjectDetail, 'PropertyEstimatedValueAmount')) ?? reo?.estimatedValue ?? null,
      unitCount: int(textAt(subjectDetail, 'FinancedUnitCount')) ?? reo?.unitCount ?? null,
      reoDisposition: reo?.reoDisposition ?? null,
      reoOccupancy: reo?.reoOccupancy ?? null,
      monthlyRent: reo?.monthlyRent ?? null,
      monthlyMaintenance: reo?.monthlyMaintenance ?? null,
      liens: reo?.liens ?? [],
    }
  }
  const ownedProperties = allOwned.filter((p) => !p.isSubject).map(strip)
  if (allOwned.some((p) => p.monthlyMaintenance)) {
    warnings.push('MISMO sends real estate taxes, insurance and HOA as one monthly amount. Properties already in LOSuite keep their own figures; for new ones it goes into Annual taxes, so split it out if needed.')
  }

  return {
    borrowers,
    assets,
    liabilities,
    subject,
    ownedProperties,
    loan,
    filePurpose,
    ssnCount,
    warnings,
  }
}

function readBorrower(party: XElement, b: XElement | null, rels: Rel[], warnings: string[]): ImportedBorrower {
  const individual = kid(party, 'INDIVIDUAL')
  const name = kid(individual, 'NAME')
  const bd = kid(b, 'BORROWER_DETAIL')
  const declDetail = path(b, 'DECLARATION', 'DECLARATION_DETAIL')[0] ?? null

  const person: PersonDetails = {
    firstName: textAt(name, 'FirstName') ?? textAt(name, 'FullName')?.split(' ')[0] ?? '',
    middleName: textAt(name, 'MiddleName'),
    lastName: textAt(name, 'LastName') ?? textAt(name, 'FullName')?.split(' ').slice(1).join(' ') ?? '',
    suffix: textAt(name, 'SuffixName'),
    email: null,
    phone: null,
    homePhone: null,
    workPhone: null,
    workPhoneExt: null,
    dateOfBirth: isoDate(textAt(bd, 'BorrowerBirthDate')),
    citizenship: lookup(rev.citizenship, textAt(declDetail, 'CitizenshipResidencyType')) as PersonDetails['citizenship'],
    maritalStatus: lookup(rev.maritalStatus, textAt(bd, 'MaritalStatusType')) as PersonDetails['maritalStatus'],
    dependentsCount: int(textAt(bd, 'DependentCount')),
    dependentsAges: path(b, 'DEPENDENTS', 'DEPENDENT').map((d) => textAt(d, 'DependentAgeYearsCount')).filter(Boolean).join(', ') || null,
    militaryService: bool(textAt(bd, 'SelfDeclaredMilitaryServiceIndicator')),
    militaryActiveDuty: false,
    militaryServiceExpiresOn: null,
    militaryRetired: false,
    militaryReserveOnly: false,
    militarySurvivingSpouse: bool(textAt(bd, 'SpousalVABenefitsEligibilityIndicator')) === true,
  }
  for (const cp of path(individual, 'CONTACT_POINTS', 'CONTACT_POINT')) {
    const role = textAt(cp, 'CONTACT_POINT_DETAIL', 'ContactPointRoleType')
    const phone = textAt(cp, 'CONTACT_POINT_TELEPHONE', 'ContactPointTelephoneValue')
    const email = textAt(cp, 'CONTACT_POINT_EMAIL', 'ContactPointEmailValue')
    if (email && !person.email) person.email = email
    if (!phone) continue
    if (role === 'Mobile' && !person.phone) person.phone = phone
    else if (role === 'Home' && !person.homePhone) person.homePhone = phone
    else if (role === 'Work' && !person.workPhone) {
      person.workPhone = phone
      person.workPhoneExt = textAt(cp, 'CONTACT_POINT_TELEPHONE', 'ContactPointTelephoneExtensionValue')
    } else if (!person.phone) person.phone = phone
  }
  for (const m of path(b, 'MILITARY_SERVICES', 'MILITARY_SERVICE')) {
    const status = textAt(m, 'MilitaryStatusType')
    if (status === 'ActiveDuty') {
      person.militaryActiveDuty = true
      person.militaryServiceExpiresOn = isoDate(textAt(m, 'MilitaryServiceExpectedCompletionDate'))
    } else if (status === 'Veteran' || status === 'Separated') person.militaryRetired = true
    else if (status === 'ReserveNationalGuardNeverActivated') person.militaryReserveOnly = true
  }

  // Addresses
  const addresses: ImportedAddress[] = path(b, 'RESIDENCES', 'RESIDENCE').map((r) => {
    const rd = kid(r, 'RESIDENCE_DETAIL')
    const { county, ...addr } = addressOf(kid(r, 'ADDRESS'))
    void county
    return {
      ...addr,
      kind: textAt(rd, 'BorrowerResidencyType') === 'Current' ? 'current' : 'former',
      housing: lookup(rev.residencyBasis, textAt(rd, 'BorrowerResidencyBasisType')) as ImportedAddress['housing'],
      monthlyRent: num(textAt(r, 'LANDLORD', 'LANDLORD_DETAIL', 'MonthlyRentAmount')),
      monthsAtAddress: months(textAt(rd, 'BorrowerResidencyDurationYearsCount'), textAt(rd, 'BorrowerResidencyDurationMonthsCount')),
    }
  })
  // Only one current address in LOSuite; extra "current" ones become former.
  let currentSeen = false
  for (const a of addresses) {
    if (a.kind === 'current') {
      if (currentSeen) a.kind = 'former'
      currentSeen = true
    }
  }
  const mailing = path(party, 'ADDRESSES', 'ADDRESS').find((a) => textAt(a, 'AddressType') === 'Mailing')
  if (mailing) {
    const { county, ...addr } = addressOf(mailing)
    void county
    addresses.push({ ...addr, kind: 'mailing', housing: null, monthlyRent: null, monthsAtAddress: null })
  }

  // Employment and income
  const employerByLabel = new Map<string, ImportedEmployment>()
  const employments: ImportedEmployment[] = path(b, 'EMPLOYERS', 'EMPLOYER').map((e, i) => {
    const emp = kid(e, 'EMPLOYMENT')
    const current = textAt(emp, 'EmploymentStatusType') !== 'Previous'
    const selfEmployed = bool(textAt(emp, 'EmploymentBorrowerSelfEmployedIndicator')) === true
    const monthly = num(textAt(emp, 'EmploymentMonthlyIncomeAmount'))
    const ownership = textAt(emp, 'OwnershipInterestType')
    const { county, country, ...addr } = addressOf(kid(e, 'ADDRESS'))
    void county
    void country
    const job: ImportedEmployment = {
      ...addr,
      addressLine: addr.addressLine || null,
      status: current ? 'current' : 'previous',
      sortOrder: i,
      employerName: textAt(e, 'LEGAL_ENTITY', 'LEGAL_ENTITY_DETAIL', 'FullName') ?? textAt(e, 'INDIVIDUAL', 'NAME', 'FullName') ?? 'Employer',
      employerPhone: descendants(kid(e, 'LEGAL_ENTITY'), 'ContactPointTelephoneValue')[0]?.text.trim() || null,
      positionTitle: textAt(emp, 'EmploymentPositionDescription'),
      startDate: isoDate(textAt(emp, 'EmploymentStartDate')),
      endDate: isoDate(textAt(emp, 'EmploymentEndDate')),
      monthsInLineOfWork: months(textAt(emp, 'EmploymentTimeInLineOfWorkYearsCount'), textAt(emp, 'EmploymentTimeInLineOfWorkMonthsCount')),
      employedByParty: bool(textAt(emp, 'SpecialBorrowerEmployerRelationshipIndicator')) === true,
      isSelfEmployed: selfEmployed,
      ownership25OrMore: ownership ? ownership === 'GreaterThanOrEqualTo25Percent' : null,
      baseIncome: current ? null : monthly,
      overtimeIncome: null,
      bonusIncome: null,
      commissionIncome: null,
      militaryEntitlements: null,
      otherEmploymentIncome: null,
      selfEmployedIncome: current && selfEmployed ? monthly : null,
    }
    const label = attr(e, 'label')
    if (label) employerByLabel.set(label, job)
    return job
  })

  const otherIncomes: ImportedOtherIncome[] = []
  const addTo = (job: ImportedEmployment, key: keyof ImportedEmployment, amount: number) => {
    ;(job[key] as number | null) = ((job[key] as number | null) ?? 0) + amount
  }
  for (const item of path(b, 'CURRENT_INCOME', 'CURRENT_INCOME_ITEMS', 'CURRENT_INCOME_ITEM')) {
    const d = kid(item, 'CURRENT_INCOME_ITEM_DETAIL')
    const type = textAt(d, 'IncomeType') ?? 'Other'
    const amount = num(textAt(d, 'CurrentIncomeMonthlyTotalAmount')) ?? 0
    const description = textAt(d, 'IncomeTypeOtherDescription')
    const label = attr(item, 'label')
    const isEmployment = bool(textAt(d, 'EmploymentIncomeIndicator')) === true
    if (isEmployment) {
      const employerLabel = rels.find((r) => r.from === label && r.kind === 'current_income_item_isassociatedwith_employer')?.to
      const job = (employerLabel ? employerByLabel.get(employerLabel) : undefined) ?? employments.find((e) => e.status === 'current')
      if (!job) {
        warnings.push(`${type} income of ${amount}/mo has no employer, so it was added as other income.`)
        otherIncomes.push({ incomeType: 'other', description: type, monthlyAmount: amount })
        continue
      }
      if (type === 'Base') addTo(job, 'baseIncome', amount)
      else if (type === 'Overtime') addTo(job, 'overtimeIncome', amount)
      else if (type === 'Bonus') addTo(job, 'bonusIncome', amount)
      else if (type === 'Commissions') addTo(job, 'commissionIncome', amount)
      else if (type === 'SelfEmploymentIncome') job.selfEmployedIncome = amount
      else if (type === 'SelfEmploymentLoss') job.selfEmployedIncome = -Math.abs(amount)
      else if (type.startsWith('Military') || /military/i.test(description ?? '')) addTo(job, 'militaryEntitlements', amount)
      else addTo(job, 'otherEmploymentIncome', amount)
      continue
    }
    const ours = lookup(rev.otherIncome, type) as OtherIncomeType | null
    otherIncomes.push({ incomeType: ours ?? 'other', description: ours && ours !== 'other' ? null : description ?? type, monthlyAmount: amount })
  }

  // Declarations and demographics
  const chapters = path(b, 'BANKRUPTCIES', 'BANKRUPTCY').map((x) => textAt(x, 'BANKRUPTCY_DETAIL', 'BankruptcyChapterType'))
  const gm = kid(b, 'GOVERNMENT_MONITORING')
  const gmd = kid(gm, 'GOVERNMENT_MONITORING_DETAIL')
  const ethnicities: HmdaEthnicity[] = []
  const ethnicityType = textAt(gmd, 'HMDAEthnicityType')
  if (ethnicityType === 'HispanicOrLatino') ethnicities.push('hispanic_or_latino')
  if (ethnicityType === 'NotHispanicOrLatino') ethnicities.push('not_hispanic_or_latino')
  let ethnicityOtherText: string | null = null
  for (const o of path(gm, 'HMDA_ETHNICITY_ORIGINS', 'HMDA_ETHNICITY_ORIGIN')) {
    const v = lookup(rev.ethnicityOrigin, textAt(o, 'HMDAEthnicityOriginType')) as HmdaEthnicity | null
    if (v) {
      if (!ethnicities.includes('hispanic_or_latino')) ethnicities.push('hispanic_or_latino')
      ethnicities.push(v)
      if (v === 'other_hispanic') ethnicityOtherText = textAt(o, 'HMDAEthnicityOriginTypeOtherDescription')
    }
  }
  if (bool(textAt(gmd, 'HMDAEthnicityRefusalIndicator'))) ethnicities.push('not_provided')

  const races: HmdaRace[] = []
  let raceTribeText: string | null = null
  let raceOtherAsianText: string | null = null
  let raceOtherPacificIslanderText: string | null = null
  for (const r of path(gm, 'HMDA_RACES', 'HMDA_RACE')) {
    const t = lookup(rev.raceType, textAt(r, 'HMDA_RACE_DETAIL', 'HMDARaceType')) as HmdaRace | null
    if (!t) continue
    races.push(t)
    if (t === 'american_indian_or_alaska_native') raceTribeText = textAt(r, 'HMDA_RACE_DETAIL', 'HMDARaceTypeAdditionalDescription')
    for (const dsg of path(r, 'HMDA_RACE_DESIGNATIONS', 'HMDA_RACE_DESIGNATION')) {
      const v = lookup(rev.raceDesignation, textAt(dsg, 'HMDARaceDesignationType')) as HmdaRace | null
      if (!v) continue
      races.push(v)
      raceOtherAsianText ??= textAt(dsg, 'HMDARaceDesignationOtherAsianDescription')
      raceOtherPacificIslanderText ??= textAt(dsg, 'HMDARaceDesignationOtherPacificIslanderDescription')
    }
  }
  if (bool(textAt(gmd, 'HMDARaceRefusalIndicator'))) races.push('not_provided')

  const sexes: HmdaSex[] = []
  const gender = textAt(gmd, 'GenderType')
  if (gender === 'Female') sexes.push('female')
  if (gender === 'Male') sexes.push('male')
  if (descendants(gmd, 'HMDAGenderType').some((g) => /both/i.test(g.text))) sexes.push('female', 'male')
  if (bool(textAt(gmd, 'HMDAGenderRefusalIndicator'))) sexes.push('not_provided')

  const sellerRelationship = descendants(declDetail, 'SpecialBorrowerSellerRelationshipIndicator')[0]?.text.trim() ?? null
  const declarations: Declarations = {
    ...emptyDeclarations,
    willOccupyAsPrimary: yesNo(textAt(declDetail, 'IntentToOccupyType')),
    ownedPropertyPast3Years: yesNo(textAt(declDetail, 'HomeownerPastThreeYearsType')),
    priorPropertyUsage: lookup(rev.priorUsage, textAt(declDetail, 'PriorPropertyUsageType')) as Declarations['priorPropertyUsage'],
    priorTitleHeld: lookup(rev.priorTitle, textAt(declDetail, 'PriorPropertyTitleType')) as Declarations['priorTitleHeld'],
    familyRelationshipWithSeller: bool(sellerRelationship),
    borrowingUndisclosedMoney: bool(textAt(declDetail, 'UndisclosedBorrowedFundsIndicator')),
    undisclosedMoneyAmount: num(textAt(declDetail, 'UndisclosedBorrowedFundsAmount')),
    applyingOtherMortgage: bool(textAt(declDetail, 'UndisclosedMortgageApplicationIndicator')),
    applyingNewCredit: bool(textAt(declDetail, 'UndisclosedCreditApplicationIndicator')),
    subjectToPriorityLien: bool(textAt(declDetail, 'PropertyProposedCleanEnergyLienIndicator')),
    cosignerOrGuarantor: bool(textAt(declDetail, 'UndisclosedComakerOfNoteIndicator')),
    outstandingJudgments: bool(textAt(declDetail, 'OutstandingJudgmentsIndicator')),
    delinquentFederalDebt: bool(textAt(declDetail, 'PresentlyDelinquentIndicator')),
    partyToLawsuit: bool(textAt(declDetail, 'PartyToLawsuitIndicator')),
    deedInLieuPast7Years: bool(textAt(declDetail, 'PriorPropertyDeedInLieuConveyedIndicator')),
    shortSalePast7Years: bool(textAt(declDetail, 'PriorPropertyShortSaleCompletedIndicator')),
    foreclosurePast7Years: bool(textAt(declDetail, 'PriorPropertyForeclosureCompletedIndicator')),
    bankruptcyPast7Years: bool(textAt(declDetail, 'BankruptcyIndicator')),
    bankruptcyChapter7: chapters.includes('ChapterSeven'),
    bankruptcyChapter11: chapters.includes('ChapterEleven'),
    bankruptcyChapter12: chapters.includes('ChapterTwelve'),
    bankruptcyChapter13: chapters.includes('ChapterThirteen'),
    ethnicities: [...new Set(ethnicities)],
    ethnicityOtherText,
    races: [...new Set(races)],
    raceTribeText,
    raceOtherAsianText,
    raceOtherPacificIslanderText,
    sexes: [...new Set(sexes)],
  }

  return {
    isPrimary: textAt(bd, 'BorrowerClassificationType') === 'Primary',
    person,
    addresses: addresses.filter((a) => a.addressLine),
    employments,
    otherIncomes,
    declarations,
  }
}

