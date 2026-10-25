import { describe, expect, it } from 'vitest'
import type { Organization, Profile } from '@/lib/api/settings'
import type { LoanDetails, LoanProfile, Property } from '@/lib/api/types'
import { emptyDeclarations, type Application, type ApplicationBorrower, type PersonDetails } from '@/lib/api/urla'
import { buildMismo34 } from './build'

const person = (over: Partial<PersonDetails>): PersonDetails => ({
  firstName: 'Test', middleName: null, lastName: 'Borrower', suffix: null, email: null, phone: null, homePhone: null,
  workPhone: null, workPhoneExt: null, dateOfBirth: null, citizenship: null, maritalStatus: null, dependentsCount: null,
  dependentsAges: null, militaryService: null, militaryActiveDuty: false, militaryServiceExpiresOn: null,
  militaryRetired: false, militaryReserveOnly: false, militarySurvivingSpouse: false, ...over,
})

const details: LoanDetails = {
  occupancy: 'primary', purchasePrice: null, loanAmount: 350000, noteRate: 6.5, termMonths: 360, cashOutAmount: 40000,
  contractDate: null, optionEndDate: null, closingDate: '2026-12-01', vestingEntity: null, financedPropertiesCount: null,
  subjectPropertyId: 'prop-home', mortgageType: 'conventional', amortizationType: 'fixed', titleNames: null, titleManner: null,
  estateType: 'fee_simple', hasBalloon: false, hasInterestOnly: false, hasNegativeAmortization: false, hasPrepaymentPenalty: false,
  improvementsAmount: null, estimatedClosingCosts: 6000, prepaidItemsAmount: 2500, discountPointsAmount: null, sellerCredits: null, lenderCredits: null,
}

const loan: LoanProfile = {
  id: 'loan-1', purpose: 'refinance_cash_out', stage: 'pre_approved', lostReason: null, referralSource: null,
  stageChangedAt: '2026-10-24T00:00:00Z', createdAt: '2026-10-24T00:00:00Z', priorLoanId: null,
  assignedLo: { id: 'lo-1', name: 'Connor' }, borrower: null, coBorrowerCount: 1, organizationId: 'org-1', details,
}

const primary: ApplicationBorrower = {
  contactId: 'c-1',
  role: 'primary',
  person: person({ dateOfBirth: '1988-05-14', citizenship: 'us_citizen', maritalStatus: 'married', phone: '(214) 555-0199', email: 'test.borrower@example.com', dependentsCount: 2, dependentsAges: '4, 7' }),
  addresses: [
    { id: 'a1', contactId: 'c-1', kind: 'current', addressLine: '123 Test Lane', unit: null, city: 'Dallas', state: 'TX', zip: '75201', country: 'US', housing: 'own', monthlyRent: null, monthsAtAddress: 14 },
    { id: 'a2', contactId: 'c-1', kind: 'former', addressLine: '9 Old Rd', unit: '2B', city: 'Plano', state: 'TX', zip: '75024', country: 'US', housing: 'rent', monthlyRent: 1500, monthsAtAddress: 30 },
  ],
  employments: [
    {
      id: 'e1', contactId: 'c-1', status: 'current', sortOrder: 0, employerName: 'Smith & Sons <Builders>', employerPhone: '214-555-0123',
      addressLine: null, unit: null, city: 'Dallas', state: 'TX', zip: null, positionTitle: 'Analyst', startDate: '2020-01-15', endDate: null,
      monthsInLineOfWork: 75, employedByParty: false, isSelfEmployed: false, ownership25OrMore: null, baseIncome: 6500, overtimeIncome: 400,
      bonusIncome: null, commissionIncome: null, militaryEntitlements: null, otherEmploymentIncome: null, selfEmployedIncome: null,
    },
  ],
  otherIncomes: [{ id: 'i1', contactId: 'c-1', incomeType: 'child_support', description: null, monthlyAmount: 600 }],
  declarations: {
    ...emptyDeclarations,
    willOccupyAsPrimary: true, ownedPropertyPast3Years: false, bankruptcyPast7Years: true, bankruptcyChapter7: true,
    ethnicities: ['not_hispanic_or_latino'], races: ['asian', 'chinese'], sexes: ['female'], applicationMethod: 'face_to_face',
  },
}

