import { describe, expect, it } from 'vitest'
import { answersText, answersView, fieldLabel, formTitle, isBlank, leadSummary, personFromAnswers, rawLines, sentenceCase } from './webForms'

const now = new Date(2026, 10, 2, 21, 54)

/** The real mortgage_preapproval submission from dev (2026-11-02), as saved. */
const preapproval = {
  goal: 'Get preapproved to buy',
  assets: '125000',
  income: '120000',
  source: 'mps_mortgage',
  lead_id: '444edf4c-b128-49be-a741-e99ce151ec84',
  location: 'empty',
  timeline: 'empty',
  lead_code: '213466',
  occupancy: 'Second home',
  form_stage: 'contact_confirmed',
  lead_types: 'under-contract',
  entry_point: 'preapproval',
  has_realtor: 'empty',
  hourly_rate: 'empty',
  lead_source: 'empty',
  sms_consent: true,
  buying_stage: 'Already under contract',
  closing_date: '2026-11-22',
  credit_range: '660-699',
  current_rate: 'empty',
  down_payment: '5',
  entry_intent: 'mortgage_preapproval',
  // The rest of what the multi-step form sends (contact details and ids swapped for samples).
  email: 'test@example.com',
  phone: '2145550100',
  first_name: 'Test',
  last_name: 'Lead',
  form_type: 'mortgage_preapproval',
  referrer: 'https://example.com/',
  landing_page: 'https://example.com/get-started',
  income_types: 'Salary',
  loan_purpose: 'Get preapproved to buy',
  monthly_debt: '0',
  original_cta: 'Start my preapproval',
  self_prequal: 'false',
  asset_sources: 'Bank account',
  income_amount: '120000',
  lead_priority: '1',
  monthly_debts: '0',
  primary_route: 'under_contract',
  routing_email: 'lo@example.com',
  self_employed: 'false',
  property_found: 'Yes',
  property_stage: "Yes, I'm under contract",
  purchase_price: '125000',
  under_contract: 'true',
  contact_consent: 'true',
  starting_option: 'Same-Day Preapproval',
  available_assets: '125000',
  first_time_buyer: 'No',
  property_address: 'Not sure yet',
  transaction_type: 'purchase',
  assigned_to_email: 'lo@example.com',
  down_payment_mode: 'percent',
  down_payment_value: '5',
  loan_officer_email: 'lo@example.com',
  requested_callback: 'true',
  application_started: 'false',
  lead_priority_label: 'hot',
  first_time_homebuyer: 'No',
  assigned_loan_officer: 'Sample Officer',
  last_completed_module: 'contact_confirmed',
  assigned_loan_officer_id: '00000000-0000-0000-0000-000000000001',
  assigned_loan_officer_nmls: 'NMLS #0000000',
  completed_prequalification: 'false',
  requested_prequalification: 'false',
  assigned_loan_officer_email: 'lo@example.com',
  assigned_loan_officer_phone: '(214) 555-0100',
}

const fields = (v: ReturnType<typeof answersView>) => v.sections.flatMap((s) => s.fields)

describe('isBlank', () => {
  it('treats placeholder words, empty lists and empty objects as blank', () => {
    for (const v of [null, undefined, '', '  ', 'empty', 'EMPTY', 'null', 'undefined', 'n/a', 'None', '-', [], {}, ['empty'], { a: '' }]) expect(isBlank(v), JSON.stringify(v)).toBe(true)
    for (const v of ['0', 0, false, 'no', 'Second home', [1]]) expect(isBlank(v), JSON.stringify(v)).toBe(false)
  })
})

describe('labels and words', () => {
  it('reads keys and slugs as words', () => {
    expect(fieldLabel('purchase_price')).toBe('Purchase price')
    expect(fieldLabel('homeValue')).toBe('Home value')
    expect(fieldLabel('utm_source')).toBe('UTM source')
    expect(formTitle('mortgage_preapproval')).toBe('Mortgage preapproval')
    expect(formTitle('empty')).toBe('Web form')
    expect(sentenceCase('under-contract')).toBe('Under contract')
    expect(sentenceCase('second_home')).toBe('Second home')
    expect(sentenceCase('Get preapproved to buy')).toBe('Get preapproved to buy')
  })
})

