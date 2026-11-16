import { describe, expect, it } from 'vitest'
import { DEFAULT_NURTURE_SETTINGS, nurtureSettingsFrom, nurtureSettingsProblem, readNurtureContext, reportedMilestones } from './followups'

describe('nurture check-in drafts', () => {
  it('reads the nurture context, ignoring other items', () => {
    const c = readNurtureContext({ body: 'x', nurture: { kind: 'overdue', planVersion: 2, milestoneTitle: 'Balances lowered', targetDate: '2026-11-11', reason: 'Late' } })
    expect(c).toMatchObject({ kind: 'overdue', planVersion: 2, milestoneTitle: 'Balances lowered', goal: null, reason: 'Late' })
    expect(readNurtureContext({ lead: { nextAction: 'ready_to_shop' } })).toBeNull()
    expect(readNurtureContext({ nurture: { kind: 'nope' } })).toBeNull()
  })
})

describe('nurture settings', () => {
  it('defaults with no row, null before the script', () => {
    expect(nurtureSettingsFrom(null)).toEqual(DEFAULT_NURTURE_SETTINGS)
    expect(nurtureSettingsFrom({ enabled: true })).toBeNull()
    expect(nurtureSettingsFrom({ nurture_enabled: true, nurture_roadmap_days: 5, nurture_overdue_days: 2, nurture_quiet_days: 0 })).toEqual({ enabled: true, roadmapDays: 5, overdueDays: 2, quietDays: 0 })
  })
  it('checks the day ranges', () => {
    expect(nurtureSettingsProblem(DEFAULT_NURTURE_SETTINGS)).toBeNull()
    expect(nurtureSettingsProblem({ ...DEFAULT_NURTURE_SETTINGS, overdueDays: 0 })).toMatch(/Overdue/)
    expect(nurtureSettingsProblem({ ...DEFAULT_NURTURE_SETTINGS, quietDays: 31 })).toMatch(/Quiet/)
  })
})

describe('reported updates', () => {
  it('marks milestones with an open update', () => {
    const s = reportedMilestones([
      { status: 'unverified', milestoneId: 'a' },
      { status: 'verified', milestoneId: 'b' },
      { status: 'queued', milestoneId: null },
    ])
    expect([...s]).toEqual(['a'])
  })
})
