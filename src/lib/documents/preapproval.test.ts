import { describe, expect, it } from 'vitest'
import { addDays, firstLetter, greeting, letterProblems, letterView, newReference, nextVersion, offerLetter, reviewedFromFile, type ApprovedMax, type LetterFile } from './preapproval'

const today = '2026-10-27'
const max: ApprovedMax = { maxPrice: 450000, maxLoanAmount: 427500, expiresOn: null }
const file: LetterFile = { mortgageType: 'conventional', termMonths: 360, amortizationType: 'fixed', occupancy: 'primary', purchasePrice: null, loanAmount: null, sellerCredits: 5000, earnestMoney: 4000, documentKinds: ['paystub', 'w2', 'paystub', 'bank_statement', 'photo_id'] }

describe('the first letter', () => {
  const v1 = firstLetter(file, max, today)
  it('is "up to" the approved maximum with the loan terms', () => {
    expect(v1).toMatchObject({ propertyId: null, propertyAddress: null, purchasePrice: 450000, loanAmount: 427500, mortgageType: 'conventional', termMonths: 360, occupancy: 'primary', sellerCredits: 5000, earnestMoney: 4000 })
  })
  it('expires in 90 days, or when the approval does if sooner', () => {
    expect(v1.issuedOn).toBe(today)
    expect(v1.expiresOn).toBe('2027-01-25')
    expect(firstLetter(file, { ...max, expiresOn: '2026-12-31' }, today).expiresOn).toBe('2026-12-31')
  })
  it('lists what was reviewed from the documents on file', () => {
    expect(v1.reviewed).toEqual(['Credit report', 'Pay stubs', 'W-2s', 'Bank statements'])
    expect(reviewedFromFile([])).toEqual(['Credit report'])
  })
  it('is ready to issue', () => {
    expect(letterProblems(v1, max, today)).toEqual([])
  })
})

describe('a new version for an offer', () => {
  const v1 = firstLetter(file, max, today)
  it('names the home and keeps the same down payment percent', () => {
    const v2 = offerLetter(v1, { id: 'h1', address: '100 Test Lane, Frisco, TX 75034', price: 400000 }, max, '2026-11-02')
    expect(v2).toMatchObject({ propertyId: 'h1', propertyAddress: '100 Test Lane, Frisco, TX 75034', purchasePrice: 400000, loanAmount: 380000, issuedOn: '2026-11-02', expiresOn: '2027-01-31' })
    expect(letterProblems(v2, max, '2026-11-02')).toEqual([])
  })
  it('is blocked over the approved maximum, saying by how much', () => {
    const over = offerLetter(v1, { id: 'h2', address: '9 Big House Rd', price: 475000 }, max, today)
    expect(over.loanAmount).toBe(427500) // never above the maximum loan
    expect(letterProblems(over, max, today)).toEqual(['The price is $25,000 over the approved maximum of $450,000.'])
    expect(letterProblems({ ...v1, loanAmount: 430000 }, max, today)).toEqual(['The loan amount is $2,500 over the approved maximum of $427,500.'])
  })
})

describe('other checks', () => {
  const v1 = firstLetter(file, max, today)
  it('needs the approved maximum and the terms', () => {
    expect(letterProblems(firstLetter({ ...file, mortgageType: null }, { maxPrice: null, maxLoanAmount: null, expiresOn: null }, today), { maxPrice: null, maxLoanAmount: null, expiresOn: null }, today)).toEqual([
      'Set the approved maximum price and loan amount first.',
      'Fill in the purchase price, loan amount and loan type.',
    ])
  })
  it('dates: not after the approval, not before issue, not once the approval has expired', () => {
    expect(letterProblems({ ...v1, expiresOn: '2026-10-01' }, max, today)).toEqual(['The letter expires before it is issued.'])
    expect(letterProblems(v1, { ...max, expiresOn: '2026-12-01' }, today)).toEqual(["The letter can't expire after the pre-approval does (Dec 1, 2026)."])
    expect(letterProblems({ ...v1, expiresOn: '2026-10-20', issuedOn: '2026-10-01' }, { ...max, expiresOn: '2026-10-20' }, today)).toEqual(['The pre-approval expired on Oct 20, 2026. Update the approved maximum to issue new letters.'])
  })
  it('the loan amount can not be more than the price', () => {
    expect(letterProblems({ ...v1, purchasePrice: 400000, loanAmount: 410000 }, { ...max }, today)).toEqual(['The loan amount is more than the price.'])
  })
})

describe('reference numbers and versions', () => {
  it('one reference per pre-approval, versions count up', () => {
    const ref = newReference('3f9a1c2e-0000', today)
    expect(ref).toBe('PA-20261027-3F9A')
    expect(nextVersion([], ref)).toBe(1)
    expect(nextVersion([{ referenceNumber: ref, version: 1 }, { referenceNumber: ref, version: 2 }, { referenceNumber: 'PA-OTHER', version: 5 }], ref)).toBe(3)
  })
  it('adds days across months and years', () => {
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14')
  })
})

describe('what the PDF shows', () => {
  it('an "up to" letter for two borrowers', () => {
    const v = letterView(firstLetter(file, max, today), 'PA-20261027-3F9A', 1, ['Marcus Reed', 'Dana Reed'], 'Frisco, TX')
    expect(v.borrowers).toBe('Marcus Reed and Dana Reed')
    expect(v.greeting).toBe('Dear Marcus and Dana')
    expect(v.property).toBe('Frisco, TX (to be determined)')
    expect(v.terms).toEqual([
      { label: 'Purchase price up to', value: '$450,000' },
      { label: 'Loan amount up to', value: '$427,500' },
      { label: 'Financing', value: '95% of price' },
      { label: 'Loan type', value: 'Conventional' },
      { label: 'Term', value: '30-year fixed' },
      { label: 'Occupancy', value: 'Primary residence' },
    ])
    expect(v.conditions).toHaveLength(4)
  })
  it('optional rows and extra conditions show only when chosen', () => {
    const d = { ...firstLetter(file, max, today), propertyAddress: '100 Test Lane', showSellerCredits: true, showDownPayment: true, extraConditions: ['  sale of 12 Old St;', ' '] }
    const v = letterView(d, 'X', 2, ['Marcus Reed'], null)
    expect(v.terms[0].label).toBe('Purchase price')
    expect(v.terms.slice(6)).toEqual([{ label: 'Seller credits', value: '$5,000' }, { label: 'Down payment', value: '$22,500' }])
    expect(v.conditions.at(-1)).toBe('sale of 12 Old St;')
    expect(greeting([])).toBe('Hello')
  })
})
