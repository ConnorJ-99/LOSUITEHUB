import { describe, expect, it } from 'vitest'
import { requestAddress, requestBody, requestRows, requestSubject, type RequestFacts } from './requestEmail'

const facts: RequestFacts = {
  companyName: 'MPS MORTGAGE LLC',
  companyNmls: '2501110',
  borrowerName: 'Donnie Beam',
  coBorrowerName: null,
  additionalBorrowers: [],
  propertyAddress: 'Azle, TX 76020 (TBD)',
  loanNumber: null,
  loanAmount: 313625,
  mortgageeClause: 'Rocket Mortgage ISAOA/ATIMA\nPO Box 1\nDetroit, MI 48226\nLoan # 123',
  purpose: 'Purchase',
  closingDate: '2026-12-10',
  insuranceEscrow: 'Impounded',
  lo: { name: 'Connor Jacquart', nmls: '2611188', phone: '(214) 218-1281', email: 'connor@mps.mortgage' },
}

describe('partner request emails', () => {
  it('lists the rows of the title draft', () => {
    const rows = requestRows('title', facts)
    expect(rows.map((r) => r.label)).toEqual(['Borrower Name', 'Co-Borrower Name', 'Additional Borrower(s)', 'Property Address', 'Loan Number', 'Loan Amount', 'Mortgagee Clause', 'Purpose', 'Estimated Closing Date', 'Please forward the following upon completion'])
    expect(rows.find((r) => r.key === 'loanAmount')!.value).toBe('$313,625')
    expect(rows.find((r) => r.key === 'closing')!.value).toBe('12/10/2026')
  })
  it('adds insurance escrow on the insurance request', () => {
    const rows = requestRows('insurance', facts, 'Dec page')
    expect(rows.at(-2)).toEqual({ key: 'escrow', label: 'Insurance Escrow', value: 'Impounded' })
    expect(rows.at(-1)!.value).toBe('Dec page')
  })
  it('writes the address, TBD without a street', () => {
    expect(requestAddress({ addressLine: '', city: 'Azle', state: 'TX', zip: '76020' })).toBe('Azle, TX 76020 (TBD)')
    expect(requestAddress({ addressLine: '12 Oak St', city: 'Azle', state: 'TX', zip: '76020' })).toBe('12 Oak St, Azle, TX 76020')
    expect(requestAddress(null)).toBe('TBD')
  })
  it('builds the subject and the body', () => {
    expect(requestSubject('title', facts)).toBe('Title Request from MPS MORTGAGE LLC: Donnie Beam, Azle, TX 76020 (TBD)')
    const body = requestBody('title', requestRows('title', facts), facts)
    expect(body).toContain('Title Request from MPS MORTGAGE LLC\n\nBorrower Name: Donnie Beam\nCo-Borrower Name:\n')
    expect(body).toContain('Mortgagee Clause: Rocket Mortgage ISAOA/ATIMA\n    PO Box 1\n    Detroit, MI 48226\n    Loan # 123\n')
    expect(body).toContain('If you have any questions, please email connor@mps.mortgage or contact me directly.')
    expect(body.endsWith('Sincerely,\n\nConnor Jacquart\nNMLS # 2611188\n(214) 218-1281 | connor@mps.mortgage\n\nMPS MORTGAGE LLC\nNMLS # 2501110')).toBe(true)
  })
})