const coBorrower: ApplicationBorrower = {
  contactId: 'c-2',
  role: 'co_borrower',
  person: person({ firstName: 'Test', lastName: 'Coborrower' }),
  addresses: [],
  employments: [
    {
      id: 'e2', contactId: 'c-2', status: 'current', sortOrder: 0, employerName: 'Side LLC', employerPhone: null, addressLine: null, unit: null,
      city: null, state: null, zip: null, positionTitle: null, startDate: null, endDate: null, monthsInLineOfWork: null, employedByParty: false,
      isSelfEmployed: true, ownership25OrMore: true, baseIncome: null, overtimeIncome: null, bonusIncome: null, commissionIncome: null,
      militaryEntitlements: null, otherEmploymentIncome: null, selfEmployedIncome: -250,
    },
  ],
  otherIncomes: [],
  declarations: { ...emptyDeclarations, familyRelationshipWithSeller: false },
}

const application: Application = {
  borrowers: [primary, coBorrower],
  assets: [
    { id: 's1', loanId: 'loan-1', contactId: 'c-1', isJoint: false, assetType: 'checking', institutionName: 'Test Bank', accountLast4: '5678', amount: 25000, giftSource: null, giftDeposited: null, description: null },
    { id: 's2', loanId: 'loan-1', contactId: 'c-1', isJoint: true, assetType: 'gift_cash', institutionName: null, accountLast4: null, amount: 10000, giftSource: 'relative', giftDeposited: true, description: null },
    { id: 's3', loanId: 'loan-1', contactId: 'c-2', isJoint: false, assetType: 'earnest_money', institutionName: null, accountLast4: null, amount: 5000, giftSource: null, giftDeposited: null, description: null },
  ],
  liabilities: [
    { id: 'l1', loanId: 'loan-1', contactId: 'c-1', isJoint: false, liabilityType: 'installment', creditorName: 'Test Auto Finance', accountLast4: null, unpaidBalance: 18000, monthlyPayment: 450, monthsRemaining: 40, toBePaidOff: false, description: null },
    { id: 'l2', loanId: 'loan-1', contactId: 'c-2', isJoint: false, liabilityType: 'revolving', creditorName: 'Card Co', accountLast4: '9999', unpaidBalance: 3000, monthlyPayment: 90, monthsRemaining: null, toBePaidOff: true, description: null },
    { id: 'l3', loanId: 'loan-1', contactId: 'c-1', isJoint: false, liabilityType: 'child_support', creditorName: null, accountLast4: null, unpaidBalance: null, monthlyPayment: 300, monthsRemaining: null, toBePaidOff: false, description: null },
  ],
}

const property = (over: Partial<Property>): Property => ({
  id: 'p', loanId: 'loan-1', addressLine: '', city: 'Dallas', state: 'TX', zip: '75201', county: null, propertyType: 'single_family',
  status: 'current_home', listPrice: null, estimatedValue: null, annualTaxes: null, annualInsurance: null, monthlyHoa: null, monthlyRent: null,
  isHomestead: false, listingUrl: null, unitCount: 1, reoDisposition: 'retain', reoOccupancy: null, createdAt: '2026-10-24T00:00:00Z', liens: [], ...over,
})

const properties: Property[] = [
  property({
    id: 'prop-home', addressLine: '123 Test Lane', estimatedValue: 500000, annualTaxes: 9600, annualInsurance: 2400, isHomestead: true, reoOccupancy: 'primary',
    liens: [{ id: 'lien-1', propertyId: 'prop-home', position: 'first', lender: 'Test Bank', balance: 280000, noteRate: 7.5, monthlyPayment: 2400, isHeloc: false, originatedOn: '2026-03-01', isTexasCashOut: true, toBePaidOff: false, creditLimit: null, mortgageType: 'conventional' }],
  }),
  property({
    id: 'prop-rental', addressLine: '7 Rental Ave', status: 'owned', estimatedValue: 250000, annualTaxes: 3600, annualInsurance: 1200, monthlyRent: 2000, unitCount: 2, reoOccupancy: 'investment',
    liens: [{ id: 'lien-2', propertyId: 'prop-rental', position: 'first', lender: 'Rental Lender', balance: 150000, noteRate: 5, monthlyPayment: 1100, isHeloc: false, originatedOn: null, isTexasCashOut: false, toBePaidOff: false, creditLimit: null, mortgageType: null }],
  }),
  property({ id: 'prop-looking', addressLine: '1 Maybe St', status: 'interested' }),
]

const organization: Organization = { id: 'org-1', name: 'MPS Mortgage LLC', nmls: '2501110', addressLine: null, city: null, state: 'TX', zip: null, phone: null }
const originator: Profile = { id: 'lo-1', email: 'lo@example.com', fullName: 'Test Originator', nmls: '1234567', phone: null, stateLicense: null }

const xml = buildMismo34({ createdAt: '2026-10-25T12:00:00Z', loan, application, properties, organization, originator })

