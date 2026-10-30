import { describe, expect, it } from 'vitest'
import { CHECKS, assignedNumber, classify, errorText, logEndpoint, missingScopes, pickNumbers, pickUsers, type CheckOutcome } from './checks'

const plan = (key: string) => CHECKS.find((c) => c.key === key)!

describe('reading GHL answers', () => {
  it('a normal answer means the call works', () => {
    expect(classify(plan('location'), 200, { location: {} }).result).toBe('works')
  })

  it('a scope refusal names the scope to add', () => {
    const r = classify(plan('users'), 401, { statusCode: 401, message: 'The token is not authorized for this scope.' })
    expect(r.result).toBe('missing_scope')
    expect(r.detail).toContain('users.readonly')
  })

  it('a rejected token is not mistaken for a missing scope', () => {
    expect(classify(plan('location'), 401, { message: 'Invalid token: access token is invalid' }).result).toBe('bad_token')
  })

  it('the blank write tests count GHL refusing the content as allowed', () => {
    expect(classify(plan('messages_write'), 422, { message: ['contactId must be a string'] }).result).toBe('works')
    expect(classify(plan('contacts_write'), 400, { message: 'Contact not found' }).result).toBe('works')
    expect(classify(plan('contacts_write'), 404, {}).result).toBe('works')
  })

  it('the same refusal on a real read is a failure', () => {
    expect(classify(plan('contacts_read'), 422, { message: ['locationId is required'] })).toMatchObject({ result: 'failed', detail: 'locationId is required' })
  })

  it('no answer at all is a failure', () => {
    expect(classify(plan('location'), null, 'GHL took too long to answer.')).toMatchObject({ result: 'failed', httpStatus: null })
  })

  it('keeps error text short', () => {
    expect(errorText({ message: 'x'.repeat(500) })).toHaveLength(200)
    expect(errorText(null)).toBe('')
  })
})

describe('what the report keeps', () => {
  it('keeps name, email, id, phone and the number assigned in this sub-account', () => {
    const users = pickUsers(
      {
        users: [
          { id: 'u1', name: 'Connor TEST', email: 'connor@example.test', phone: '+1 469-555-0142', lcPhone: { loc1: '+14695550142', other: '+12145550000' }, roles: { type: 'account', role: 'admin' }, permissions: { x: true } },
          { id: 'u2', firstName: 'Dave', lastName: 'TEST', email: 'dave@example.test', lcPhone: { loc1: '' } },
        ],
      },
      'loc1',
    )
    expect(users).toEqual([
      { id: 'u1', name: 'Connor TEST', email: 'connor@example.test', phone: '+1 469-555-0142', ghlNumber: '+14695550142', role: 'account admin' },
      { id: 'u2', name: 'Dave TEST', email: 'dave@example.test', phone: null, ghlNumber: null, role: null },
    ])
  })

  it('keeps each number, whether it is the default, and who it is assigned to', () => {
    expect(pickNumbers({ numbers: [{ phoneNumber: '+14695550142', friendlyName: 'Connor', isDefaultNumber: false, linkedUser: 'u1', type: 'local', sid: 'PN1' }] })).toEqual([
      { number: '+14695550142', name: 'Connor', isDefault: false, assignedUserId: 'u1', type: 'local' },
    ])
    expect(pickNumbers(null)).toEqual([])
  })

  it('a user\'s number comes from GHL\'s number list, else their sub-account number', () => {
    const dave = { id: 'u2', name: 'Dave TEST', email: null, phone: '+12145550000', ghlNumber: '+19725550001', role: null }
    const list = [{ number: '+19725550002', name: null, isDefault: false, assignedUserId: 'u2', type: 'local' }]
    expect(assignedNumber(dave, list)).toBe('+19725550002')
    expect(assignedNumber(dave, [])).toBe('+19725550001')
    // Their personal cell is never used.
    expect(assignedNumber({ ...dave, ghlNumber: null }, [])).toBeNull()
  })

  it('logs the path without the query string', () => {
    expect(logEndpoint('/users/search?companyId=abc&locationId=xyz')).toBe('/users/search')
    expect(logEndpoint('/locations/xyz')).toBe('/locations/xyz')
  })

  it('lists each missing scope once', () => {
    const o = (scope: string, result: CheckOutcome['result']) => ({ key: 'users', label: '', scope, result, httpStatus: 401, detail: '' }) as CheckOutcome
    expect(missingScopes([o('users.readonly', 'missing_scope'), o('users.readonly', 'missing_scope'), o('contacts.write', 'works')])).toEqual(['users.readonly'])
  })
})
