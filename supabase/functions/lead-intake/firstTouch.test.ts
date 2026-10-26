import { describe, expect, it } from 'vitest'
import { complianceIssues, emailSignature as assistantSignature } from '../assistant/followUp'
import { emailSignature, firstTouchDrafts, whatTheyDid, type Signer } from './firstTouch'

const signer: Signer = { loName: 'Sample Officer', loNmls: '123456', loPhone: '(555) 555-0100', companyName: 'MPS Mortgage LLC', companyNmls: '2501110' }
const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '2145550144', formType: 'affordability', purpose: 'purchase' }

describe('first touch', () => {
  it('names what they did on the site', () => {
    expect(whatTheyDid('home_value', 'refinance_cash_out')).toBe('checking your home value on our site')
    expect(whatTheyDid('listing_buying_power', 'purchase')).toBe('running the numbers on what you can afford')
    expect(whatTheyDid('quote_calculator', 'purchase')).toBe('using the calculator on our site')
    expect(whatTheyDid(null, 'refinance_rate_term')).toBe('reaching out about refinancing')
    expect(whatTheyDid(null, 'purchase')).toBe('reaching out through our website')
  })

  it('drafts a short text and an email with the signature', () => {
    const [text, email] = firstTouchDrafts(jane, signer)
    expect(text).toEqual({
      channel: 'text',
      to: 'Jane Doe · (214) 555-0144',
      subject: null,
      body: "Hi Jane, this is Sample with MPS Mortgage LLC. Thanks for running the numbers on what you can afford! When's a good time for a quick call to talk through what you're looking for?",
    })
    expect(email.subject).toBe('Thanks for reaching out, Jane')
    expect(email.to).toBe('Jane Doe · jane@example.com')
    expect(email.body).toContain('MPS Mortgage LLC, NMLS #2501110')
  })

  it('passes the same compliance checks as every draft', () => {
    for (const d of firstTouchDrafts(jane, signer)) {
      const body = d.channel === 'email' ? d.body.replace(emailSignature(signer), '') : d.body
      expect(complianceIssues(d.channel, { subject: d.subject, body })).toEqual([])
    }
    const long = firstTouchDrafts({ ...jane, firstName: 'Bartholomew-Alexander', formType: 'listing' }, { ...signer, loName: 'Christopher Montgomery' })
    expect(long[0].body.length).toBeLessThanOrEqual(320)
  })

  it('uses the same signature as the assistant', () => {
    expect(emailSignature(signer)).toBe(assistantSignature(signer))
    expect(emailSignature({ ...signer, loName: null, loPhone: null })).toBe(assistantSignature({ ...signer, loName: null, loPhone: null }))
  })

  it('only drafts what it can send', () => {
    expect(firstTouchDrafts({ ...jane, phone: null }, signer).map((d) => d.channel)).toEqual(['email'])
    expect(firstTouchDrafts({ ...jane, email: null }, signer).map((d) => d.channel)).toEqual(['text'])
  })
})
