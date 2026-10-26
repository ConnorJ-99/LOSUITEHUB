import { describe, expect, it } from 'vitest'
import type { Signer } from '../../../supabase/functions/assistant/followUp'
import {
  closingDisclosureDue,
  deadlineTasks,
  federalHolidays,
  findOnOtherFiles,
  introEmail,
  introIssues,
  mergePerson,
  planTasks,
  samePerson,
  teamRoleFor,
  type ContractDates,
  type PastTeamMember,
} from './followThrough'

const dates: ContractDates = { contractDate: '2026-10-25', optionEndDate: '2026-11-01', financingDeadline: '2026-11-09', surveyDeadline: '2026-11-04', closingDate: '2026-12-03' }

describe('federalHolidays', () => {
  it('has the 2026 dates', () => {
    expect(federalHolidays(2026)).toEqual(['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-04', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25'])
  })
})

describe('closingDisclosureDue', () => {
  it('counts back 3 days, skipping Sundays and federal holidays', () => {
    expect(closingDisclosureDue('2026-12-03')).toBe('2026-11-30') // Thu → Mon
    expect(closingDisclosureDue('2026-11-12')).toBe('2026-11-07') // skips Veterans Day and Sunday; Saturday counts
    expect(closingDisclosureDue('2026-11-30')).toBe('2026-11-25') // skips Sunday and Thanksgiving
  })
})

describe('deadline tasks', () => {
  it('makes one task per date on the file', () => {
    expect(deadlineTasks(dates).map((t) => [t.key, t.dueOn])).toEqual([
      ['contract:earnest_money', '2026-10-28'],
      ['contract:option_end', '2026-11-01'],
      ['contract:survey', '2026-11-04'],
      ['contract:financing', '2026-11-09'],
      ['contract:closing_disclosure', '2026-11-30'],
    ])
    expect(deadlineTasks({ contractDate: null, optionEndDate: null, financingDeadline: null, surveyDeadline: null, closingDate: '2026-12-03' }).map((t) => t.key)).toEqual(['contract:closing_disclosure'])
  })
  it('knows which are new, moved, already set or done', () => {
    const wanted = deadlineTasks(dates)
    const plan = planTasks(wanted, [
      { id: 'a', sourceKey: 'contract:option_end', title: 'Option period ends (5:00 p.m.)', dueOn: '2026-11-01', completedAt: null },
      { id: 'b', sourceKey: 'contract:financing', title: 'x', dueOn: '2026-11-06', completedAt: null },
      { id: 'c', sourceKey: 'contract:earnest_money', title: 'x', dueOn: '2026-10-20', completedAt: '2026-10-27T15:00:00Z' },
      { id: 'd', sourceKey: null, title: 'Option period ends (5:00 p.m.)', dueOn: '2026-11-01', completedAt: null },
    ])
    expect(plan.map((p) => `${p.task.key}:${p.status}`)).toEqual(['contract:earnest_money:done', 'contract:option_end:set', 'contract:survey:new', 'contract:financing:moved', 'contract:closing_disclosure:new'])
  })
})

describe('people', () => {
  const past: PastTeamMember[] = [
    { loanId: 'other', borrowerName: 'Jane Smith', name: 'Lisa Lister', company: 'Sample Realty', email: 'LISA@example.com', phone: '(214) 555-0111' },
    { loanId: 'this', borrowerName: 'This file', name: 'Lisa Lister', company: null, email: 'lisa@example.com', phone: null },
  ]
  it('maps contract roles to team roles', () => {
    expect(teamRoleFor('listing_agent')).toBe('listing_agent')
    expect(teamRoleFor('seller')).toBeNull()
  })
  it('finds the same person on other files by email or phone, not by name', () => {
    expect(findOnOtherFiles({ name: 'L. Lister', company: null, email: 'lisa@example.com', phone: null }, past, 'this')?.borrowerName).toBe('Jane Smith')
    expect(findOnOtherFiles({ name: 'Someone', company: null, email: null, phone: '214.555.0111' }, past, 'this')?.loanId).toBe('other')
    expect(findOnOtherFiles({ name: 'Lisa Lister', company: null, email: null, phone: null }, past, 'this')).toBeNull()
  })
  it('fills gaps from the known record and compares people', () => {
    expect(mergePerson({ name: 'Lisa Lister', company: null, email: null, phone: '214-555-0111' }, past[0])).toEqual({ name: 'Lisa Lister', company: 'Sample Realty', email: 'LISA@example.com', phone: '214-555-0111' })
    expect(samePerson({ name: 'Sam Escrow (TEST)', company: null, email: null, phone: null }, { name: 'sam escrow', company: 'x', email: null, phone: null })).toBe(true)
    expect(samePerson({ name: 'Sam', company: null, email: 'a@example.com', phone: null }, { name: 'Pat', company: null, email: 'b@example.com', phone: null })).toBe(false)
  })
})

describe('introEmail', () => {
  const signer: Signer = { loName: 'Sample Officer', loNmls: '123456', loPhone: '(555) 555-0100', companyName: 'MPS Mortgage LLC', companyNmls: '2501110' }
  const facts = { buyerNames: 'Jane Smith', propertyAddress: '88 Test Owned Ct, Dallas, TX', dates, signer }
  it('introduces Connor to the listing agent with the timeline and signature', () => {
    const d = introEmail('listing_agent', { name: 'Lisa Lister', company: 'Sample Realty', email: 'lisa@example.com', phone: null }, facts)
    expect(d.to).toBe('Lisa Lister · lisa@example.com')
    expect(d.subject).toBe('Lender intro: 88 Test Owned Ct, Dallas, TX')
    expect(d.body).toContain('Hi Lisa,')
    expect(d.body).toContain("I'm Sample Officer with MPS Mortgage LLC, the lender for Jane Smith on 88 Test Owned Ct, Dallas, TX.")
    expect(d.body).toContain('- Option period ends: Nov 1, 2026')
    expect(d.body).toContain('MPS Mortgage LLC, NMLS #2501110')
    expect(introIssues(d, signer)).toEqual([])
  })
  it('asks title for the commitment and earnest money receipt, greeting a company politely', () => {
    const d = introEmail('title', { name: 'Sample Title Co', company: 'Sample Title Co', email: 'orders@example.com', phone: null }, facts)
    expect(d.subject).toBe('New order: 88 Test Owned Ct, Dallas, TX (buyer Jane Smith)')
    expect(d.body.startsWith('Hello,')).toBe(true)
    expect(d.body).toContain('title commitment')
    expect(introIssues(d, signer)).toEqual([])
  })
  it('leaves out dates that are not set', () => {
    const d = introEmail('buyer_agent', { name: 'Bob Agent', company: null, email: null, phone: null }, { ...facts, dates: { contractDate: null, optionEndDate: null, financingDeadline: null, surveyDeadline: null, closingDate: null } })
    expect(d.body).not.toContain('dates I am working from')
    expect(d.body).toContain('our mutual client Jane Smith')
  })
})
