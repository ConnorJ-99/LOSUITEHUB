import { describe, expect, it } from 'vitest'
import { buildMismo34 } from './build'
import { MismoImportError, parseMismo34 } from './parse'
import { application, loan, organization, originator, properties } from './testFixture'

const xml = buildMismo34({ createdAt: '2026-10-25T12:00:00Z', loan, application, properties, organization, originator })
const r = parseMismo34(xml)

describe('MISMO 3.4 import: round trip of our own export', () => {
  it('reads both borrowers, primary first, with identity and contact details', () => {
    expect(r.borrowers.map((b) => `${b.person.firstName} ${b.person.lastName}`)).toEqual(['Test Borrower', 'Test Coborrower'])
    expect(r.borrowers[0].isPrimary).toBe(true)
    const p = r.borrowers[0].person
    expect(p.dateOfBirth).toBe('1988-05-14')
    expect(p.citizenship).toBe('us_citizen')
    expect(p.maritalStatus).toBe('married')
    expect(p.phone).toBe('2145550199')
    expect(p.email).toBe('test.borrower@example.com')
    expect(p.dependentsCount).toBe(2)
    expect(p.dependentsAges).toBe('4, 7')
  })

  it('reads current and former addresses with time and rent', () => {
    const [current, former] = r.borrowers[0].addresses
    expect(current).toMatchObject({ kind: 'current', addressLine: '123 Test Lane', city: 'Dallas', state: 'TX', housing: 'own', monthsAtAddress: 14 })
    expect(former).toMatchObject({ kind: 'former', addressLine: '9 Old Rd', unit: '2B', housing: 'rent', monthlyRent: 1500, monthsAtAddress: 30 })
  })

  it('rebuilds jobs and income from income items linked to employers', () => {
    const job = r.borrowers[0].employments[0]
    expect(job).toMatchObject({ status: 'current', employerName: 'Smith & Sons <Builders>', positionTitle: 'Analyst', startDate: '2020-01-15', baseIncome: 6500, overtimeIncome: 400, monthsInLineOfWork: 75 })
    expect(job.employerPhone).toBe('2145550123')
    const selfEmployed = r.borrowers[1].employments[0]
    expect(selfEmployed).toMatchObject({ isSelfEmployed: true, ownership25OrMore: true, selfEmployedIncome: -250 })
    expect(r.borrowers[0].otherIncomes).toEqual([{ incomeType: 'child_support', description: null, monthlyAmount: 600 }])
  })

  it('reads declarations, bankruptcy chapters and demographics', () => {
    const d = r.borrowers[0].declarations
    expect(d.willOccupyAsPrimary).toBe(true)
    expect(d.ownedPropertyPast3Years).toBe(false)
    expect(d.bankruptcyPast7Years).toBe(true)
    expect(d.bankruptcyChapter7).toBe(true)
    expect(d.bankruptcyChapter13).toBe(false)
    expect(d.ethnicities).toEqual(['not_hispanic_or_latino'])
    expect(d.races).toEqual(['asian', 'chinese'])
    expect(d.sexes).toEqual(['female'])
    expect(d.applicationMethod).toBe('face_to_face')
    expect(r.borrowers[1].declarations.familyRelationshipWithSeller).toBe(false)
    expect(d.cosignerOrGuarantor).toBeNull()
  })

  it('reads assets with owners, gifts, and earnest money back as a credit', () => {
    const byType = Object.fromEntries(r.assets.map((a) => [a.assetType, a]))
    expect(byType.checking).toMatchObject({ amount: 25000, institutionName: 'Test Bank', accountLast4: '5678', owners: [0] })
    expect(byType.gift_cash).toMatchObject({ amount: 10000, giftSource: 'relative', owners: [0, 1] })
    expect(byType.earnest_money).toMatchObject({ amount: 5000 })
  })

  it('reads debts with owners and 2d expenses back as liabilities', () => {
    const byType = Object.fromEntries(r.liabilities.map((l) => [l.liabilityType, l]))
    expect(byType.installment).toMatchObject({ creditorName: 'Test Auto Finance', monthlyPayment: 450, unpaidBalance: 18000, monthsRemaining: 40, toBePaidOff: false, owners: [0] })
    expect(byType.revolving).toMatchObject({ accountLast4: '9999', toBePaidOff: true, owners: [1] })
    expect(byType.child_support).toMatchObject({ monthlyPayment: 300, owners: [0] })
    expect(r.liabilities.some((l) => l.creditorName === 'Test Bank')).toBe(false)
  })

  it('reads the subject property with its paid-off 1st lien, and other real estate owned', () => {
    expect(r.subject).toMatchObject({ addressLine: '123 Test Lane', estimatedValue: 500000, unitCount: 1 })
    expect(r.subject?.liens).toEqual([
      { position: 'first', lender: 'Test Bank', balance: 280000, monthlyPayment: 2400, isHeloc: false, creditLimit: null, toBePaidOff: true, mortgageType: 'conventional' },
    ])
    expect(r.ownedProperties).toHaveLength(1)
    expect(r.ownedProperties[0]).toMatchObject({ addressLine: '7 Rental Ave', estimatedValue: 250000, monthlyRent: 2000, unitCount: 2, reoDisposition: 'retain', reoOccupancy: 'investment', monthlyMaintenance: 400 })
    expect(r.ownedProperties[0].liens[0]).toMatchObject({ lender: 'Rental Lender', balance: 150000, toBePaidOff: false })
  })

  it('reads loan terms and closing figures, and reports the file purpose without applying it', () => {
    expect(r.loan).toMatchObject({ loanAmount: 350000, noteRate: 6.5, termMonths: 360, mortgageType: 'conventional', amortizationType: 'fixed', cashOutAmount: 40000, estimatedClosingCosts: 6000, prepaidItemsAmount: 2500, occupancy: 'primary', estateType: 'fee_simple' })
    expect(r.filePurpose).toBe('refinance_cash_out')
  })

  it('finds no SSNs in our own file', () => {
    expect(r.ssnCount).toBe(0)
  })
})