/** Every opening tag has a matching closing tag, in order. */
function isWellFormed(doc: string): boolean {
  const stack: string[] = []
  for (const m of doc.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z_:][\w:.-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m
    if (selfClosing) continue
    if (closing) {
      if (stack.pop() !== name) return false
    } else stack.push(name)
  }
  return stack.length === 0
}

const count = (re: RegExp) => (xml.match(re) || []).length
const between = (tag: string) => xml.slice(xml.indexOf(`<${tag}>`), xml.indexOf(`</${tag}>`))

describe('MISMO 3.4 export', () => {
  it('is well-formed XML with the MISMO 3.4 header and namespaces', () => {
    expect(isWellFormed(xml)).toBe(true)
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('xmlns="http://www.mismo.org/residential/2009/schemas"')
    expect(xml).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"')
    expect(xml).toContain('MISMOReferenceModelIdentifier="3.4.032420160128"')
  })

  it('never contains a Social Security number or taxpayer identifier', () => {
    expect(xml).not.toMatch(/Taxpayer|SocialSecurityNumber|\b\d{3}-?\d{2}-?\d{4}\b/)
  })

  it('escapes special characters in names', () => {
    expect(xml).toContain('<FullName>Smith &amp; Sons &lt;Builders&gt;</FullName>')
  })

  it('maps borrower identity, contact and family details', () => {
    expect(xml).toContain('<FirstName>Test</FirstName>')
    expect(xml).toContain('<LastName>Coborrower</LastName>')
    expect(xml).toContain('<BorrowerBirthDate>1988-05-14</BorrowerBirthDate>')
    expect(xml).toContain('<CitizenshipResidencyType>USCitizen</CitizenshipResidencyType>')
    expect(xml).toContain('<MaritalStatusType>Married</MaritalStatusType>')
    expect(xml).toContain('<ContactPointTelephoneValue>2145550199</ContactPointTelephoneValue>')
    expect(xml).toContain('<ContactPointEmailValue>test.borrower@example.com</ContactPointEmailValue>')
    expect(count(/<DependentAgeYearsCount>/g)).toBe(2)
    expect(xml).toContain('<BorrowerClassificationType>Secondary</BorrowerClassificationType>')
  })

  it('maps current and prior residences with time and rent', () => {
    expect(xml).toContain('<BorrowerResidencyType>Current</BorrowerResidencyType>')
    expect(xml).toContain('<BorrowerResidencyType>Prior</BorrowerResidencyType>')
    expect(xml).toContain('<BorrowerResidencyDurationYearsCount>2</BorrowerResidencyDurationYearsCount>')
    expect(xml).toContain('<MonthlyRentAmount>1500</MonthlyRentAmount>')
  })

  it('links each employment income item to its employer', () => {
    expect(xml).toContain('<IncomeType>Base</IncomeType>')
    expect(xml).toContain('<IncomeType>Overtime</IncomeType>')
    expect(xml).toContain('<IncomeType>SelfEmploymentLoss</IncomeType>')
    expect(xml).toContain('<CurrentIncomeMonthlyTotalAmount>250</CurrentIncomeMonthlyTotalAmount>')
    expect(xml).toContain('<IncomeType>ChildSupport</IncomeType>')
    expect(count(/CURRENT_INCOME_ITEM_IsAssociatedWith_EMPLOYER/g)).toBe(3)
    expect(xml).toContain('<OwnershipInterestType>GreaterThanOrEqualTo25Percent</OwnershipInterestType>')
    expect(xml).toContain('<EmploymentClassificationType>Primary</EmploymentClassificationType>')
  })

  it('puts accounts and gifts in ASSETS, credits in PURCHASE_CREDITS, 2d items in EXPENSES', () => {
    expect(between('ASSETS')).toContain('<AssetType>CheckingAccount</AssetType>')
    expect(between('ASSETS')).toContain('<AssetType>GiftOfCash</AssetType>')
    expect(between('ASSETS')).toContain('<FundsSourceType>Relative</FundsSourceType>')
    expect(between('ASSETS')).not.toContain('Earnest')
    expect(between('PURCHASE_CREDITS')).toContain('<PurchaseCreditType>EarnestMoney</PurchaseCreditType>')
    expect(between('EXPENSES')).toContain('<ExpenseType>ChildSupport</ExpenseType>')
    expect(between('LIABILITIES')).not.toContain('ChildSupport')
  })

  it('links joint assets to both borrowers and others to their owner', () => {
    // checking (1 owner) + joint gift (2 borrowers) + 2 owned properties x 2 borrowers; earnest money is a credit, not an asset
    expect(count(/ASSET_IsAssociatedWith_ROLE/g)).toBe(1 + 2 + 4)
  })

  it('lists real estate owned with its mortgages, and pays off the subject 1st lien on a refinance', () => {
    expect(count(/<OWNED_PROPERTY>/g)).toBe(2)
    expect(xml).not.toContain('1 Maybe St')
    expect(xml).toContain('<OwnedPropertySubjectIndicator>true</OwnedPropertySubjectIndicator>')
    expect(xml).toContain('<OwnedPropertyRentalIncomeGrossAmount>2000</OwnedPropertyRentalIncomeGrossAmount>')
    expect(count(/ASSET_IsAssociatedWith_LIABILITY/g)).toBe(2)
    expect(xml).toMatch(/<LiabilityPayoffStatusIndicator>true<\/LiabilityPayoffStatusIndicator>\s*<LiabilityType>MortgageLoan<\/LiabilityType>\s*<LiabilityUnpaidBalanceAmount>280000/)
    // The rental's lien stays.
    expect(xml).toMatch(/<LiabilityPayoffStatusIndicator>false<\/LiabilityPayoffStatusIndicator>\s*<LiabilityType>MortgageLoan<\/LiabilityType>\s*<LiabilityUnpaidBalanceAmount>150000/)
  })

  it('maps the loan terms, purpose and URLA closing figures', () => {
    expect(xml).toContain('<LoanPurposeType>Refinance</LoanPurposeType>')
    expect(xml).toContain('<RefinanceCashOutDeterminationType>CashOut</RefinanceCashOutDeterminationType>')
    expect(xml).toContain('<LienPriorityType>FirstLien</LienPriorityType>')
    expect(xml).toContain('<BaseLoanAmount>350000</BaseLoanAmount>')
    expect(xml).toContain('<NoteRatePercent>6.5</NoteRatePercent>')
    expect(xml).toContain('<MortgageType>Conventional</MortgageType>')
    expect(xml).toContain('<LoanAmortizationPeriodCount>360</LoanAmortizationPeriodCount>')
    expect(xml).toContain('<EstimatedClosingCostsAmount>6000</EstimatedClosingCostsAmount>')
    expect(xml).toContain('<ApplicationTakenMethodType>FaceToFace</ApplicationTakenMethodType>')
    expect(xml).toContain('<PropertyEstimatedValueAmount>500000</PropertyEstimatedValueAmount>')
  })

  it('maps declarations, bankruptcy chapter and demographics', () => {
    expect(xml).toContain('<IntentToOccupyType>Yes</IntentToOccupyType>')
    expect(xml).toContain('<HomeownerPastThreeYearsType>No</HomeownerPastThreeYearsType>')
    expect(xml).toContain('<BankruptcyChapterType>ChapterSeven</BankruptcyChapterType>')
    expect(xml).toContain('<HMDAEthnicityType>NotHispanicOrLatino</HMDAEthnicityType>')
    expect(xml).toContain('<HMDARaceType>Asian</HMDARaceType>')
    expect(xml).toContain('<HMDARaceDesignationType>Chinese</HMDARaceDesignationType>')
    expect(xml).toContain('<GenderType>Female</GenderType>')
    expect(xml).toContain('<ULAD:SpecialBorrowerSellerRelationshipIndicator>false</ULAD:SpecialBorrowerSellerRelationshipIndicator>')
  })

  it('includes the loan originator and company with NMLS IDs', () => {
    expect(xml).toContain('<PartyRoleType>LoanOriginator</PartyRoleType>')
    expect(xml).toContain('<PartyRoleType>LoanOriginationCompany</PartyRoleType>')
    expect(xml).toContain('<LicenseIdentifier>2501110</LicenseIdentifier>')
    expect(xml).toContain('<LicenseIdentifier>1234567</LicenseIdentifier>')
  })

  it('every relationship points at labels that exist', () => {
    const labels = new Set([...xml.matchAll(/xlink:label="([^"]+)"/g)].map((m) => m[1]))
    const ends = [...xml.matchAll(/xlink:(?:from|to)="([^"]+)"/g)].map((m) => m[1])
    expect(ends.length).toBeGreaterThan(0)
    expect(ends.filter((e) => !labels.has(e))).toEqual([])
    expect(labels.size).toBe([...xml.matchAll(/xlink:label="/g)].length)
  })

  it('orders DEAL containers alphabetically as the schema requires', () => {
    const deal = xml.slice(xml.indexOf('<DEAL SequenceNumber'))
    const order = ['<ASSETS>', '<COLLATERALS>', '<EXPENSES>', '<LIABILITIES>', '<LOANS>', '<PARTIES>', '<RELATIONSHIPS>'].map((t) => deal.indexOf(t))
    expect(order.every((pos, i) => pos > 0 && (i === 0 || pos > order[i - 1]))).toBe(true)
  })
})
