import { describe, expect, it } from 'vitest'
import type { LoanDetails, LoanProfile } from '@/lib/api/types'
import { emptyDeclarations, type Application, type ApplicationBorrower } from '@/lib/api/urla'
import { exportChecklist, exportFileName } from './checklist'
import { property } from './testFixture'

const details = (over: Partial<LoanDetails> = {}): LoanDetails => ({
  occupancy: 'primary', purchasePrice: null, loanAmount: null, noteRate: null, termMonths: null, cashOutAmount: null, contractDate: null,
  optionEndDate: null, closingDate: null, vestingEntity: null, financedPropertiesCount: null, subjectPropertyId: null, mortgageType: null,
  amortizationType: 'fixed', titleNames: null, titleManner: null, estateType: 'fee_simple', hasBalloon: false, hasInterestOnly: false,
  hasNegativeAmortization: false, hasPrepaymentPenalty: false, improvementsAmount: null, estimatedClosingCosts: null, prepaidItemsAmount: null,
  discountPointsAmount: null, sellerCredits: null, lenderCredits: null, estimatedTaxRatePct: null, estimatedAnnualInsurance: null, estimatedMonthlyHoa: null, miRatePct: null, upfrontFeePct: null, ariveLoanNumber: null, optionFee: null, contractFinancingAmount: null, financingDeadline: null, surveyDeadline: null, titlePolicyPaidBy: null, possession: null, hasHoaAddendum: null, incomeDocType: null, timeline: null, crossCollateral: false, estimatedFundingDate: null, firstPaymentDate: null, impoundWaiver: 'none', qualifyingRate: null, buydown: null, supplementalInsuranceMonthly: null, otherPaymentMonthly: null, otherPaymentLabel: null, pricingScenarioId: null, programId: null, chosenQuoteId: null, preapprovalMaxPrice: null, preapprovalMaxLoanAmount: null, preapprovalExpiresOn: null, lenderName: null, programName: null, monthlyPayment: null, revenueType: null, revenueValue: null, compPlanId: null, ...over,
})

const loan = (over: Partial<LoanDetails> = {}): LoanProfile => ({
  id: 'l', purpose: 'purchase', stage: 'lead', lostReason: null, referralSource: null, stageChangedAt: '', createdAt: '', priorLoanId: null, priority: false, onHoldAt: null, holdReason: null, statusDetail: null, timeline: null, loanAmount: null, purchasePrice: null, closingDate: null,
  assignedLo: null, borrower: null, coBorrowerCount: 0, conditions: { total: 0, cleared: 0, allHandedIn: false }, organizationId: 'o', details: details(over),
})

const borrower: ApplicationBorrower = {
  contactId: 'c', role: 'primary', estimatedCreditScore: null,
  person: {
    firstName: 'Jane', middleName: null, lastName: 'Doe', suffix: null, email: null, phone: null, homePhone: null, workPhone: null, workPhoneExt: null,
    dateOfBirth: null, citizenship: null, maritalStatus: null, dependentsCount: null, dependentsAges: null, militaryService: null,
    militaryActiveDuty: false, militaryServiceExpiresOn: null, militaryRetired: false, militaryReserveOnly: false, militarySurvivingSpouse: false,
  },
  addresses: [{ id: 'a', contactId: 'c', kind: 'current', addressLine: '1 Main', unit: null, city: null, state: 'TX', zip: null, country: 'US', housing: 'rent', monthlyRent: 1000, monthsAtAddress: 10 }],
  employments: [],
  otherIncomes: [],
  declarations: emptyDeclarations,
}

describe('export checklist', () => {
  it('reminds you to add the other cross-collateral homes in Arive', () => {
    const app: Application = { borrowers: [borrower], assets: [], liabilities: [] }
    const homes = [property({ id: 'p1', estimatedValue: 400000 }), property({ id: 'p2', isCollateral: true }), property({ id: 'p3', isCollateral: true })]
    const messages = (over: Partial<LoanDetails>) => exportChecklist({ loan: loan({ subjectPropertyId: 'p1', ...over }), application: app, properties: homes, organization: null, originator: null }).map((i) => i.message)
    expect(messages({ crossCollateral: true })).toContain('Cross-collateral: the file carries only the subject property, so add the other 2 collateral homes as collateral in Arive')
    expect(messages({ crossCollateral: false }).some((m) => m.startsWith('Cross-collateral'))).toBe(false)
  })

  it('lists what a bare application is missing', () => {
    const app: Application = { borrowers: [borrower], assets: [], liabilities: [] }
    const messages = exportChecklist({ loan: loan(), application: app, properties: [], organization: null, originator: null }).map((i) => `${i.area}: ${i.message}`)
    expect(messages).toContain('Loan: Loan amount')
    expect(messages).toContain('Loan: Sales contract price')
    expect(messages).toContain('Jane Doe: Date of birth')
    expect(messages).toContain('Jane Doe: Former address (under 2 years at current)')
    expect(messages).toContain('Jane Doe: Current employment or other income')
    expect(messages).toContain('Jane Doe: 14 declaration questions unanswered')
    expect(messages).toContain('Originator: Company NMLS # (Settings)')
  })

  it('is empty when everything important is filled in', () => {
    const complete: ApplicationBorrower = {
      ...borrower,
      person: { ...borrower.person, dateOfBirth: '1990-01-01', citizenship: 'us_citizen', maritalStatus: 'unmarried', phone: '2145550100' },
      addresses: [{ ...borrower.addresses[0], monthsAtAddress: 36 }],
      otherIncomes: [{ id: 'i', contactId: 'c', incomeType: 'social_security', description: null, monthlyAmount: 1500 }],
      declarations: {
        ...emptyDeclarations,
        willOccupyAsPrimary: true, ownedPropertyPast3Years: false, borrowingUndisclosedMoney: false, applyingOtherMortgage: false,
        applyingNewCredit: false, subjectToPriorityLien: false, cosignerOrGuarantor: false, outstandingJudgments: false,
        delinquentFederalDebt: false, partyToLawsuit: false, deedInLieuPast7Years: false, shortSalePast7Years: false,
        foreclosurePast7Years: false, bankruptcyPast7Years: false, ethnicities: ['not_provided'], races: ['not_provided'], sexes: ['not_provided'],
      },
    }
    const items = exportChecklist({
      loan: loan({ loanAmount: 300000, noteRate: 6, termMonths: 360, mortgageType: 'fha', purchasePrice: 320000, subjectPropertyId: 'p' }),
      application: { borrowers: [complete], assets: [], liabilities: [] },
      properties: [{ id: 'p', estimatedValue: 320000 } as never],
      organization: { id: 'o', name: 'MPS', nmls: '2501110', addressLine: '1 Office', city: null, state: 'TX', zip: null, phone: null, logoPath: null },
      originator: { id: 'u', email: 'x', fullName: 'X', nmls: '123', phone: null, stateLicense: null, signaturePath: null, personalCell: null },
    })
    expect(items).toEqual([])
  })

  it('makes safe file names', () => {
    expect(exportFileName("O'Brien-Smith Jr.", '2026-10-25')).toBe('MPS-HQ_MISMO34_OBrien-SmithJr_2026-10-25.xml')
    expect(exportFileName(undefined, '2026-10-25')).toBe('MPS-HQ_MISMO34_Loan_2026-10-25.xml')
  })
})
