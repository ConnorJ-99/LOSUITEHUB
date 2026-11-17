import { describe, expect, it } from 'vitest'
import { applicationLinkFor, assistsFor, canProcess, cleanLinks, firstNameFor, isLoa } from './secondaryRoles'

const blank = { displayName: null, title: null, nmls: null, applicationUrl: null, bookingUrl: null, bioUrl: null }

describe('canProcess', () => {
  it('lets everyone before the script runs', () => {
    expect(canProcess({ id: 'a', role: 'loan_officer' })).toBe(true)
  })
  it('primary processors and Processor secondary role only', () => {
    expect(canProcess({ id: 'a', role: 'processor', secondaryRoles: [] })).toBe(true)
    expect(canProcess({ id: 'a', role: 'loan_officer', secondaryRoles: ['processor'] })).toBe(true)
    expect(canProcess({ id: 'a', role: 'loan_officer', secondaryRoles: ['loa'] })).toBe(false)
  })
})

describe('assistants', () => {
  it('reads who someone assists', () => {
    const a = [{ loaUserId: 'j', loUserId: 'c' }, { loaUserId: 'j', loUserId: 'd' }, { loaUserId: 'x', loUserId: 'c' }]
    expect(assistsFor('j', a)).toEqual(['c', 'd'])
    expect(isLoa({ id: 'j', role: 'loan_officer', secondaryRoles: ['loa'] })).toBe(true)
    expect(isLoa({ id: 'j', role: 'loan_officer' })).toBe(false)
  })
})

describe('cleanLinks', () => {
  it('adds https and trims', () => {
    const r = cleanLinks({ ...blank, displayName: ' Jamie ', bookingUrl: 'calendly.com/jamie', bioUrl: 'http://mps.mortgage/jamie' })
    expect(r.problems).toEqual({})
    expect(r.links.displayName).toBe('Jamie')
    expect(r.links.bookingUrl).toBe('https://calendly.com/jamie')
    expect(r.links.bioUrl).toBe('https://mps.mortgage/jamie')
  })
  it('reports a bad address', () => {
    expect(cleanLinks({ ...blank, applicationUrl: 'not a link' }).problems.applicationUrl).toBeTruthy()
  })
})

describe('applicationLinkFor', () => {
  it('own link first, else the NMLS link', () => {
    expect(applicationLinkFor({ applicationUrl: 'https://mps.mortgage/apply/dave', nmls: '1' })).toBe('https://mps.mortgage/apply/dave')
    expect(applicationLinkFor({ applicationUrl: null, nmls: '2611188' })).toBe('https://mpsmortgage.my1003app.com/2611188/register?time=')
    expect(applicationLinkFor({ applicationUrl: null, nmls: null })).toBeNull()
  })
})

describe('firstNameFor', () => {
  it('display name, else full name, else email', () => {
    expect(firstNameFor({ displayName: 'Jamie', fullName: 'Jamie Lee' })).toBe('Jamie')
    expect(firstNameFor({ fullName: 'Dave Smith' })).toBe('Dave')
    expect(firstNameFor({ email: 'dave@mps.mortgage' })).toBe('dave')
  })
})