describe('answersView', () => {
  const view = answersView(preapproval, {}, now)

  it('hides "empty" answers and internal fields', () => {
    const keys = fields(view).map((f) => f.key)
    for (const k of ['location', 'timeline', 'has_realtor', 'hourly_rate', 'current_rate', 'lead_id', 'lead_code', 'form_stage', 'entry_point', 'entry_intent', 'source', 'lead_source', 'sms_consent']) expect(keys).not.toContain(k)
    expect(JSON.stringify(view)).not.toMatch(/empty/i)
  })

  it('hides lead types when they repeat the buying stage', () => {
    expect(fields(view).map((f) => f.key)).not.toContain('lead_types')
    expect(fields(answersView({ buying_stage: 'Just looking', lead_types: 'refinance' }, {}, now)).map((f) => f.key)).toContain('lead_types')
    expect(fields(answersView({ goal: 'Get preapproved to buy', loan_purpose: 'get preapproved to buy' }, {}, now)).map((f) => f.key)).toEqual(['goal'])
  })

  it('groups and formats the real preapproval form', () => {
    expect(view.sections.map((s) => [s.title, s.fields.map((f) => `${f.label}: ${f.value}${f.sub ? ` (${f.sub})` : ''}`)])).toEqual([
      ['The loan', ['Goal: Get preapproved to buy', 'Buying stage: Already under contract', 'Property use: Second home', 'Address: Not sure yet', 'Purchase price: $125,000', 'Down payment: $6,250 · 5%', 'Closing date: Nov 22, 2026 (in 20 days)']],
      ['Them', ['Credit estimate: 660–699', 'Income type: Salary', 'Income: $120,000/yr', 'Assets: $125,000', 'Assets in: Bank account', 'Monthly debts: $0/mo']],
    ])
    expect(view.checks.map((c) => c.label)).toEqual(['Not first-time buyer', 'Found a home', 'Wants a call back', 'Not self-employed'])
    expect(view.smsOk).toBe(true)
    expect(view.origin.map((o) => o.label)).toEqual(['Source', 'Referrer', 'Landing page', 'Original cta', 'Starting option'])
    expect(view.originShort).toBeNull()
  })

  it('shows a percent down payment in dollars when there is a price', () => {
    const v = answersView({ purchase_price: 485000, down_payment: 5 }, {}, now)
    expect(fields(v).find((f) => f.key === 'down_payment')).toMatchObject({ value: '$24,250 · 5%', money: true })
    expect(fields(answersView({ purchase_price: 485000, down_payment: '48500' }, {}, now)).find((f) => f.key === 'down_payment')?.value).toBe('$48,500 · 10%')
    expect(fields(answersView({ purchase_price: 400000, down_payment: 50, down_payment_mode: 'amount' }, {}, now)).find((f) => f.key === 'down_payment')?.value).toBe('$50 · 0%')
  })

  it('formats dates before and after today', () => {
    expect(fields(answersView({ closing_date: '2026-10-13' }, {}, now))[0]).toMatchObject({ value: 'Oct 13, 2026', sub: '20 days ago' })
  })

  it('formats rates, refi LTV, monthly figures, yes/no and unknown keys', () => {
    const v = answersView({ current_rate: '6.25', current_value: '610000', current_home_balance: 352000, cash_out: '60000', monthly_income: 9500, favoriteColor: 'blue', extras: { a: 1, nested: { b: 2 } }, list: ['x', 'empty'] }, {}, now)
    const f = Object.fromEntries(fields(v).map((x) => [x.key, x]))
    expect(f.current_rate.value).toBe('6.25%')
    expect(f.current_home_balance).toMatchObject({ label: 'Owes', value: '$352,000', sub: '58% LTV' })
    expect(f.cash_out).toMatchObject({ label: 'Wants cash', value: '$60,000' })
    expect(f.monthly_income.value).toBe('$9,500/mo')
    expect(f.favorite_color).toMatchObject({ label: 'Favorite color', value: 'Blue' })
    expect(f.extras.value).toBe('A: 1')
    expect(f.list.value).toBe('X')
  })

  it('makes yes/no answers into quick checks and pulls out the note', () => {
    const v = answersView({ first_time_buyer: 'yes', pre_approved: false, has_realtor: 'false', veteran: true, notes: 'Looking this weekend.' }, {}, now)
    expect(v.checks.map((c) => [c.label, c.ok])).toEqual([
      ['No agent yet', false],
      ['First-time buyer', true],
      ['Veteran', true],
      ['Not pre-approved', false],
    ])
    expect(v.note).toBe('Looking this weekend.')
    expect(answersText(v)).toBe('No agent yet\nFirst-time buyer\nVeteran\nNot pre-approved\nTheir note: Looking this weekend.')
  })

  it('puts where they came from in its own list, from answers and tracking', () => {
    const v = answersView({ utm_source: 'google', utmMedium: 'cpc' }, { utm_campaign: 'refi-cashout-tx' }, now)
    expect(v.origin.map((o) => o.label)).toEqual(['UTM source', 'UTM medium', 'UTM campaign'])
    expect(v.originShort).toBe('google / cpc')
    expect(v.sections).toEqual([])
  })

  it('keeps raw answers without the blanks', () => {
    expect(rawLines({ a: 'empty', b: '5', c: { x: 1 } })).toEqual([
      { key: 'b', value: '5' },
      { key: 'c', value: '{"x":1}' },
    ])
  })
})

