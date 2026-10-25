import { describe, expect, it } from 'vitest'
import { buildMismo34 } from './build'
import { application, loan, organization, originator, properties } from './testFixture'

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

  it("uses the Schedule E figure for a rental's net income when the Income tab chose it", () => {
    const withScheduleE = properties.map((p) => (p.id === 'prop-rental' ? { ...p, rentalIncomeMethod: 'schedule_e' as const, scheduleEMonthlyIncome: 1650 } : p))
    const doc = buildMismo34({ createdAt: '2026-10-25T12:00:00Z', loan, application, properties: withScheduleE, organization, originator })
    // 1,650 Schedule E − 1,500 payment (1,100 mortgage + 300 taxes + 100 insurance)
    expect(doc).toContain('<OwnedPropertyRentalIncomeNetAmount>150</OwnedPropertyRentalIncomeNetAmount>')
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
