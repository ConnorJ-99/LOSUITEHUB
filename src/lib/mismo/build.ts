import type { Organization, Profile } from '@/lib/api/settings'
import type { LoanProfile, Property } from '@/lib/api/types'
import type { Address, Application, ApplicationBorrower, Asset, Employment, Liability } from '@/lib/api/urla'
import { netMonthlyRental, round } from '@/lib/calc'
import { phoneDigits } from '@/lib/pipeline/helpers'
import { ownedProperties } from '@/lib/urla/realEstate'
import * as map from './maps'
import { el, leaf, serialize, type XChild, type XNode } from './xml'

// Builds a MISMO v3.4 XML file (Fannie Mae ULAD layout) for import into an
// LOS such as Arive. No Social Security numbers are included, by decision.

export interface MismoInput {
  /** ISO timestamp for ABOUT_VERSION. */
  createdAt: string
  loan: LoanProfile
  application: Application
  properties: Property[]
  organization: Organization | null
  originator: Profile | null
}

const yn = (v: boolean | null) => (v === null ? null : v ? 'Yes' : 'No')

function addressNode(a: { addressLine?: string | null; unit?: string | null; city?: string | null; state?: string | null; zip?: string | null; county?: string | null }, extra: XChild[] = []): XNode {
  return el('ADDRESS', [
    leaf('AddressLineText', a.addressLine),
    leaf('AddressUnitIdentifier', a.unit),
    leaf('CityName', a.city),
    leaf('CountyName', a.county),
    leaf('PostalCode', a.zip),
    leaf('StateCode', a.state),
    ...extra,
  ])
}

function contactPoint(seq: number, role: string, phone: string | null, email: string | null = null, ext: string | null = null): XNode | null {
  const digits = phoneDigits(phone)
  if (!digits && !email) return null
  return el(
    'CONTACT_POINT',
    [
      digits ? el('CONTACT_POINT_TELEPHONE', [leaf('ContactPointTelephoneValue', digits), leaf('ContactPointTelephoneExtensionValue', ext)]) : null,
      email ? el('CONTACT_POINT_EMAIL', [leaf('ContactPointEmailValue', email)]) : null,
      el('CONTACT_POINT_DETAIL', [leaf('ContactPointRoleType', role)]),
    ],
    { SequenceNumber: seq },
  )
}

function contactPoints(points: (XNode | null)[]): XNode {
  let seq = 0
  return el(
    'CONTACT_POINTS',
    points.filter((p): p is XNode => !!p).map((p) => ({ ...p, attrs: { ...p.attrs, SequenceNumber: ++seq } })),
  )
}

/** Shared counters so every xlink label in the file is unique. */
class Labels {
  private counts = new Map<string, number>()
  next(prefix: string): string {
    const n = (this.counts.get(prefix) ?? 0) + 1
    this.counts.set(prefix, n)
    return `${prefix}_${n}`
  }
}

interface Relationship {
  from: string
  to: string
  arcrole: string
}

function residence(a: Address, seq: number): XNode {
  const years = a.monthsAtAddress !== null ? Math.floor(a.monthsAtAddress / 12) : null
  const months = a.monthsAtAddress !== null ? a.monthsAtAddress % 12 : null
  return el(
    'RESIDENCE',
    [
      addressNode(a, [leaf('CountryCode', a.country)]),
      a.housing === 'rent' ? el('LANDLORD', [el('LANDLORD_DETAIL', [leaf('MonthlyRentAmount', a.monthlyRent)])]) : null,
      el('RESIDENCE_DETAIL', [
        leaf('BorrowerResidencyBasisType', a.housing ? map.residencyBasis[a.housing] : null),
        leaf('BorrowerResidencyDurationMonthsCount', months),
        leaf('BorrowerResidencyDurationYearsCount', years),
        leaf('BorrowerResidencyType', a.kind === 'current' ? 'Current' : 'Prior'),
      ]),
    ],
    { SequenceNumber: seq },
  )
}

