import { describe, expect, it } from 'vitest'
import { centralNow, e164, hasTestName, planSend, sendWindow, textToHtml, type SendFacts } from './sendRules'

const HOURS = { mon: ['09:00', '21:00'], tue: ['09:00', '21:00'], wed: ['09:00', '21:00'], thu: ['09:00', '21:00'], fri: ['09:00', '21:00'], sat: ['09:00', '21:00'], sun: ['12:00', '21:00'] } as const
const hours = HOURS as unknown as SendFacts['hours']
// Thu Oct 29, 2026: 10:00 AM Central = 15:00 UTC (CDT).
const thuMorning = new Date('2026-10-29T15:00:00Z')

describe('sending hours (Central time)', () => {
  it('reads the day and time in Central', () => {
    expect(centralNow(thuMorning)).toEqual({ day: 'thu', time: '10:00' })
    // 10:40 PM Thursday Central is 03:40 UTC Friday.
    expect(centralNow(new Date('2026-10-30T03:40:00Z'))).toEqual({ day: 'thu', time: '22:40' })
  })

  it('open inside the window, with when it closes', () => {
    expect(sendWindow(hours, thuMorning)).toEqual({ open: true, label: 'OK to send now · until 9 PM' })
  })

  it('closed at 9 PM sharp and after, opening tomorrow', () => {
    expect(sendWindow(hours, new Date('2026-10-30T02:00:00Z'))).toEqual({ open: false, label: 'Outside sending hours · opens tomorrow 9 AM' })
  })

  it('early morning opens later today; Saturday night opens Sunday at noon', () => {
    expect(sendWindow(hours, new Date('2026-10-29T12:30:00Z'))).toEqual({ open: false, label: 'Outside sending hours · opens 9 AM' })
    expect(sendWindow(hours, new Date('2026-11-01T03:30:00Z'))).toEqual({ open: false, label: 'Outside sending hours · opens tomorrow 12 PM' })
  })

  it('a day turned off is skipped', () => {
    expect(sendWindow({ ...hours, fri: null }, new Date('2026-10-30T03:40:00Z')).label).toBe('Outside sending hours · opens Sat 9 AM')
    expect(sendWindow({}, thuMorning).open).toBe(false)
  })
})

describe('helpers', () => {
  it('TEST names, phones for GHL, safe email HTML', () => {
    expect(hasTestName('Connor', 'TEST')).toBe(true)
    expect(hasTestName('connor', 'jacquart')).toBe(false)
    expect(hasTestName('Tester', null)).toBe(false)
    expect(e164('(214) 555-0198')).toBe('+12145550198')
    expect(e164('12145550198')).toBe('+12145550198')
    expect(e164('555-0198')).toBeNull()
    expect(textToHtml('Hi <b>Jordan</b>,\nSee below.\n\nThanks & regards')).toBe('<p>Hi &lt;b&gt;Jordan&lt;/b&gt;,<br>See below.</p><p>Thanks &amp; regards</p>')
  })
})

const facts = (over: Partial<SendFacts> = {}, person: Partial<SendFacts['person']> = {}): SendFacts => ({
  channel: 'text',
  body: 'Hi Connor, this is a test text from LOSuite.',
  subject: null,
  person: { firstName: 'Connor', lastName: 'TEST', phone: '214-555-0101', email: 'connor@example.test', smsConsent: true, emailConsent: true, smsOptedOutAt: null, emailOptedOutAt: null, ...person },
  testMode: true,
  hours,
  now: thuMorning,
  lo: { name: 'Connor', ghlNumber: '+19725550142', numberConfirmed: true, ghlEmail: 'connor@example.test' },
  emailDomainVerified: false,
  ...over,
})

describe('planning a send', () => {
  it('a text that passes every rule goes from the LO\'s confirmed number', () => {
    expect(planSend(facts())).toEqual({ problems: [], to: '+12145550101', fromNumber: '+19725550142', fromEmail: null })
  })

  it('email goes from info@ until the domain is verified, then from the LO', () => {
    expect(planSend(facts({ channel: 'email', subject: 'LOSuite test' })).fromEmail).toBe('info@mps.mortgage')
    expect(planSend(facts({ channel: 'email', subject: 'LOSuite test', emailDomainVerified: true })).fromEmail).toBe('connor@example.test')
  })

  it('test mode refuses people without TEST in their name', () => {
    expect(planSend(facts({}, { lastName: 'Smith' })).problems).toEqual(['Test mode: LOSuite only sends to people with TEST in their name.'])
    expect(planSend(facts({ testMode: false }, { lastName: 'Smith' })).problems).toEqual([])
  })

  it('no consent, or an opt-out, stops it', () => {
    expect(planSend(facts({}, { smsConsent: null })).problems).toEqual(['Connor has no text consent on file. Record it first (with how they agreed).'])
    expect(planSend(facts({}, { smsConsent: true, smsOptedOutAt: '2026-10-29T00:00:00Z' })).problems[0]).toMatch(/opted out of texts/)
    expect(planSend(facts({ channel: 'email', subject: 's' }, { emailConsent: false })).problems[0]).toMatch(/no email consent/)
  })

  it('outside sending hours nothing goes', () => {
    expect(planSend(facts({ now: new Date('2026-10-30T03:40:00Z') })).problems).toEqual(['Outside sending hours · opens tomorrow 9 AM. Nothing sends outside them (Settings → Sending).'])
  })

  it('no LO, or an LO without a confirmed number, waits for review (no company number)', () => {
    expect(planSend(facts({ lo: null })).problems).toEqual(['This file has no loan officer, so it waits for an admin to review.'])
    const p = planSend(facts({ lo: { name: 'Dave', ghlNumber: '+19725550143', numberConfirmed: false, ghlEmail: null } }))
    expect(p.problems[0]).toMatch(/Dave isn't linked to a confirmed GHL number/)
    expect(p.fromNumber).toBeNull()
  })

  it('a missing phone, empty message, email subject and long text are all named', () => {
    expect(planSend(facts({ body: '  ' }, { phone: null })).problems).toEqual(['Write a message first.', 'Connor has no 10-digit mobile number.'])
    expect(planSend(facts({ channel: 'email', subject: '' })).problems).toEqual(['An email needs a subject.'])
    expect(planSend(facts({ body: 'x'.repeat(1001) })).problems[0]).toMatch(/limited to 1000/)
  })
})
