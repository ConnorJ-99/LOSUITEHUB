import { describe, expect, it } from 'vitest'
import { appOrigin, myHomeAtClose, myHomeFieldIds, myHomeFieldsBody, myHomeLink } from './myhome'

describe('MyHome code to GHL', () => {
  it('at closing: invites when there is no account, leaves a turned-off one alone, else writes the fields', () => {
    expect(myHomeAtClose(null)).toBe('invite')
    expect(myHomeAtClose({ status: 'off' })).toBe('off')
    expect(myHomeAtClose({ status: 'invited' })).toBe('write')
    expect(myHomeAtClose({ status: 'active' })).toBe('write')
  })
  it('takes the app address from https, or localhost while testing', () => {
    expect(appOrigin('https://app.mps.mortgage/loans/1')).toBe('https://app.mps.mortgage')
    expect(appOrigin('http://localhost:5173')).toBe('http://localhost:5173')
    expect(appOrigin('http://app.mps.mortgage')).toBeNull()
    expect(appOrigin('javascript:alert(1)')).toBeNull()
    expect(appOrigin(42)).toBeNull()
  })
  it('the link never expires and carries only the token', () => {
    expect(myHomeLink('https://app.mps.mortgage', 'a'.repeat(64))).toBe(`https://app.mps.mortgage/myhome?invite=${'a'.repeat(64)}`)
  })
  it('finds the two fields by their GHL key', () => {
    const body = { customFields: [{ id: 'f1', fieldKey: 'contact.home_management_code' }, { id: 'f2', fieldKey: 'contact.home_management_link' }, { id: 'f3', fieldKey: 'contact.other' }] }
    expect(myHomeFieldIds(body)).toEqual({ code: 'f1', link: 'f2' })
    expect(myHomeFieldIds({ customFields: [{ id: 'f1', fieldKey: 'contact.home_management_code' }] })).toEqual({ code: 'f1', link: null })
    expect(myHomeFieldIds(null)).toEqual({ code: null, link: null })
  })
  it('writes by id when known, else by key', () => {
    expect(myHomeFieldsBody({ code: 'f1', link: null }, '123456', 'https://x/myhome?invite=t')).toEqual({
      customFields: [
        { id: 'f1', field_value: '123456' },
        { key: 'home_management_link', field_value: 'https://x/myhome?invite=t' },
      ],
    })
  })
})