/** One job: EMPLOYER plus its income items (linked to it by xlink). */
function employer(
  e: Employment,
  seq: number,
  classification: 'Primary' | 'Secondary',
  labels: Labels,
  incomeItems: XNode[],
  relationships: Relationship[],
): XNode {
  const label = labels.next('EMPLOYER')
  const current = e.status === 'current'
  const lineYears = e.monthsInLineOfWork !== null ? Math.floor(e.monthsInLineOfWork / 12) : null
  const lineMonths = e.monthsInLineOfWork !== null ? e.monthsInLineOfWork % 12 : null

  if (current) {
    const add = (type: string, amount: number | null, otherDescription?: string) => {
      if (!amount) return
      const itemLabel = labels.next('CURRENT_INCOME_ITEM')
      incomeItems.push(
        el(
          'CURRENT_INCOME_ITEM',
          [
            el('CURRENT_INCOME_ITEM_DETAIL', [
              leaf('CurrentIncomeMonthlyTotalAmount', round(Math.abs(amount))),
              leaf('EmploymentIncomeIndicator', true),
              leaf('IncomeType', type),
              leaf('IncomeTypeOtherDescription', otherDescription),
            ]),
          ],
          { SequenceNumber: incomeItems.length + 1, 'xlink:label': itemLabel },
        ),
      )
      relationships.push({ from: itemLabel, to: label, arcrole: map.ARCROLE('CURRENT_INCOME_ITEM', 'EMPLOYER') })
    }
    if (e.isSelfEmployed) {
      add((e.selfEmployedIncome ?? 0) < 0 ? 'SelfEmploymentLoss' : 'SelfEmploymentIncome', e.selfEmployedIncome)
    } else {
      add('Base', e.baseIncome)
      add('Overtime', e.overtimeIncome)
      add('Bonus', e.bonusIncome)
      add('Commissions', e.commissionIncome)
      add('Other', e.militaryEntitlements, 'Military Entitlements')
      add('Other', e.otherEmploymentIncome, 'Other Employment Income')
    }
  }

  return el(
    'EMPLOYER',
    [
      addressNode(e),
      el('LEGAL_ENTITY', [
        el('CONTACTS', [el('CONTACT', [contactPoints([contactPoint(1, 'Work', e.employerPhone)])], { SequenceNumber: 1 })]),
        el('LEGAL_ENTITY_DETAIL', [leaf('FullName', e.employerName)]),
      ]),
      el('EMPLOYMENT', [
        leaf('EmploymentBorrowerSelfEmployedIndicator', e.isSelfEmployed),
        leaf('EmploymentClassificationType', current ? classification : null),
        leaf('EmploymentEndDate', current ? null : e.endDate),
        leaf('EmploymentMonthlyIncomeAmount', current ? (e.isSelfEmployed ? e.selfEmployedIncome : null) : e.baseIncome),
        leaf('EmploymentPositionDescription', e.positionTitle),
        leaf('EmploymentStartDate', e.startDate),
        leaf('EmploymentStatusType', current ? 'Current' : 'Previous'),
        leaf('EmploymentTimeInLineOfWorkMonthsCount', current ? lineMonths : null),
        leaf('EmploymentTimeInLineOfWorkYearsCount', current ? lineYears : null),
        leaf('OwnershipInterestType', e.isSelfEmployed && e.ownership25OrMore !== null ? (e.ownership25OrMore ? 'GreaterThanOrEqualTo25Percent' : 'LessThan25Percent') : null),
        leaf('SpecialBorrowerEmployerRelationshipIndicator', e.employedByParty),
      ]),
    ],
    { SequenceNumber: seq, 'xlink:label': label },
  )
}

