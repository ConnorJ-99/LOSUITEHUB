import { describe, expect, it } from 'vitest'
import { matchContact, normalizeEmail, phone10, type Candidate } from './match'

const person = (id: string, email: string | null, phoneDigits: string | null, ghlContactId: string | null = null): Candidate => ({ id, email, phoneDigits, ghlContactId })

// TEST people only.
const gina = person('gina', 'Gina.Test@Example.com', '2145550111')
const maya = person('maya', 'maya@example.test', '2145550198')
const jordan = person('jordan', 'jordan@example.test', '12145550198') // same household phone as Maya, typed with a 1
const ivy = person('ivy', 'shared@example.test', '9725550100')
const ike = person('ike', 'shared@example.test', '9725550101')
const linked = person('linked', 'linked@example.test', '8175550123', 'ghl-linked')
const everyone = [gina, maya, jordan, ivy, ike, linked]

describe('cleaning the keys', () => {
  it('compares emails without case or spaces', () => {
    expect(normalizeEmail('  Gina.Test@EXAMPLE.com ')).toBe('gina.test@example.com')
    expect(normalizeEmail('not an email')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })

  it('compares the last 10 digits of a phone', () => {
    expect(phone10('+1 (214) 555-0111')).toBe('2145550111')
    expect(phone10('12145550111')).toBe('2145550111')
    expect(phone10('555-0111')).toBeNull()
    expect(phone10(null)).toBeNull()
  })
})

describe('matching a GHL contact to a person', () => {
  it('a GHL id already stored on a person wins, even if the email says otherwise', () => {
    expect(matchContact({ id: 'ghl-linked', email: 'gina.test@example.com', phone: null }, everyone)).toEqual({ kind: 'matched', contactId: 'linked', by: 'ghl_id' })
  })

  it('then the email, ignoring case and spaces', () => {
    expect(matchContact({ id: 'g1', email: ' GINA.test@example.com', phone: '+12145550111' }, everyone)).toEqual({ kind: 'matched', contactId: 'gina', by: 'email' })
  })

  it('then the phone', () => {
    expect(matchContact({ id: 'g2', email: null, phone: '+1 214-555-0111' }, everyone)).toEqual({ kind: 'matched', contactId: 'gina', by: 'phone' })
  })

  it('never by name: a contact with only a name matches nobody', () => {
    expect(matchContact({ id: 'g3', email: null, phone: null }, everyone)).toEqual({ kind: 'needs_matching', reason: 'no_match', candidateIds: [] })
  })

  it('an unknown email and phone go to Needs matching', () => {
    expect(matchContact({ id: 'g4', email: 'new@example.test', phone: '4695550000' }, everyone)).toMatchObject({ kind: 'needs_matching', reason: 'no_match' })
  })

  it('a shared household phone with no email to tell them apart goes to Needs matching', () => {
    expect(matchContact({ id: 'g5', email: null, phone: '(214) 555-0198' }, everyone)).toEqual({ kind: 'needs_matching', reason: 'shared_phone', candidateIds: ['maya', 'jordan'] })
  })

  it('a shared household phone is fine when the email picks one of them', () => {
    expect(matchContact({ id: 'g6', email: 'jordan@example.test', phone: '2145550198' }, everyone)).toEqual({ kind: 'matched', contactId: 'jordan', by: 'email' })
  })

  it('a shared email goes to Needs matching, even when the phone could pick one', () => {
    expect(matchContact({ id: 'g7', email: 'shared@example.test', phone: '9725550100' }, everyone)).toEqual({ kind: 'needs_matching', reason: 'shared_email', candidateIds: ['ivy', 'ike'] })
  })

  it('an email and a phone that point to different people go to Needs matching', () => {
    expect(matchContact({ id: 'g8', email: 'gina.test@example.com', phone: '2145550198' }, everyone)).toEqual({
      kind: 'needs_matching',
      reason: 'email_phone_differ',
      candidateIds: ['gina', 'maya', 'jordan'],
    })
  })

  it('a person already linked to a different GHL contact isn\'t matched again (a GHL duplicate)', () => {
    expect(matchContact({ id: 'ghl-duplicate', email: 'linked@example.test', phone: null }, everyone)).toEqual({ kind: 'needs_matching', reason: 'linked_to_other_ghl', candidateIds: ['linked'] })
    expect(matchContact({ id: 'ghl-duplicate', email: null, phone: '817-555-0123' }, everyone)).toMatchObject({ reason: 'linked_to_other_ghl' })
  })

  it('an unknown email with the phone of someone who has a different email goes to Needs matching (maybe another person on that phone)', () => {
    expect(matchContact({ id: 'g9', email: 'other@example.test', phone: '2145550111' }, everyone)).toEqual({ kind: 'needs_matching', reason: 'email_phone_differ', candidateIds: ['gina'] })
  })

  it('an unknown email is fine when the phone\'s owner has no email on file', () => {
    const noEmail = person('ned', null, '4695550123')
    expect(matchContact({ id: 'g10', email: 'ned@example.test', phone: '469-555-0123' }, [...everyone, noEmail])).toEqual({ kind: 'matched', contactId: 'ned', by: 'phone' })
  })
})