describe('leadSummary', () => {
  it('shows price, down payment, credit and closing date for a purchase under contract', () => {
    const s = leadSummary(answersView({ ...preapproval, purchase_price: '485000', first_time_buyer: true, notes: 'Need a letter by Friday.' }, {}, now))
    expect(s.goal).toBe('Get preapproved to buy')
    expect(s.pills).toEqual(['First-time buyer', 'Already under contract', 'Second home'])
    expect(s.tiles.map((t) => [t.label, t.value, t.sub ?? null])).toEqual([
      ['Purchase price', '$485,000', null],
      ['Down payment', '$24,250', '5%'],
      ['Credit estimate', '660–699', null],
      ['Closing date', 'Nov 22, 2026', 'in 20 days'],
    ])
    expect(s.note).toBe('Need a letter by Friday.')
    // Address, income type, income, assets, assets in, monthly debts, and three quick checks.
    expect(s.more).toBe(9)
  })

  it('shows home value, balance with LTV, cash out and credit for a refi', () => {
    const s = leadSummary(answersView({ goal: 'cash-out refi', current_value: 610000, loan_balance: 352000, cash_out: 60000, credit_range: '740+' }, {}, now))
    expect(s.tiles.map((t) => [t.label, t.value, t.sub ?? null])).toEqual([
      ['Home value', '$610,000', null],
      ['Owes', '$352,000', '58% LTV'],
      ['Wants cash', '$60,000', null],
      ['Credit estimate', '740+', null],
    ])
    expect(s.more).toBe(0)
  })
})

describe('personFromAnswers', () => {
  it('reads a partner inquiry', () => {
    expect(personFromAnswers({ first_name: 'Rita', last_name: 'Realtor', email: 'rita@example.com', phone: '2145550100', brokerage: 'Sample Realty' })).toEqual({ name: 'Rita Realtor', contactLine: 'rita@example.com · 2145550100 · Sample Realty' })
    expect(personFromAnswers({ name: 'Bob Builder', company: 'Homes Inc' })).toEqual({ name: 'Bob Builder', contactLine: 'Homes Inc' })
    expect(personFromAnswers({ last_name: 'empty', first_name: 'Ann' })).toEqual({ name: 'Ann', contactLine: null })
    expect(personFromAnswers({})).toEqual({ name: 'Someone', contactLine: null })
  })
})