function governmentMonitoring(b: ApplicationBorrower): XNode {
  const d = b.declarations
  const ethnicityRefused = d.ethnicities.includes('not_provided')
  const raceRefused = d.races.includes('not_provided')
  const sexRefused = d.sexes.includes('not_provided')
  const female = d.sexes.includes('female')
  const male = d.sexes.includes('male')
  const hispanic = d.ethnicities.includes('hispanic_or_latino')
  const notHispanic = d.ethnicities.includes('not_hispanic_or_latino')

  const origins = d.ethnicities
    .filter((e) => map.ethnicityOrigin[e])
    .map((e, i) =>
      el(
        'HMDA_ETHNICITY_ORIGIN',
        [leaf('HMDAEthnicityOriginType', map.ethnicityOrigin[e]), leaf('HMDAEthnicityOriginTypeOtherDescription', e === 'other_hispanic' ? d.ethnicityOtherText : null)],
        { SequenceNumber: i + 1 },
      ),
    )

  const designationsFor = (children: string[]) =>
    d.races
      .filter((r) => children.includes(r))
      .map((r, i) =>
        el(
          'HMDA_RACE_DESIGNATION',
          [
            leaf('HMDARaceDesignationType', map.raceDesignation[r]),
            leaf('HMDARaceDesignationOtherAsianDescription', r === 'other_asian' ? d.raceOtherAsianText : null),
            leaf('HMDARaceDesignationOtherPacificIslanderDescription', r === 'other_pacific_islander' ? d.raceOtherPacificIslanderText : null),
          ],
          { SequenceNumber: i + 1 },
        ),
      )

  const races = d.races
    .filter((r) => map.raceType[r])
    .map((r, i) =>
      el(
        'HMDA_RACE',
        [
          el('HMDA_RACE_DESIGNATIONS',
            r === 'asian'
              ? designationsFor(['asian_indian', 'chinese', 'filipino', 'japanese', 'korean', 'vietnamese', 'other_asian'])
              : r === 'native_hawaiian_or_pacific_islander'
                ? designationsFor(['native_hawaiian', 'guamanian_or_chamorro', 'samoan', 'other_pacific_islander'])
                : [],
          ),
          el('HMDA_RACE_DETAIL', [
            leaf('HMDARaceType', map.raceType[r]),
            leaf('HMDARaceTypeAdditionalDescription', r === 'american_indian_or_alaska_native' ? d.raceTribeText : null),
          ]),
        ],
        { SequenceNumber: i + 1 },
      ),
    )

  return el('GOVERNMENT_MONITORING', [
    el('GOVERNMENT_MONITORING_DETAIL', [
      leaf('GenderType', female && !male ? 'Female' : male && !female ? 'Male' : null),
      leaf('HMDAEthnicityRefusalIndicator', ethnicityRefused || null),
      leaf('HMDAEthnicityType', hispanic ? 'HispanicOrLatino' : notHispanic ? 'NotHispanicOrLatino' : null),
      leaf('HMDAGenderRefusalIndicator', sexRefused || null),
      leaf('HMDARaceRefusalIndicator', raceRefused || null),
      // Best effort: ULAD extension for an applicant who selected both sexes.
      female && male
        ? el('EXTENSION', [el('OTHER', [el('ULAD:GOVERNMENT_MONITORING_DETAIL_EXTENSION', [leaf('ULAD:HMDAGenderType', 'ApplicantSelectedBothMaleAndFemale')])])])
        : null,
    ]),
    el('HMDA_ETHNICITY_ORIGINS', origins),
    el('HMDA_RACES', races),
  ])
}

function declaration(b: ApplicationBorrower, citizenship: string | null): XNode {
  const d = b.declarations
  return el('DECLARATION', [
    el('DECLARATION_DETAIL', [
      leaf('BankruptcyIndicator', d.bankruptcyPast7Years),
      leaf('CitizenshipResidencyType', citizenship),
      leaf('HomeownerPastThreeYearsType', yn(d.ownedPropertyPast3Years)),
      leaf('IntentToOccupyType', yn(d.willOccupyAsPrimary)),
      leaf('OutstandingJudgmentsIndicator', d.outstandingJudgments),
      leaf('PartyToLawsuitIndicator', d.partyToLawsuit),
      leaf('PresentlyDelinquentIndicator', d.delinquentFederalDebt),
      leaf('PriorPropertyDeedInLieuConveyedIndicator', d.deedInLieuPast7Years),
      leaf('PriorPropertyForeclosureCompletedIndicator', d.foreclosurePast7Years),
      leaf('PriorPropertyShortSaleCompletedIndicator', d.shortSalePast7Years),
      leaf('PriorPropertyTitleType', d.ownedPropertyPast3Years && d.priorTitleHeld ? map.priorTitle[d.priorTitleHeld] : null),
      leaf('PriorPropertyUsageType', d.ownedPropertyPast3Years && d.priorPropertyUsage ? map.priorUsage[d.priorPropertyUsage] : null),
      leaf('PropertyProposedCleanEnergyLienIndicator', d.subjectToPriorityLien),
      leaf('UndisclosedBorrowedFundsAmount', d.borrowingUndisclosedMoney ? d.undisclosedMoneyAmount : null),
      leaf('UndisclosedBorrowedFundsIndicator', d.borrowingUndisclosedMoney),
      leaf('UndisclosedComakerOfNoteIndicator', d.cosignerOrGuarantor),
      leaf('UndisclosedCreditApplicationIndicator', d.applyingNewCredit),
      leaf('UndisclosedMortgageApplicationIndicator', d.applyingOtherMortgage),
      // Best effort: 1003 question 5a-B (family/business relationship with the seller) is a ULAD extension.
      d.familyRelationshipWithSeller !== null
        ? el('EXTENSION', [el('OTHER', [el('ULAD:DECLARATION_DETAIL_EXTENSION', [leaf('ULAD:SpecialBorrowerSellerRelationshipIndicator', d.familyRelationshipWithSeller)])])])
        : null,
    ]),
  ])
}

