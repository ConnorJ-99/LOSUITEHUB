import { describe, expect, it } from 'vitest'
import type { RegisterRow } from '@/lib/closed/register'
import { businessMetrics, lastMonths, metricsByLo, periodRange, type PipelineLoan } from './business'

const file = (id: string, createdAt: string, stage: string, extra: Partial<PipelineLoan> = {}): PipelineLoan => ({ id, createdAt, stage, imported: false, loId: 'connor', leadSource: 'company', contactId: `p-${id}`, ...extra })
const closed = (id: string, productionDate: string, loanAmount: number, gross: number | null, loComp: number | null, extra: Partial<RegisterRow> = {}) =>
  ({ id, productionDate, loanAmount, gross, loComp, net: gross == null || loComp == null ? null : gross - loComp, loId: 'connor', leadSourceType: 'company', ...extra }) as RegisterRow

const nov = { from: '2026-11-01', to: '2026-11-30', loId: null, leadSource: null }

describe('business metrics', () => {
  const files = [
    file('a', '2026-11-03T15:00:00Z', 'lead'),
    file('b', '2026-11-05T15:00:00Z', 'pre_approved'),
    file('c', '2026-11-06T15:00:00Z', 'closed'),
    // Same person twice in the month counts once.
    file('d', '2026-11-07T15:00:00Z', 'lost', { contactId: 'p-a' }),
    // Made Oct 31 at 11 pm Central (Nov 1 UTC): October.
    file('e', '2026-11-01T04:30:00Z', 'processing'),
    // An imported closed client isn't a lead.
    file('f', '2026-11-08T15:00:00Z', 'closed', { imported: true }),
    file('g', '2026-11-09T15:00:00Z', 'under_contract', { loId: 'dave', leadSource: 'self' }),
  ]
  const funded = [closed('c', '2026-11-20', 400_000, 8_000, 2_820), closed('f', '2026-11-02', 200_000, null, null), closed('x', '2026-10-30', 300_000, 6_000, 2_115)]

  it('counts leads, active clients, closed loans, volume and revenue for the period', () => {
    expect(businessMetrics(files, funded, nov)).toEqual({
      newLeads: 4, // a (and d), b, c, g
      activeClients: 3, // b, e, g
      closedLoans: 2,
      fundedVolume: 600_000,
      averageLoan: 300_000,
      conversionPct: 25, // 1 of 4 people closed
      convertedLeads: 1,
      grossRevenue: 8_000,
      loComp: 2_820,
      companyRevenue: 5_180,
      missingRevenue: 1,
    })
  })
  it('filters by loan officer and lead source', () => {
    expect(businessMetrics(files, funded, { ...nov, loId: 'dave' })).toMatchObject({ newLeads: 1, activeClients: 1, closedLoans: 0, conversionPct: 0, averageLoan: null })
    expect(businessMetrics(files, funded, { ...nov, leadSource: 'self' }).newLeads).toBe(1)
  })
  it('no leads = no conversion figure', () => {
    expect(businessMetrics([], [], nov).conversionPct).toBeNull()
  })
  it('by loan officer, busiest first', () => {
    const rows = metricsByLo(files, funded, nov, new Map([['connor', 'Connor'], ['dave', 'Dave']]))
    expect(rows.map((r) => [r.name, r.m.newLeads, r.m.closedLoans])).toEqual([['Connor', 3, 2], ['Dave', 1, 0]])
  })
  it('periods and months', () => {
    expect(periodRange('this_quarter', '2026-11-13')).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(periodRange('last_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(periodRange('ytd', '2026-11-13')).toEqual({ from: '2026-01-01', to: '2026-11-13' })
    expect(periodRange('last_12', '2026-11-13')).toEqual({ from: '2025-12-01', to: '2026-11-30' })
    expect(lastMonths('2026-03-05', 3).map((m) => m.label)).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026'])
    expect(lastMonths('2024-02-10', 1)[0].to).toBe('2024-02-29')
  })
})