describe('MISMO 3.4 import: files from other systems', () => {
  const external = `<?xml version="1.0"?>
<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas" xmlns:xlink="http://www.w3.org/1999/xlink" MISMOReferenceModelIdentifier="3.4.032420160128">
  <DEAL_SETS><DEAL_SET><DEALS><DEAL>
    <PARTIES>
      <PARTY>
        <INDIVIDUAL><NAME><FirstName>Ana</FirstName><LastName>Lopez</LastName></NAME></INDIVIDUAL>
        <TAXPAYER_IDENTIFIERS><TAXPAYER_IDENTIFIER><TaxpayerIdentifierType>SocialSecurityNumber</TaxpayerIdentifierType><TaxpayerIdentifierValue>123456789</TaxpayerIdentifierValue></TAXPAYER_IDENTIFIER></TAXPAYER_IDENTIFIERS>
        <ROLES><ROLE xlink:label="B1">
          <ROLE_DETAIL><PartyRoleType>Borrower</PartyRoleType></ROLE_DETAIL>
          <BORROWER>
            <SOMETHING_UNKNOWN><Whatever>1</Whatever></SOMETHING_UNKNOWN>
            <EMPLOYERS><EMPLOYER xlink:label="E1"><LEGAL_ENTITY><LEGAL_ENTITY_DETAIL><FullName>Acme</FullName></LEGAL_ENTITY_DETAIL></LEGAL_ENTITY><EMPLOYMENT><EmploymentStatusType>Current</EmploymentStatusType></EMPLOYMENT></EMPLOYER></EMPLOYERS>
            <CURRENT_INCOME><CURRENT_INCOME_ITEMS>
              <CURRENT_INCOME_ITEM xlink:label="I1"><CURRENT_INCOME_ITEM_DETAIL><IncomeType>Base</IncomeType><CurrentIncomeMonthlyTotalAmount>5000.00</CurrentIncomeMonthlyTotalAmount><EmploymentIncomeIndicator>true</EmploymentIncomeIndicator></CURRENT_INCOME_ITEM_DETAIL></CURRENT_INCOME_ITEM>
              <CURRENT_INCOME_ITEM><CURRENT_INCOME_ITEM_DETAIL><IncomeType>Pension</IncomeType><CurrentIncomeMonthlyTotalAmount>800</CurrentIncomeMonthlyTotalAmount></CURRENT_INCOME_ITEM_DETAIL></CURRENT_INCOME_ITEM>
            </CURRENT_INCOME_ITEMS></CURRENT_INCOME>
          </BORROWER>
        </ROLE></ROLES>
      </PARTY>
      <PARTY><LEGAL_ENTITY><LEGAL_ENTITY_DETAIL><FullName>Some Lender</FullName></LEGAL_ENTITY_DETAIL></LEGAL_ENTITY><ROLES><ROLE><ROLE_DETAIL><PartyRoleType>LoanOriginationCompany</PartyRoleType></ROLE_DETAIL></ROLE></ROLES></PARTY>
    </PARTIES>
    <LIABILITIES>
      <LIABILITY xlink:label="L1"><LIABILITY_DETAIL><LiabilityType>CollectionsJudgmentsAndLiens</LiabilityType><LiabilityMonthlyPaymentAmount>50</LiabilityMonthlyPaymentAmount><LiabilityAccountIdentifier>ACCT-0000123456</LiabilityAccountIdentifier></LIABILITY_DETAIL></LIABILITY>
      <LIABILITY><LIABILITY_DETAIL><LiabilityType>MortgageLoan</LiabilityType><LiabilityUnpaidBalanceAmount>100000</LiabilityUnpaidBalanceAmount></LIABILITY_DETAIL></LIABILITY>
    </LIABILITIES>
    <LOANS><LOAN LoanRoleType="SubjectLoan">
      <TERMS_OF_LOAN><NoteAmount>200000</NoteAmount><LoanPurposeType>Purchase</LoanPurposeType><MortgageType>FHA</MortgageType></TERMS_OF_LOAN>
      <MATURITY><MATURITY_RULE><LoanMaturityPeriodCount>30</LoanMaturityPeriodCount><LoanMaturityPeriodType>Year</LoanMaturityPeriodType></MATURITY_RULE></MATURITY>
    </LOAN></LOANS>
    <RELATIONSHIPS>
      <RELATIONSHIP xlink:from="I1" xlink:to="E1" xlink:arcrole="urn:fdc:mismo.org:2009:residential/CURRENT_INCOME_ITEM_ISASSOCIATEDWITH_EMPLOYER"/>
      <RELATIONSHIP xlink:from="L1" xlink:to="B1" xlink:arcrole="urn:fdc:mismo.org:2009:residential/LIABILITY_IsAssociatedWith_ROLE"/>
    </RELATIONSHIPS>
  </DEAL></DEALS></DEAL_SET></DEAL_SETS>
</MESSAGE>`
  const x = parseMismo34(external)

  it('counts SSNs but never keeps them', () => {
    expect(x.ssnCount).toBe(1)
    expect(JSON.stringify(x)).not.toContain('123456789')
  })

  it('ignores unknown elements and non-borrower parties', () => {
    expect(x.borrowers).toHaveLength(1)
    expect(x.borrowers[0].person.firstName).toBe('Ana')
  })

  it('accepts upper-case arcroles and NoteAmount / years-based terms', () => {
    expect(x.borrowers[0].employments[0].baseIncome).toBe(5000)
    expect(x.borrowers[0].otherIncomes[0]).toMatchObject({ incomeType: 'retirement', monthlyAmount: 800 })
    expect(x.loan).toMatchObject({ loanAmount: 200000, mortgageType: 'fha', termMonths: 360 })
    expect(x.filePurpose).toBe('purchase')
  })

  it('maps unknown liability types to Other with a warning, keeps only last 4 of accounts, skips unlinked mortgages', () => {
    expect(x.liabilities).toHaveLength(1)
    expect(x.liabilities[0]).toMatchObject({ liabilityType: 'other', accountLast4: '3456', monthlyPayment: 50 })
    expect(x.warnings.some((w) => w.includes('CollectionsJudgmentsAndLiens'))).toBe(true)
    expect(x.warnings.some((w) => w.includes("isn't linked to a property"))).toBe(true)
  })

  it('rejects files that are not MISMO', () => {
    expect(() => parseMismo34('<html><body>nope</body></html>')).toThrow(MismoImportError)
    expect(() => parseMismo34('<MESSAGE></MESSAGE>')).toThrow(/no loan/)
    expect(() => parseMismo34('garbage')).toThrow(/valid XML/)
  })
})