function borrowerParty(b: ApplicationBorrower, index: number, labels: Labels, relationships: Relationship[]): { party: XNode; roleLabel: string } {
  const p = b.person
  const d = b.declarations
  const roleLabel = `BORROWER_${index}`
  const incomeItems: XNode[] = []

  let primaryAssigned = false
  const employers = b.employments.map((e, i) => {
    const classification = e.status === 'current' && !primaryAssigned ? 'Primary' : 'Secondary'
    if (e.status === 'current') primaryAssigned = true
    return employer(e, i + 1, classification, labels, incomeItems, relationships)
  })

  for (const income of b.otherIncomes) {
    incomeItems.push(
      el(
        'CURRENT_INCOME_ITEM',
        [
          el('CURRENT_INCOME_ITEM_DETAIL', [
            leaf('CurrentIncomeMonthlyTotalAmount', income.monthlyAmount),
            leaf('EmploymentIncomeIndicator', false),
            leaf('IncomeType', map.otherIncome[income.incomeType]),
            leaf('IncomeTypeOtherDescription', income.incomeType === 'other' ? income.description || 'Other' : null),
          ]),
        ],
        { SequenceNumber: incomeItems.length + 1, 'xlink:label': labels.next('CURRENT_INCOME_ITEM') },
      ),
    )
  }

  const ages = (p.dependentsAges ?? '').split(/[,\s]+/).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n >= 0)
  const chapters = [
    d.bankruptcyChapter7 && 'ChapterSeven',
    d.bankruptcyChapter11 && 'ChapterEleven',
    d.bankruptcyChapter12 && 'ChapterTwelve',
    d.bankruptcyChapter13 && 'ChapterThirteen',
  ].filter((c): c is string => !!c)
  const militaryStatus = [
    p.militaryActiveDuty && { type: 'ActiveDuty', until: p.militaryServiceExpiresOn },
    p.militaryRetired && { type: 'Veteran', until: null },
    p.militaryReserveOnly && { type: 'ReserveNationalGuardNeverActivated', until: null },
  ].filter((m): m is { type: string; until: string | null } => !!m)
  const residences = b.addresses.filter((a) => a.kind !== 'mailing')
  const mailing = b.addresses.find((a) => a.kind === 'mailing')

  const party = el(
    'PARTY',
    [
      el('ADDRESSES', mailing ? [addressNode(mailing, [leaf('AddressType', 'Mailing'), leaf('CountryCode', mailing.country)])] : []),
      el('INDIVIDUAL', [
        contactPoints([
          contactPoint(1, 'Mobile', p.phone),
          contactPoint(2, 'Home', p.homePhone),
          contactPoint(3, 'Work', p.workPhone, null, p.workPhoneExt),
          contactPoint(4, 'Home', null, p.email),
        ]),
        el('NAME', [leaf('FirstName', p.firstName), leaf('LastName', p.lastName), leaf('MiddleName', p.middleName), leaf('SuffixName', p.suffix)]),
      ]),
      el('ROLES', [
        el(
          'ROLE',
          [
            el('BORROWER', [
              el('BANKRUPTCIES', chapters.map((c, i) => el('BANKRUPTCY', [el('BANKRUPTCY_DETAIL', [leaf('BankruptcyChapterType', c)])], { SequenceNumber: i + 1 }))),
              el('BORROWER_DETAIL', [
                leaf('BorrowerBirthDate', p.dateOfBirth),
                leaf('BorrowerClassificationType', b.role === 'primary' ? 'Primary' : 'Secondary'),
                leaf('DependentCount', p.dependentsCount),
                leaf('MaritalStatusType', p.maritalStatus ? map.maritalStatus[p.maritalStatus] : null),
                leaf('SelfDeclaredMilitaryServiceIndicator', p.militaryService),
                leaf('SpousalVABenefitsEligibilityIndicator', p.militarySurvivingSpouse || null),
              ]),
              el('CURRENT_INCOME', [el('CURRENT_INCOME_ITEMS', incomeItems)]),
              declaration(b, p.citizenship ? map.citizenship[p.citizenship] : null),
              el('DEPENDENTS', ages.map((age, i) => el('DEPENDENT', [leaf('DependentAgeYearsCount', age)], { SequenceNumber: i + 1 }))),
              el('EMPLOYERS', employers),
              governmentMonitoring(b),
              el('MILITARY_SERVICES', militaryStatus.map((m, i) =>
                el('MILITARY_SERVICE', [leaf('MilitaryServiceExpectedCompletionDate', m.until), leaf('MilitaryStatusType', m.type)], { SequenceNumber: i + 1 }),
              )),
              el('RESIDENCES', residences.map((a, i) => residence(a, i + 1))),
            ]),
            el('ROLE_DETAIL', [leaf('PartyRoleType', 'Borrower')]),
          ],
          { SequenceNumber: 1, 'xlink:label': roleLabel },
        ),
      ]),
    ],
    { SequenceNumber: index },
  )
  return { party, roleLabel }
}

