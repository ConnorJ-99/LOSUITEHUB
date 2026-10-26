// Shared test data for the MISMO export/import tests: a two-borrower cash-out
// refinance with a rental property. Test-only; the app never imports this.
import type { Organization, Profile } from '@/lib/api/settings'
import type { LoanDetails, LoanProfile, Property } from '@/lib/api/types'
import { emptyDeclarations, type Application, type ApplicationBorrower, type PersonDetails } from '@/lib/api/urla'

export const person = (over: Partial<PersonDetails>): PersonDetails => ({
  firstName: 'Test', middleName: null, lastName: 'Borrower', suffix: null, email: null, phone: null, homePhone: null,
  workPhone: null, workPhoneExt: null, dateOfBirth: null, citizenship: null, maritalStatus: null, dependentsCount: null,
  dependentsAges: null, militaryService: null, militaryActiveDuty: false, militaryServiceExpiresOn: null,
  militaryRetired: false, militaryReserveOnly: false, militarySurvivingSpouse: false, ...over,
})

export const details: LoanDetails = {
  occupancy: 'primary', purchasePrice: null, loanAmount: 350000, noteRate: 6.5, termMonths: 360, cashOutAmount: 40000,
  contractDate: null, optionEndDate: null, closingDate: '2026-12-01', vestingEntity: null, financedPropertiesCount: null,
  subjectPropertyId: 'prop-home', mortgageType: 'conventional', amortizationType: 'fixed', titleNames: null, titleManner: null,
  estateType: 'fee_simple', hasBalloon: false, hasInterestOnly: false, hasNegativeAmortization: false, hasPrepaymentPenalty: false,
  improvementsAmount: null, estimatedClosingCosts: 6000, prepaidItemsAmount: 2500, discountPointsAmount: null, sellerCredits: null, lenderCredits: null, estimatedTaxRatePct: null, estimatedAnnualInsurance: null, estimatedMonthlyHoa: null, miRatePct: null, upfrontFeePct: null, ariveLoanNumber: null, optionFee: null, contractFinancingAmount: null, financingDeadline: null, surveyDeadline: null, titlePolicyPaidBy: null, possession: null, hasHoaAddendum: null, incomeDocType: null, timeline: null,
}

export const loan: LoanProfile = {
  id: 'loan-1', purpose: 'refinance_cash_out', stage: 'pre_approved', lostReason: null, referralSource: null,
  stageChangedAt: '2026-10-24T00:00:00Z', createdAt: '2026-10-24T00:00:00Z', priorLoanId: null,
  assignedLo: { id: 'lo-1', name: 'Connor' }, borrower: null, coBorrowerCount: 1, organizationId: 'org-1', details,
}

export const primary: ApplicationBorrower = {
  contactId: 'c-1',
  role: 'primary',
  estimatedCreditScore: 700,
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

export const coBorrower: ApplicationBorrower = {
  contactId: 'c-2',
  role: 'co_borrower',
  estimatedCreditScore: null,
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

export const application: Application = {
  borrowers: [primary, coBorrower],
  assets: [
    { id: 's1', loanId: 'loan-1', contactId: 'c-1', isJoint: false, assetType: 'checking', institutionName: 'Test Bank', accountLast4: '5678', amount: 25000, giftSource: null, giftDeposited: null, description: null, useAs: 'down_payment' },
    { id: 's2', loanId: 'loan-1', contactId: 'c-1', isJoint: true, assetType: 'gift_cash', institutionName: null, accountLast4: null, amount: 10000, giftSource: 'relative', giftDeposited: true, description: null, useAs: 'down_payment' },
    { id: 's3', loanId: 'loan-1', contactId: 'c-2', isJoint: false, assetType: 'earnest_money', institutionName: null, accountLast4: null, amount: 5000, giftSource: null, giftDeposited: null, description: null, useAs: 'down_payment' },
  ],
  liabilities: [
    { id: 'l1', loanId: 'loan-1', contactId: 'c-1', isJoint: false, liabilityType: 'installment', creditorName: 'Test Auto Finance', accountLast4: null, unpaidBalance: 18000, monthlyPayment: 450, monthsRemaining: 40, toBePaidOff: false, description: null },
    { id: 'l2', loanId: 'loan-1', contactId: 'c-2', isJoint: false, liabilityType: 'revolving', creditorName: 'Card Co', accountLast4: '9999', unpaidBalance: 3000, monthlyPayment: 90, monthsRemaining: null, toBePaidOff: true, description: null },
    { id: 'l3', loanId: 'loan-1', contactId: 'c-1', isJoint: false, liabilityType: 'child_support', creditorName: null, accountLast4: null, unpaidBalance: null, monthlyPayment: 300, monthsRemaining: null, toBePaidOff: false, description: null },
  ],
}

export const property = (over: Partial<Property>): Property => ({
  id: 'p', loanId: 'loan-1', addressLine: '', city: 'Dallas', state: 'TX', zip: '75201', county: null, propertyType: 'single_family',
  status: 'current_home', listPrice: null, estimatedValue: null, annualTaxes: null, annualInsurance: null, monthlyHoa: null, monthlyRent: null,
  isHomestead: false, listingUrl: null, unitCount: 1, reoDisposition: 'retain', reoOccupancy: null, rentalIncomeMethod: 'lease', scheduleEMonthlyIncome: null, createdAt: '2026-10-24T00:00:00Z', liens: [], ...over,
})

export const properties: Property[] = [
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

export const organization: Organization = { id: 'org-1', name: 'MPS Mortgage LLC', nmls: '2501110', addressLine: null, city: null, state: 'TX', zip: null, phone: null }
export const originator: Profile = { id: 'lo-1', email: 'lo@example.com', fullName: 'Test Originator', nmls: '1234567', phone: null, stateLicense: null }
