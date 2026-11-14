import { describe, expect, it } from 'vitest'
import { readyChip, showsReady } from './card'
import { readyLabel, readyOnFor, timelineMonths } from './timeline'

describe('lead ready dates', () => {
  it('counts months from the time frame', () => {
    expect(timelineMonths('ASAP')).toBe(0)
    expect(timelineMonths('2 months')).toBe(2)
    expect(timelineMonths('3-6 months')).toBe(3)
    expect(timelineMonths('6+ months')).toBe(6)
    expect(timelineMonths('60-90 days')).toBe(2)
    expect(timelineMonths('In the next 3 months')).toBe(3)
    expect(timelineMonths('1–3 months')).toBe(1)
    expect(timelineMonths('Just looking')).toBeNull()
    expect(timelineMonths('after the lease ends')).toBeNull()
    expect(timelineMonths(null)).toBeNull()
  })
  it('works out the ready date like the database', () => {
    expect(readyOnFor('ASAP', '2026-11-14')).toBe('2026-11-14')
    expect(readyOnFor('2 months', '2026-11-14')).toBe('2027-01-14')
    expect(readyOnFor('1 month', '2027-01-31')).toBe('2027-02-28')
    expect(readyOnFor('Just looking', '2026-11-14')).toBeNull()
  })
  it('labels the month, with the year when it is not this year', () => {
    expect(readyLabel('2026-11-30', '2026-11-14')).toBe('Ready now')
    expect(readyLabel('2026-09-01', '2026-11-14')).toBe('Ready now')
    expect(readyLabel('2026-12-14', '2026-11-14')).toBe('Ready Dec')
    expect(readyLabel('2027-02-14', '2026-11-14')).toBe('Ready Feb 2027')
  })
  it('builds the card chip', () => {
    expect(readyChip({ timeline: '3 months', readyOn: '2027-02-14' }, '2026-11-14')).toEqual({ label: 'Ready Feb 2027', detail: '3 months', now: false })
    expect(readyChip({ timeline: 'ASAP', readyOn: '2026-11-14' }, '2026-11-14')).toEqual({ label: 'Ready now', detail: 'ASAP', now: true })
    expect(readyChip({ timeline: 'after the lease ends', readyOn: null }, '2026-11-14')).toEqual({ label: 'after the lease ends', detail: null, now: false })
    expect(readyChip({ timeline: 'just looking', readyOn: null }, '2026-11-14')).toEqual({ label: 'Just looking', detail: null, now: false })
    expect(readyChip({ timeline: null, readyOn: undefined }, '2026-11-14')).toBeNull()
  })
  it('shows until the file is under contract', () => {
    expect(showsReady({ stage: 'lead' })).toBe(true)
    expect(showsReady({ stage: 'pre_approved' })).toBe(true)
    expect(showsReady({ stage: 'under_contract' })).toBe(false)
  })
})
