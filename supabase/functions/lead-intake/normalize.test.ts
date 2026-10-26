import { describe, expect, it } from 'vitest'
import { normalizeLead, normalizePhone, parseCreditScore, parseMoney, parsePurpose, sanitize, secretMatches } from './normalize'

describe('cleanup rules', () => {
  it('reads money the way people type it', () => {
    expect(parseMoney('$450k')).toBe(450000)
    expect(parseMoney('1.2m')).toBe(1200000)
    expect(parseMoney('450,000')).toBe(450000)
    expect(parseMoney(325000)).toBe(325000)
    expect(parseMoney('about 400')).toBeNull()
    expect(parseMoney(-5)).toBeNull()
  })
  it('keeps 10-digit US phones', () => {
    expect(normalizePhone('(214) 555-0100')).toBe('2145550100')
    expect(normalizePhone('+1 214.555.0100')).toBe('2145550100')
    expect(normalizePhone('555-0100')).toBeNull()
  })
  it('maps plain-language purposes', () => {
    expect(parsePurpose('Cash-out refi', null)).toBe('refinance_cash_out')
    expect(parsePurpose('Lower my payment', null)).toBe('refinance_rate_term')
    expect(parsePurpose('HELOC', null)).toBe('heloc')
    expect(parsePurpose('', 'dscr_calculator')).toBe('investment_dscr')
    expect(parsePurpose('Buy a home', 'affordability')).toBe('purchase')
    expect(parsePurpose(undefined, null)).toBe('purchase')
  })
  it('reads credit ranges', () => {
    expect(parseCreditScore('700-739')).toBe(700)
    expect(parseCreditScore('Excellent (740+)')).toBe(740)
    expect(parseCreditScore('good')).toBeNull()
  })
  it('never keeps SSNs, account numbers or passwords', () => {
    expect(
      sanitize({ name: 'Jane', ssn: '123-45-6789', socialSecurityNumber: '123456789', account_number: '00012345', routing: '111000025', notes: 'my ss is 123-45-6789', nested: { bank_account_number: 'x', tax_id: '9' }, accountType: 'checking' }),
    ).toEqual({ name: 'Jane', notes: 'my ss is [removed]', nested: {}, accountType: 'checking' })
  })
  it('checks the secret strictly', () => {
    expect(secretMatches('a-long-shared-secret-123', 'a-long-shared-secret-123')).toBe(true)
    expect(secretMatches('a-long-shared-secret-124', 'a-long-shared-secret-123')).toBe(false)
    expect(secretMatches('short', 'short')).toBe(false) // secrets under 16 characters are refused
    expect(secretMatches(null, 'a-long-shared-secret-123')).toBe(false)
  })
})

describe('normalizeLead', () => {
  it("accepts the old app's payload as-is", () => {
    const r = normalizeLead(
      {
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'Jane@Example.com ',
        phone: '214-555-1234',
        loan_purpose: 'Purchase',
        purchase_price: '$500k',
        down_payment: 50000,
        lead_source: 'Your New App Name',
        form_type: 'quote_calculator',
        assigned_to_email: 'connor@mps.mortgage',
        utm_source: 'google',
        favorite_color: 'blue',
      },
      'lead',
    )
    expect(r).toMatchObject({
      kind: 'lead',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '2145551234',
      purpose: 'purchase',
      purchasePrice: 500000,
      downPayment: 50000,
      source: 'Your New App Name',
      formType: 'quote_calculator',
      assignedToEmail: 'connor@mps.mortgage',
      tracking: { utm_source: 'google' },
    })
    // Extra fields are kept with the submission, not dropped.
    expect((r as { answers: Record<string, unknown> }).answers.favorite_color).toBe('blue')
  })
  it('accepts the website function wrapper { form_type, payload }', () => {
    const r = normalizeLead({ form_type: 'home_value', payload: { name: 'Marcus Reyes', phone: '2145550177', home_value: '467k', mortgage_balance: '282000', loan_purpose: 'Cash out' } }, 'lead')
    expect(r).toMatchObject({ firstName: 'Marcus', lastName: 'Reyes', formType: 'home_value', estimatedValue: 467000, loanBalance: 282000, purpose: 'refinance_cash_out', source: 'mps.mortgage website' })
  })
  it('needs an email or phone', () => {
    expect(normalizeLead({ first_name: 'Jane', phone: '123' }, 'lead')).toEqual({ error: 'An email or phone number is required.' })
    expect(normalizeLead('nope', 'lead')).toHaveProperty('error')
  })
  it('names a lead from the email when no name is given', () => {
    expect(normalizeLead({ email: 'jdoe@example.com' }, 'partner')).toMatchObject({ kind: 'partner', firstName: 'jdoe', lastName: '' })
  })
})
