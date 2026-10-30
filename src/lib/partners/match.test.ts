import { describe, expect, it } from 'vitest'
import { emailKey, looksLikeEmail, matchPartner, partnerKindForRole, phone10, searchPartners, splitFiles, type PartnerFile } from './match'

const partners = [
  { id: 'riley', name: 'Riley Agent', company: 'Sample Realty', email: 'Riley@Example.com', phone: '(214) 555-0199' },
  { id: 'lee', name: 'Lee Lister', company: null, email: null, phone: '214.555.0142' },
  { id: 'one', name: 'Office One', company: 'Front Desk Realty', email: 'one@office.com', phone: '817-555-0100' },
  { id: 'two', name: 'Office Two', company: 'Front Desk Realty', email: null, phone: '817-555-0100' },
  { id: 'three', name: 'Office Three', company: 'Front Desk Realty', email: null, phone: '817-555-0100' },
]

describe('emailKey and phone10', () => {
  it('lowercases and trims emails', () => {
    expect(emailKey('  Riley@Example.COM ')).toBe('riley@example.com')
    expect(emailKey('   ')).toBeNull()
    expect(emailKey(null)).toBeNull()
  })
  it('keeps 10 digits, dropping a leading US 1', () => {
    expect(phone10('+1 (214) 555-0199')).toBe('2145550199')
    expect(phone10('214.555.0199')).toBe('2145550199')
    expect(phone10('555-0199')).toBeNull()
    expect(phone10('214-555-0199 x12')).toBeNull()
    expect(phone10(null)).toBeNull()
  })
  it('checks email shape', () => {
    expect(looksLikeEmail('a@b.co')).toBe(true)
    expect(looksLikeEmail('a@b')).toBe(false)
  })
})

describe('matchPartner', () => {
  it('matches by email whatever the capitals', () => {
    expect(matchPartner({ email: 'riley@EXAMPLE.com ', phone: null }, partners)).toMatchObject({ by: 'email', partner: { id: 'riley' } })
  })
  it('email wins over phone', () => {
    expect(matchPartner({ email: 'riley@example.com', phone: '214-555-0142' }, partners)).toMatchObject({ by: 'email', partner: { id: 'riley' } })
  })
  it('matches by 10-digit phone however it was typed', () => {
    expect(matchPartner({ email: null, phone: '1-214-555-0199' }, partners)).toMatchObject({ by: 'phone', partner: { id: 'riley' } })
  })
  it('a new email on a partner\'s phone is the same person only if that partner has no email', () => {
    expect(matchPartner({ email: 'lee@example.com', phone: '2145550142' }, partners)).toMatchObject({ by: 'phone', partner: { id: 'lee' } })
    // Riley has a different email: a coworker on the same line.
    expect(matchPartner({ email: 'coworker@example.com', phone: '2145550199' }, partners)).toEqual({ by: 'none' })
  })
  it('a phone several partners share, with no email, matches no one', () => {
    const m = matchPartner({ email: null, phone: '8175550100' }, partners)
    expect(m.by).toBe('shared_phone')
    if (m.by === 'shared_phone') expect(m.partners.map((p) => p.id)).toEqual(['one', 'two', 'three'])
    // With an email, only partners with no email can match: two of them, still shared.
    expect(matchPartner({ email: 'new@office.com', phone: '8175550100' }, partners).by).toBe('shared_phone')
  })
  it('never matches by name', () => {
    expect(matchPartner({ email: null, phone: null }, partners)).toEqual({ by: 'nothing' })
    expect(matchPartner({ email: 'someone@else.com', phone: null }, partners)).toEqual({ by: 'none' })
  })
  it('leaves out the partner being edited', () => {
    expect(matchPartner({ email: 'riley@example.com', phone: null }, partners, 'riley')).toEqual({ by: 'none' })
  })
})

describe('partnerKindForRole', () => {
  it('maps team roles to partner kinds', () => {
    expect(partnerKindForRole('buyer_agent')).toBe('realtor')
    expect(partnerKindForRole('listing_agent')).toBe('realtor')
    expect(partnerKindForRole('title')).toBe('title')
    expect(partnerKindForRole('escrow_officer')).toBe('title')
    expect(partnerKindForRole('processor')).toBeNull()
    expect(partnerKindForRole('lender_ae')).toBeNull()
  })
})

describe('searchPartners', () => {
  it('searches name, company and email', () => {
    expect(searchPartners(partners, 'riley').map((p) => p.id)).toEqual(['riley'])
    expect(searchPartners(partners, 'front desk two').map((p) => p.id)).toEqual(['two'])
    expect(searchPartners(partners, 'example.com').map((p) => p.id)).toEqual(['riley'])
    expect(searchPartners(partners, '').length).toBe(5)
  })
  it('searches phone digits however they are typed', () => {
    expect(searchPartners(partners, '555-0142').map((p) => p.id)).toEqual(['lee'])
    expect(searchPartners(partners, '(214)').map((p) => p.id)).toEqual(['riley', 'lee'])
    expect(searchPartners(partners, '12').map((p) => p.id)).toEqual([])
  })
})

describe('splitFiles', () => {
  const f = (loanId: string, stage: string, closingDate: string | null): PartnerFile => ({ loanId, role: 'buyer_agent', stage, borrowerName: loanId, closingDate })
  it('puts open files first, soonest closing first, and closed files latest first', () => {
    const { open, closed } = splitFiles([f('a', 'closed', '2026-03-01'), f('b', 'under_contract', '2026-12-01'), f('c', 'lead', null), f('d', 'closed', '2026-09-01'), f('e', 'clear_to_close', '2026-11-15'), f('g', 'lost', null)])
    expect(open.map((x) => x.loanId)).toEqual(['e', 'b', 'c'])
    expect(closed.map((x) => x.loanId)).toEqual(['g', 'd', 'a'])
  })
})
