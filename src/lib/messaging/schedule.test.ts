import { describe, expect, it } from 'vitest'
import { defaultSchedule, fromCentral, planBatches, scheduleLabel, toCentral } from './schedule'

describe('fromCentral', () => {
  it('reads a Central time in standard time (UTC-6)', () => {
    expect(fromCentral('2026-12-01', '09:30')?.toISOString()).toBe('2026-12-01T15:30:00.000Z')
  })
  it('reads a Central time in daylight time (UTC-5)', () => {
    expect(fromCentral('2026-07-04', '09:30')?.toISOString()).toBe('2026-07-04T14:30:00.000Z')
  })
  it('handles the day daylight saving ends', () => {
    expect(fromCentral('2026-11-01', '12:00')?.toISOString()).toBe('2026-11-01T18:00:00.000Z')
  })
  it('round-trips with toCentral', () => {
    const d = fromCentral('2027-03-15', '21:05')!
    expect(toCentral(d)).toEqual({ date: '2027-03-15', time: '21:05' })
  })
  it('rejects what isn\'t a day and time', () => {
    expect(fromCentral('2026-02-30', '09:00')).toBeNull()
    expect(fromCentral('2026-12-01', '25:00')).toBeNull()
    expect(fromCentral('', '09:00')).toBeNull()
  })
  it('rejects a time that is skipped when clocks spring forward', () => {
    expect(fromCentral('2027-03-14', '02:30')).toBeNull()
  })
})

describe('labels and defaults', () => {
  it('says the day and time in Central', () => {
    expect(scheduleLabel(new Date('2026-12-02T15:30:00Z'))).toBe('Wed, Dec 2 at 9:30 AM')
  })
  it('suggests tomorrow at 9 AM Central', () => {
    expect(defaultSchedule(new Date('2026-11-03T23:00:00Z'))).toEqual({ date: '2026-11-04', time: '09:00' })
    // 11:30 PM Central on Nov 3 is already Nov 4 in UTC; tomorrow is still Nov 4 Central.
    expect(defaultSchedule(new Date('2026-11-04T05:30:00Z'))).toEqual({ date: '2026-11-04', time: '09:00' })
  })
})

describe('planBatches', () => {
  const always = () => true
  it('sends 20 a minute from the next whole minute', () => {
    const at = planBatches(45, new Date('2026-12-01T15:00:10Z'), always)!
    expect(at.length).toBe(45)
    expect(at[0].toISOString()).toBe('2026-12-01T15:01:00.000Z')
    expect(at[19].toISOString()).toBe('2026-12-01T15:01:00.000Z')
    expect(at[20].toISOString()).toBe('2026-12-01T15:02:00.000Z')
    expect(at[44].toISOString()).toBe('2026-12-01T15:03:00.000Z')
  })
  it('skips minutes outside sending hours', () => {
    // Open only from 15:05.
    const at = planBatches(25, new Date('2026-12-01T15:00:00Z'), (d) => d.getUTCMinutes() >= 5)!
    expect(at[0].toISOString()).toBe('2026-12-01T15:05:00.000Z')
    expect(at[24].toISOString()).toBe('2026-12-01T15:06:00.000Z')
  })
  it('gives up when nothing is open for a week', () => {
    expect(planBatches(1, new Date('2026-12-01T15:00:00Z'), () => false)).toBeNull()
  })
})
