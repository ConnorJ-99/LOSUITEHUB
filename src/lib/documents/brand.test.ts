import { describe, expect, it } from 'vitest'
import { brandProblems, docBrand, oneLineAddress } from './brand'

const org = { id: 'o', name: 'MPS Mortgage LLC', nmls: '2501110', addressLine: '100 Main St', city: 'Frisco', state: 'TX', zip: '75034', phone: null, logoPath: null }
const lo = { id: 'u', email: 'lo@example.com', fullName: 'Sample Officer', nmls: null, phone: '214-555-0100', stateLicense: null, signaturePath: null }

describe('who a PDF is from', () => {
  it('builds the letterhead from Settings', () => {
    expect(docBrand(org, lo)).toEqual({
      company: { legalName: 'MPS Mortgage LLC', nmls: '2501110', address: '100 Main St, Frisco, TX 75034', logo: null },
      lo: { name: 'Sample Officer', nmls: null, phone: '214-555-0100', email: 'lo@example.com', signature: null },
    })
    expect(oneLineAddress({ addressLine: null, city: null, state: 'TX', zip: null })).toBe('TX')
    expect(oneLineAddress({ addressLine: null, city: null, state: null, zip: null })).toBeNull()
  })
  it('carries the uploaded logo and signature (none = built-in logo and a blank to sign)', () => {
    const b = docBrand(org, lo, { logo: 'data:image/png;base64,AAA', signature: 'data:image/png;base64,BBB' })
    expect(b.company.logo).toBe('data:image/png;base64,AAA')
    expect(b.lo.signature).toBe('data:image/png;base64,BBB')
  })
  it('says which NMLS numbers are missing', () => {
    expect(brandProblems(docBrand(org, lo))).toEqual(["the loan officer's NMLS # (Settings → My profile)"])
    expect(brandProblems(docBrand(org, { ...lo, nmls: '2611188' }))).toEqual([])
  })
})
