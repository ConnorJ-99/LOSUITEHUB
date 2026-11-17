import { describe, expect, it } from 'vitest'
import { buildTemplate, realtorChoices, realtorMissing, type TemplateFacts } from './templates'

const amy = { name: 'Amy Lee', company: 'Keller Williams', phone: '2145550101', email: 'amy@kw.test' }
const bob = { name: 'Bob Ray', company: null, phone: '+1 817 555 0202', email: 'bob@ray.test' }
const facts = (o: Partial<TemplateFacts> = {}): TemplateFacts => ({ borrowerFirst: 'Pat Smith', loName: 'Connor Jacquart', nmls: '2611188', realtors: [], ...o })

describe('realtor introduction', () => {
  it('text: one realtor, name, company and phone, no email or link', () => {
    const r = buildTemplate('realtor_intro', 'text', facts({ realtors: [amy] }))
    expect(r).toEqual({
      body: "Hi Pat, this is Connor with MPS Mortgage. If you don't have a real estate agent yet, here's one I trust and work with often: Amy Lee, Keller Williams, (214) 555-0101. Feel free to reach out to them, or let me know and I'll make the introduction. - Connor",
      subject: 'A real estate agent I recommend',
    })
  })
  it('text: several realtors, separated, and no company when none is saved', () => {
    const r = buildTemplate('realtor_intro', 'text', facts({ realtors: [amy, bob] }))
    expect('body' in r && r.body).toContain('here are a few I trust and work with often: Amy Lee, Keller Williams, (214) 555-0101; Bob Ray, (817) 555-0202. Feel free to reach out to any of them')
    expect('body' in r && r.body).not.toMatch(/@|https?:/)
  })
  it('email: a list with each email, signed by the loan officer', () => {
    const r = buildTemplate('realtor_intro', 'email', facts({ realtors: [amy, bob] }))
    expect(r).toEqual({
      body: "Hi Pat,\n\nIf you don't have a real estate agent yet, here are a few I trust and work with often:\n\n- Amy Lee, Keller Williams, (214) 555-0101, amy@kw.test\n- Bob Ray, (817) 555-0202, bob@ray.test\n\nFeel free to reach out to any of them, or let me know and I'll make the introduction.\n\nConnor Jacquart\nMPS Mortgage",
      subject: 'Real estate agents I recommend',
    })
  })
  it('needs a realtor, and a phone for a text or an email for an email', () => {
    expect(buildTemplate('realtor_intro', 'text', facts())).toEqual({ error: 'Pick at least one realtor.' })
    expect(buildTemplate('realtor_intro', 'text', facts({ realtors: [{ ...amy, phone: null }] }))).toEqual({ error: 'Amy Lee has no phone saved.' })
    expect(buildTemplate('realtor_intro', 'email', facts({ realtors: [{ ...amy, email: ' ' }] }))).toEqual({ error: 'Amy Lee has no email saved.' })
    expect(realtorMissing({ phone: '555', email: null }, 'text')).toBe('No phone')
    expect(realtorMissing({ phone: null, email: 'a@b.test' }, 'email')).toBeNull()
  })
  it('lists realtors only: preferred, then Active, then the rest, by name', () => {
    const p = (name: string, kind: string, stage: string, preferred = false) => ({ name, kind, stage, details: { preferred } })
    const list = realtorChoices([p('Zed', 'realtor', 'active'), p('Title Co', 'title', 'active', true), p('Ann', 'realtor', 'nurture'), p('Yve', 'realtor', 'contacted', true), p('Ben', 'realtor', 'active')])
    expect(list.map((x) => x.name)).toEqual(['Yve', 'Ben', 'Zed', 'Ann'])
  })
})

describe('everyday templates', () => {
  it('checking in', () => {
    expect(buildTemplate('check_in', 'text', facts())).toEqual({
      body: 'Hi Pat, this is Connor with MPS Mortgage. Just checking in to see how things are going. Is there anything I can help with or any questions I can answer? - Connor',
      subject: 'Checking in',
    })
    const e = buildTemplate('check_in', 'email', facts({ loName: null, borrowerFirst: '' }))
    expect('body' in e && e.body).toBe('Hi there,\n\nJust checking in to see how things are going. Is there anything I can help with or any questions I can answer?\n\nMPS Mortgage')
  })
  it('document reminder names no documents or figures', () => {
    const r = buildTemplate('document_reminder', 'text', facts())
    expect('body' in r && r.body).toBe(
      "Hi Pat, this is Connor with MPS Mortgage. Friendly reminder that we're still waiting on a few documents to keep your loan moving. Send them over when you get a chance, and let me know if you have any questions about what's needed. - Connor",
    )
  })
  it('application link: email only, with the NMLS # link', () => {
    expect(buildTemplate('application_link', 'text', facts())).toEqual({ error: 'The application link goes by email only (texts carry no links).' })
    expect(buildTemplate('application_link', 'email', facts({ nmls: null }))).toEqual({ error: 'Add your NMLS # in Settings → My profile to use the application link.' })
    const r = buildTemplate('application_link', 'email', facts())
    expect('body' in r && r.body).toContain('start your loan application here:\nhttps://mpsmortgage.my1003app.com/2611188/register?time=')
    expect('subject' in r && r.subject).toBe('Your loan application')
  })
})
