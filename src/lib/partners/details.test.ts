import { describe, expect, it } from 'vitest'
import { defaultViaGmail, emailDomain, splitEmails } from './details'

describe('partner details', () => {
  it('works out the company email domain, never a public mailbox', () => {
    expect(emailDomain(' GF@LoneStarTitle.com ')).toBe('lonestartitle.com')
    expect(emailDomain('kevin@gmail.com')).toBeNull()
    expect(emailDomain('a@icloud.com')).toBeNull()
    expect(emailDomain(null)).toBeNull()
    expect(emailDomain('no-at-sign')).toBeNull()
  })
  it('emails title and insurance through Gmail by default', () => {
    expect(defaultViaGmail('title')).toBe(true)
    expect(defaultViaGmail('insurance')).toBe(true)
    expect(defaultViaGmail('realtor')).toBe(false)
  })
  it('splits a list of emails', () => {
    expect(splitEmails('A@x.com, b@x.com; a@x.com  c@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
    expect(splitEmails('  ')).toEqual([])
  })
})
