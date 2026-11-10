import { describe, expect, it } from 'vitest'
import { pickGhlMatch, sharedDetails, splitName } from './link'

describe('GHL match', () => {
  it('takes the phone match, else the email match, else none', () => {
    expect(pickGhlMatch('a', null)).toEqual({ id: 'a' })
    expect(pickGhlMatch(null, 'b')).toEqual({ id: 'b' })
    expect(pickGhlMatch('a', 'a')).toEqual({ id: 'a' })
    expect(pickGhlMatch(null, null)).toEqual({ id: null })
  })
  it('stops when the phone and the email are two different GHL contacts', () => {
    expect(pickGhlMatch('a', 'b')).toHaveProperty('problem', expect.stringMatching(/two different GHL contacts/))
  })
})

describe('shared email or phone in LOSuite', () => {
  const me = { email: 'Jo@Example.test ', phone: '(214) 555-0100' }
  it('flags the same email (case and spaces aside)', () => {
    expect(sharedDetails(me, [{ email: 'jo@example.test', phone: null }])).toMatch(/same email/)
  })
  it('flags the same phone, with or without a leading 1', () => {
    expect(sharedDetails(me, [{ email: null, phone: '+1 214-555-0100' }])).toMatch(/same phone/)
  })
  it('passes when nobody else shares them', () => {
    expect(sharedDetails(me, [{ email: 'other@example.test', phone: '2145550199' }])).toBeNull()
    expect(sharedDetails({ email: null, phone: null }, [{ email: null, phone: null }])).toBeNull()
  })
})

describe("a partner's name", () => {
  it('splits into first and last name', () => {
    expect(splitName('Mary Ann Smith')).toEqual({ first: 'Mary Ann', last: 'Smith' })
    expect(splitName(' Cher ')).toEqual({ first: 'Cher', last: null })
  })
})