function licenses(nmls: string | null, stateLicense: string | null): XNode {
  const entries: XNode[] = []
  if (nmls) entries.push(el('LICENSE', [el('LICENSE_DETAIL', [leaf('LicenseAuthorityLevelType', 'Private'), leaf('LicenseIdentifier', nmls)])]))
  if (stateLicense) entries.push(el('LICENSE', [el('LICENSE_DETAIL', [leaf('LicenseAuthorityLevelType', 'State'), leaf('LicenseIdentifier', stateLicense)])]))
  return el('LICENSES', entries.map((e, i) => ({ ...e, attrs: { SequenceNumber: i + 1 } })))
}

/** The full MISMO 3.4 document for one loan. */
export function buildMismo34(input: MismoInput): string {
  const { loan, application, properties, organization, originator } = input
  const d = loan.details
  const labels = new Labels()
  const relationships: Relationship[] = []
  const subject = properties.find((p) => p.id === d.subjectPropertyId) ?? null
  const hasPurchasePrice = d.purchasePrice !== null
  const purpose = map.loanPurpose(loan.purpose, hasPurchasePrice)
  const isRefinance = purpose.purpose === 'Refinance'
  const isSecondLien = purpose.lien === 'SecondLien'

  // Parties
  const borrowerParties = application.borrowers.map((b, i) => borrowerParty(b, i + 1, labels, relationships))
  const roleFor = new Map(application.borrowers.map((b, i) => [b.contactId, borrowerParties[i].roleLabel]))
  const allRoles = borrowerParties.map((p) => p.roleLabel)
  const ownersOf = (item: { contactId: string; isJoint: boolean }) => (item.isJoint ? allRoles : [roleFor.get(item.contactId)!].filter(Boolean))

  const partyNodes: XNode[] = borrowerParties.map((p) => p.party)
  if (originator) {
    partyNodes.push(
      el(
        'PARTY',
        [
          el('INDIVIDUAL', [
            contactPoints([contactPoint(1, 'Work', originator.phone), contactPoint(2, 'Work', null, originator.email)]),
            el('NAME', [leaf('FullName', originator.fullName ?? originator.email)]),
          ]),
          el('ROLES', [el('ROLE', [licenses(originator.nmls, originator.stateLicense), el('ROLE_DETAIL', [leaf('PartyRoleType', 'LoanOriginator')])], { SequenceNumber: 1 })]),
        ],
        { SequenceNumber: partyNodes.length + 1 },
      ),
    )
  }
  if (organization) {
    partyNodes.push(
      el(
        'PARTY',
        [
          el('ADDRESSES', organization.addressLine ? [addressNode(organization)] : []),
          el('LEGAL_ENTITY', [
            el('CONTACTS', [el('CONTACT', [contactPoints([contactPoint(1, 'Work', organization.phone)])], { SequenceNumber: 1 })]),
            el('LEGAL_ENTITY_DETAIL', [leaf('FullName', organization.name)]),
          ]),
          el('ROLES', [el('ROLE', [licenses(organization.nmls, null), el('ROLE_DETAIL', [leaf('PartyRoleType', 'LoanOriginationCompany')])], { SequenceNumber: 1 })]),
        ],
        { SequenceNumber: partyNodes.length + 1 },
      ),
    )
  }

  // Assets: accounts and gifts (credits go to PURCHASE_CREDITS), then real estate owned.
  const assetNodes: XNode[] = []
  const addAsset = (children: XChild[], owners: string[]) => {
    const label = labels.next('ASSET')
    assetNodes.push(el('ASSET', children, { SequenceNumber: assetNodes.length + 1, 'xlink:label': label }))
    for (const role of owners) relationships.push({ from: label, to: role, arcrole: map.ARCROLE('ASSET', 'ROLE') })
    return label
  }
  for (const a of application.assets.filter((x: Asset) => map.assetType[x.assetType])) {
    addAsset(
      [
        el('ASSET_DETAIL', [
          leaf('AssetAccountIdentifier', a.accountLast4),
          leaf('AssetCashOrMarketValueAmount', a.amount),
          leaf('AssetDescription', a.description),
          leaf('AssetType', map.assetType[a.assetType]),
          leaf('FundsSourceType', a.giftSource ? map.giftSource[a.giftSource] : null),
        ]),
        el('ASSET_HOLDER', [el('NAME', [leaf('FullName', a.institutionName)])]),
      ],
      ownersOf(a),
    )
  }

  // Liabilities and real estate owned (each property is an ASSET linked to its mortgages).
  const liabilityNodes: XNode[] = []
  const addLiability = (detail: XChild[], holder: string | null, owners: string[]) => {
    const label = labels.next('LIABILITY')
    liabilityNodes.push(
      el('LIABILITY', [el('LIABILITY_DETAIL', detail), el('LIABILITY_HOLDER', [el('NAME', [leaf('FullName', holder)])])], {
        SequenceNumber: liabilityNodes.length + 1,
        'xlink:label': label,
      }),
    )
    for (const role of owners) relationships.push({ from: label, to: role, arcrole: map.ARCROLE('LIABILITY', 'ROLE') })
    return label
  }
  for (const l of application.liabilities.filter((x: Liability) => map.liabilityType[x.liabilityType])) {
    addLiability(
      [
        leaf('LiabilityAccountIdentifier', l.accountLast4),
        leaf('LiabilityMonthlyPaymentAmount', l.monthlyPayment),
        leaf('LiabilityPayoffStatusIndicator', l.toBePaidOff),
        leaf('LiabilityRemainingTermMonthsCount', l.monthsRemaining),
        leaf('LiabilityType', map.liabilityType[l.liabilityType]),
        leaf('LiabilityTypeOtherDescription', l.liabilityType === 'other' ? l.description || 'Other' : null),
        leaf('LiabilityUnpaidBalanceAmount', l.unpaidBalance),
      ],
      l.creditorName,
      ownersOf(l),
    )
  }

  for (const p of ownedProperties(properties)) {
    const isSubject = p.id === subject?.id
    const retained = (p.reoDisposition ?? 'retain') === 'retain'
    const lienPayments = p.liens.filter((l) => !l.toBePaidOff).map((l) => l.monthlyPayment ?? 0)
    const assetLabel = addAsset(
      [
        el('OWNED_PROPERTY', [
          el('OWNED_PROPERTY_DETAIL', [
            leaf('OwnedPropertyDispositionStatusType', map.ownedDisposition[p.reoDisposition ?? 'retain']),
            leaf('OwnedPropertyMaintenanceExpenseAmount', round((p.annualTaxes ?? 0) / 12 + (p.annualInsurance ?? 0) / 12 + (p.monthlyHoa ?? 0)) || null),
            leaf('OwnedPropertyOwnedUnitCount', p.unitCount),
            leaf('OwnedPropertyRentalIncomeGrossAmount', p.monthlyRent),
            leaf(
              'OwnedPropertyRentalIncomeNetAmount',
              retained && !isSubject && p.monthlyRent
                ? netMonthlyRental({ monthlyRent: p.monthlyRent, annualTaxes: p.annualTaxes, annualInsurance: p.annualInsurance, monthlyHoa: p.monthlyHoa, lienPayments })
                : null,
            ),
            leaf('OwnedPropertySubjectIndicator', isSubject),
          ]),
          el('PROPERTY', [
            addressNode(p),
            el('PROPERTY_DETAIL', [
              leaf('PropertyEstimatedValueAmount', p.estimatedValue),
              leaf('PropertyUsageType', isSubject ? map.propertyUsage[d.occupancy] : p.reoOccupancy ? map.propertyUsage[p.reoOccupancy] : null),
            ]),
          ]),
        ]),
      ],
      allRoles,
    )
    for (const lien of p.liens) {
      // On a refinance the new loan pays off the subject property's 1st lien.
      const paidOff = lien.toBePaidOff || (isSubject && isRefinance && !isSecondLien && lien.position === 'first')
      const liabilityLabel = addLiability(
        [
          leaf('HELOCMaximumBalanceAmount', lien.isHeloc ? lien.creditLimit : null),
          leaf('LiabilityMonthlyPaymentAmount', lien.monthlyPayment),
          leaf('LiabilityPayoffStatusIndicator', paidOff),
          leaf('LiabilityType', lien.isHeloc ? 'HELOC' : 'MortgageLoan'),
          leaf('LiabilityUnpaidBalanceAmount', lien.balance),
          leaf('MortgageType', lien.mortgageType ? map.mortgageType[lien.mortgageType] : null),
        ],
        lien.lender,
        allRoles,
      )
      relationships.push({ from: assetLabel, to: liabilityLabel, arcrole: map.ARCROLE('ASSET', 'LIABILITY') })
    }
  }

  // Expenses (1003 section 2d)
  const expenseNodes = application.liabilities
    .filter((x) => map.expenseType[x.liabilityType])
    .map((x, i) => {
      const label = labels.next('EXPENSE')
      for (const role of ownersOf(x)) relationships.push({ from: label, to: role, arcrole: map.ARCROLE('EXPENSE', 'ROLE') })
      return el(
        'EXPENSE',
        [
          leaf('ExpenseMonthlyPaymentAmount', x.monthlyPayment),
          leaf('ExpenseType', map.expenseType[x.liabilityType]),
          leaf('ExpenseTypeOtherDescription', x.liabilityType === 'other_expense' ? x.description || 'Other' : null),
        ],
        { SequenceNumber: i + 1, 'xlink:label': label },
      )
    })

  // Purchase credits (1003 section 2b credits)
  const credits = application.assets
    .filter((a) => map.purchaseCredit[a.assetType])
    .map((a, i) => {
      const [type, other] = map.purchaseCredit[a.assetType]!
      return el('PURCHASE_CREDIT', [leaf('PurchaseCreditAmount', a.amount), leaf('PurchaseCreditType', type), leaf('PurchaseCreditTypeOtherDescription', other)], {
        SequenceNumber: i + 1,
      })
    })

  const primary = application.borrowers.find((b) => b.role === 'primary') ?? application.borrowers[0]
  const method = primary?.declarations.applicationMethod

  const loanNode = el(
    'LOAN',
    [
      el('AMORTIZATION', [
        el('AMORTIZATION_RULE', [
          leaf('AmortizationType', d.amortizationType === 'arm' ? 'AdjustableRate' : 'Fixed'),
          leaf('LoanAmortizationPeriodCount', d.termMonths),
          leaf('LoanAmortizationPeriodType', d.termMonths ? 'Month' : null),
        ]),
      ]),
      el('DOCUMENT_SPECIFIC_DATA_SETS', [
        el('DOCUMENT_SPECIFIC_DATA_SET', [
          el('URLA', [
            el('URLA_DETAIL', [
              leaf('AlterationsImprovementsAndRepairsAmount', d.improvementsAmount),
              leaf('ApplicationTakenMethodType', method ? map.applicationMethod[method] : null),
              leaf('BorrowerPaidDiscountPointsTotalAmount', d.discountPointsAmount),
              leaf('BorrowerRequestedLoanAmount', d.loanAmount),
              leaf('EstimatedClosingCostsAmount', d.estimatedClosingCosts),
              leaf('PrepaidItemsEstimatedAmount', d.prepaidItemsAmount),
              leaf('PurchasePriceAmount', purpose.purpose === 'Purchase' ? d.purchasePrice : null),
              leaf('SellerPaidClosingCostsAmount', d.sellerCredits),
            ]),
          ]),
        ], { SequenceNumber: 1 }),
      ]),
      el('LOAN_DETAIL', [
        leaf('BalloonIndicator', d.hasBalloon),
        leaf('HELOCIndicator', loan.purpose === 'heloc' || null),
        leaf('InterestOnlyIndicator', d.hasInterestOnly || loan.purpose === 'heloc'),
        leaf('NegativeAmortizationIndicator', d.hasNegativeAmortization),
        leaf('PrepaymentPenaltyIndicator', d.hasPrepaymentPenalty),
      ]),
      el('LOAN_IDENTIFIERS', [el('LOAN_IDENTIFIER', [leaf('LoanIdentifier', loan.id), leaf('LoanIdentifierType', 'LenderLoan')], { SequenceNumber: 1 })]),
      el('MATURITY', [el('MATURITY_RULE', [leaf('LoanMaturityPeriodCount', d.termMonths), leaf('LoanMaturityPeriodType', d.termMonths ? 'Month' : null)])]),
      el('PURCHASE_CREDITS', credits),
      isRefinance ? el('REFINANCE', [leaf('RefinanceCashOutAmount', d.cashOutAmount), leaf('RefinanceCashOutDeterminationType', purpose.cashOut)]) : null,
      el('TERMS_OF_LOAN', [
        leaf('BaseLoanAmount', d.loanAmount),
        leaf('LienPriorityType', purpose.lien),
        leaf('LoanPurposeType', purpose.purpose),
        leaf('MortgageType', d.mortgageType ? map.mortgageType[d.mortgageType] : null),
        leaf('NoteAmount', d.loanAmount),
        leaf('NoteRatePercent', d.noteRate),
      ]),
    ],
    { LoanRoleType: 'SubjectLoan', SequenceNumber: 1, 'xlink:label': 'SUBJECT_LOAN_1' },
  )

  const collateral = el('COLLATERALS', [
    el(
      'COLLATERAL',
      [
        el('SUBJECT_PROPERTY', [
          subject ? addressNode(subject) : null,
          el('PROPERTY_DETAIL', [
            leaf('FinancedUnitCount', subject?.unitCount ?? 1),
            leaf('PropertyEstateType', d.estateType === 'leasehold' ? 'Leasehold' : 'FeeSimple'),
            leaf('PropertyEstimatedValueAmount', subject?.estimatedValue),
            leaf('PropertyUsageType', map.propertyUsage[d.occupancy]),
          ]),
          purpose.purpose === 'Purchase' && d.purchasePrice !== null
            ? el('SALES_CONTRACTS', [el('SALES_CONTRACT', [el('SALES_CONTRACT_DETAIL', [leaf('SalesContractAmount', d.purchasePrice)])], { SequenceNumber: 1 })])
            : null,
        ]),
      ],
      { SequenceNumber: 1 },
    ),
  ])

  const deal = el(
    'DEAL',
    [
      el('ASSETS', assetNodes),
      collateral,
      el('EXPENSES', expenseNodes),
      el('LIABILITIES', liabilityNodes),
      el('LOANS', [loanNode]),
      el('PARTIES', partyNodes),
      el(
        'RELATIONSHIPS',
        relationships.map((r, i) => ({
          name: 'RELATIONSHIP',
          attrs: { SequenceNumber: i + 1, 'xlink:arcrole': r.arcrole, 'xlink:from': r.from, 'xlink:to': r.to },
          keepEmpty: true,
        })),
      ),
    ],
    { SequenceNumber: 1 },
  )

  const root: XNode = {
    name: 'MESSAGE',
    attrs: {
      xmlns: map.NAMESPACES.mismo,
      'xmlns:xlink': map.NAMESPACES.xlink,
      'xmlns:ULAD': map.NAMESPACES.ulad,
      MISMOReferenceModelIdentifier: map.MISMO_REFERENCE_MODEL,
    },
    children: [
      el('ABOUT_VERSIONS', [el('ABOUT_VERSION', [leaf('CreatedDatetime', input.createdAt)], { SequenceNumber: 1 })]),
      el('DEAL_SETS', [el('DEAL_SET', [el('DEALS', [deal])], { SequenceNumber: 1 })]),
    ],
  }
  return serialize(root)
}
