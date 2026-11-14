import { describe, expect, it } from 'vitest'
import { partnerFileFor, type PartnerFile } from './partnerFile'

const donnie: PartnerFile = { loanId: 'donnie', borrowerNames: ['Donnie Beam'], loanNumbers: ['GF 26-11873'], open: true, createdAt: '2026-11-01' }
const jenna: PartnerFile = { loanId: 'jenna', borrowerNames: ['Jenna Winters', 'Sam Winters'], loanNumbers: ['UW-554433'], open: true, createdAt: '2026-11-10' }
const old: PartnerFile = { loanId: 'old', borrowerNames: ['Pat Old'], loanNumbers: [], open: false, createdAt: '2026-12-01' }

describe('which file a partner message is about', () => {
  it('finds the borrower named in the subject', () => {
    expect(partnerFileFor('RE: Title Request from MPS MORTGAGE LLC: Donnie Beam, Azle, TX', [donnie, jenna], 'jenna')).toBe('donnie')
  })
  it('finds a loan number, ignoring dashes and spaces', () => {
    expect(partnerFileFor('Commitment for GF# 2611873 attached', [donnie, jenna], null)).toBe('donnie')
    expect(partnerFileFor('Dec page for loan UW554433', [donnie, jenna], null)).toBe('jenna')
  })
  it('falls back to the file we last wrote from', () => {
    expect(partnerFileFor('Got it, thanks!', [donnie, jenna], 'donnie')).toBe('donnie')
  })
  it('then the newest open file', () => {
    expect(partnerFileFor('Got it', [donnie, jenna, old], null)).toBe('jenna')
    expect(partnerFileFor('Got it', [old], null)).toBe('old')
  })
  it('does not guess when two files are named', () => {
    expect(partnerFileFor('Donnie Beam and Jenna Winters', [donnie, jenna], 'donnie')).toBe('donnie')
  })
  it('does not match a first name alone', () => {
    expect(partnerFileFor('Hi Donnie', [donnie, jenna], null)).toBe('jenna')
  })
  it('has nothing to pick with no files', () => {
    expect(partnerFileFor('Hi', [], null)).toBeNull()
  })
})
