import { describe, expect, it } from 'vitest'
import { INVITE_TOKEN, cleanCode, emailLooksValid, fileLabel, isLocked, orderFiles, pickAccount, sameCode, viewFor, type MyHomeFile } from './rules'

describe('emails and codes', () => {
  it('compares codes exactly', () => {
    expect(sameCode('482913', '482913')).toBe(true)
    expect(sameCode('482913', '482914')).toBe(false)
    expect(sameCode('48291', '482913')).toBe(false)
  })
  it('locks after 5 wrong tries in an hour', () => {
    expect(isLocked(4)).toBe(false)
    expect(isLocked(5)).toBe(true)
  })
  it('the link token is 64 lowercase hex characters', () => {
    expect(INVITE_TOKEN.test('a'.repeat(64))).toBe(true)
    expect(INVITE_TOKEN.test('A'.repeat(64))).toBe(false)
    expect(INVITE_TOKEN.test('a'.repeat(63))).toBe(false)
  })
  it('checks the email loosely', () => {
    expect(emailLooksValid('maya@test.com')).toBe(true)
    expect(emailLooksValid('maya @test.com')).toBe(false)
    expect(emailLooksValid('maya@test')).toBe(false)
  })
  it('cleans the typed code', () => {
    expect(cleanCode('482 913')).toBe('482913')
    expect(cleanCode('482-913')).toBe('482913')
    expect(cleanCode('48291')).toBeNull()
    expect(cleanCode('48291a')).toBeNull()
  })
})

describe('pickAccount', () => {
  const maya = { accountId: 'a1', status: 'active' as const, contactEmail: 'Maya.Test@Example.com' }
  it('finds the account by email, any case and spaces', () => {
    expect(pickAccount([maya], '  maya.test@example.com ')).toEqual({ accountId: 'a1' })
  })
  it('an invited account counts; a turned-off one does not', () => {
    expect(pickAccount([{ ...maya, status: 'invited' }], 'maya.test@example.com')).toEqual({ accountId: 'a1' })
    expect(pickAccount([{ ...maya, status: 'off' }], 'maya.test@example.com')).toEqual({ problem: 'none' })
  })
  it('two people with one email: no code', () => {
    expect(pickAccount([maya, { ...maya, accountId: 'a2' }], 'maya.test@example.com')).toEqual({ problem: 'shared' })
  })
  it('a different email: none', () => {
    expect(pickAccount([maya], 'other@example.com')).toEqual({ problem: 'none' })
    expect(pickAccount([maya], '')).toEqual({ problem: 'none' })
  })
})

describe('files', () => {
  it('picks the view from the stage', () => {
    expect(viewFor('processing')).toBe('active')
    expect(viewFor('underwriting')).toBe('active')
    expect(viewFor('lead')).toBe('active')
    expect(viewFor('nurture')).toBe('nurture')
    expect(viewFor('closed')).toBe('closed')
    expect(viewFor('lost')).toBeNull()
  })
  it('labels the chips', () => {
    expect(fileLabel({ view: 'active', purpose: 'purchase', address: '1420 Oak Ridge Dr, Frisco' })).toBe('Purchase · 1420 Oak Ridge Dr')
    expect(fileLabel({ view: 'active', purpose: 'refinance_rate_term', address: null })).toBe('Refinance')
    expect(fileLabel({ view: 'closed', purpose: 'purchase', address: '88 Willow Bend Ct' })).toBe('88 Willow Bend Ct · Closed')
    expect(fileLabel({ view: 'closed', purpose: 'heloc', address: null })).toBe('Home equity line · Closed')
    expect(fileLabel({ view: 'nurture', purpose: 'purchase', address: null })).toBe('Getting ready to buy')
  })
  it('orders open, then getting ready, then closed by latest closing', () => {
    const f = (loanId: string, view: MyHomeFile['view'], closingDate: string | null, createdAt: string) => ({ loanId, view, closingDate, createdAt })
    const out = orderFiles([f('c-old', 'closed', '2021-03-19', '2021-01-01'), f('n', 'nurture', null, '2026-08-01'), f('c-new', 'closed', '2024-05-01', '2024-01-01'), f('a-old', 'active', null, '2026-01-01'), f('a-new', 'active', null, '2026-10-01')])
    expect(out.map((x) => x.loanId)).toEqual(['a-new', 'a-old', 'n', 'c-new', 'c-old'])
  })
})
