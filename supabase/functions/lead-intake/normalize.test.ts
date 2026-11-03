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
  it('reads "Below 620" as under 620', () => {
    expect(parseCreditScore('Below 620')).toBe(619)
    expect(parseCreditScore('under 580')).toBe(579)
  })
  it('names a lead from the email when no name is given', () => {
    expect(normalizeLead({ email: 'jdoe@example.com' }, 'partner')).toMatchObject({ kind: 'partner', firstName: 'jdoe', lastName: '' })
  })
})

// Shapes copied from the live mps.mortgage forms (2026-11-02): every form
// sends { form_type, payload }.
describe('the live website forms', () => {
  it('multi-step form: "empty" answers, credit range, percent down, consent, lead id', () => {
    const r = normalizeLead(
      {
        form_type: 'mortgage_preapproval',
        payload: {
          lead_id: 'b1c2d3',
          first_name: 'Jane',
          last_name: 'TEST',
          email: 'jane.test@example.com',
          phone: '2145550100',
          lead_source: 'empty',
          timeline: '30-60 days',
          occupancy: 'Primary residence',
          purchase_price: 400000,
          down_payment_mode: 'percent',
          down_payment_value: 10,
          down_payment: 10,
          credit_range: '700-739',
          contract_price: 'empty',
          sms_consent: true,
          assigned_to_email: 'empty',
          form_stage: 'lead_created',
        },
      },
      'lead',
    )
    expect(r).toMatchObject({
      purpose: 'purchase',
      purchasePrice: 400000,
      downPayment: 40000,
      creditScore: 700,
      timeline: '30-60 days',
      source: 'mps.mortgage website',
      assignedToEmail: null,
      smsConsent: true,
      formLeadId: 'b1c2d3',
    })
    // "empty" answers aren't kept with the submission.
    expect((r as { answers: Record<string, unknown> }).answers).not.toHaveProperty('contract_price')
  })
  it('multi-step form: a dollar down payment, "Not sure yet" and an investment home', () => {
    const r = normalizeLead({ form_type: 'mortgage_preapproval', payload: { email: 'a@example.com', occupancy: 'Investment property', purchase_price: 300000, down_payment_mode: 'amount', down_payment_value: 75000, down_payment: 75000, credit_range: 'Not sure' } }, 'lead')
    expect(r).toMatchObject({ purpose: 'investment_dscr', downPayment: 75000, creditScore: null })
    const unsure = normalizeLead({ form_type: 'mortgage_preapproval', payload: { email: 'a@example.com', down_payment_mode: 'unsure', down_payment_value: 'empty' } }, 'lead')
    expect(unsure).toMatchObject({ downPayment: null })
  })
  it('multi-step form: under contract uses the contract price', () => {
    const r = normalizeLead({ form_type: 'mortgage_preapproval', payload: { email: 'a@example.com', purchase_price: 'empty', contract_price: 365000 } }, 'lead')
    expect(r).toMatchObject({ purchasePrice: 365000 })
  })
  it('refinance form: goal, home value and balance', () => {
    const cash = normalizeLead({ form_type: 'refinance', payload: { email: 'a@example.com', refinance_goal: 'Take cash out', current_value: 467000, current_home_value: 467000, current_balance: 282000, cash_out_amount: 50000 } }, 'lead')
    expect(cash).toMatchObject({ purpose: 'refinance_cash_out', estimatedValue: 467000, loanBalance: 282000, cashOut: 50000 })
    expect(normalizeLead({ form_type: 'refinance', payload: { email: 'a@example.com', refinance_goal: 'Pay off/consolidate debt' } }, 'lead')).toMatchObject({ purpose: 'refinance_cash_out' })
    expect(normalizeLead({ form_type: 'refinance', payload: { email: 'a@example.com', refinance_goal: 'Lower my rate or payment' } }, 'lead')).toMatchObject({ purpose: 'refinance_rate_term' })
    expect(normalizeLead({ form_type: 'refinance', payload: { email: 'a@example.com', refinance_goal: 'empty' } }, 'lead')).toMatchObject({ purpose: 'refinance_rate_term' })
  })
  it('home equity form: HELOC, home equity loan, or not sure', () => {
    const he = (product: string) => normalizeLead({ form_type: 'home_equity', payload: { form_type: 'home_equity', loan_interest: 'home_equity', email: 'a@example.com', product_interest: product, sms_consent: false } }, 'lead')
    expect(he('HELOC')).toMatchObject({ purpose: 'heloc', smsConsent: false })
    expect(he('Home equity loan')).toMatchObject({ purpose: 'heloan' })
    expect(he('Not sure — compare both')).toMatchObject({ purpose: 'heloc' })
  })
  it('realtor prequal form: credit range from the survey', () => {
    const r = normalizeLead({ form_type: 'realtor_referral', payload: { first_name: 'Sam', last_name: 'TEST', email: 'sam@example.com', credit_range: '660-699', down_payment: 20000, realtor_name: 'Agent TEST' } }, 'lead')
    expect(r).toMatchObject({ creditScore: 660, downPayment: 20000, smsConsent: null })
  })
  it('open house form: the listing price', () => {
    const r = normalizeLead({ form_type: 'realtor_open_house_prequal', payload: { first_name: 'Ana', email: 'ana@example.com', listingPrice: '$425,000', credit_range: '740+' } }, 'lead')
    expect(r).toMatchObject({ purchasePrice: 425000, creditScore: 740 })
  })
  it('partner form: "partner_inquiry" is a partner even on the lead address', () => {
    const r = normalizeLead({ form_type: 'partner_inquiry', payload: { first_name: 'Pat', last_name: 'TEST', email: 'pat@example.com', company_name: 'Sample Realty', partner_type: 'realtor', contact_type: 'realtor', brokerage: 'Sample Realty', sms_consent: true } }, 'lead')
    expect(r).toMatchObject({ kind: 'partner', formType: 'partner_inquiry', smsConsent: true })
    expect((r as { answers: Record<string, unknown> }).answers.partner_type).toBe('realtor')
  })
  it('contact, hard money and chat forms still come in as leads', () => {
    expect(normalizeLead({ form_type: 'contact', payload: { name: 'Lee TEST', email: 'lee@example.com', message: 'Call me' } }, 'lead')).toMatchObject({ kind: 'lead', firstName: 'Lee', lastName: 'TEST', purpose: 'purchase' })
    expect(normalizeLead({ form_type: 'hard_money', payload: { name: 'Lee', phone: '2145550100', scenario: 'Fix and flip, rent it out after', loan_purpose: 'Fix and flip, rent it out after' } }, 'lead')).toMatchObject({ purpose: 'investment_dscr' })
    expect(normalizeLead({ form_type: 'caddie_chat', payload: { first_name: 'Kim', email: 'kim@example.com', question: 'empty', sms_consent: false } }, 'lead')).toMatchObject({ formType: 'caddie_chat', smsConsent: false })
  })
})
