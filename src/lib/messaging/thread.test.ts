import { describe, expect, it } from 'vitest'
import { consentChip, dayLabel, groupByDay, sharedPhoneIds, timeOfDay } from './thread'

// 10:00 AM Central on Thu Oct 29, 2026.
const now = new Date('2026-10-29T15:00:00Z')

describe('thread days and times (Central time)', () => {
  it('labels today, yesterday, this year and other years', () => {
    expect(dayLabel('2026-10-29T13:51:00Z', now)).toBe('Today')
    expect(dayLabel('2026-10-28T14:40:00Z', now)).toBe('Yesterday')
    expect(dayLabel('2026-10-26T18:00:00Z', now)).toBe('Mon, Oct 26')
    expect(dayLabel('2025-03-03T18:00:00Z', now)).toBe('Mar 3, 2025')
  })

  it('uses Central time near midnight (11:30 PM Central is still yesterday)', () => {
    expect(dayLabel('2026-10-29T04:30:00Z', now)).toBe('Yesterday')
    expect(timeOfDay('2026-10-29T04:30:00Z')).toBe('11:30 PM')
    expect(timeOfDay('2026-10-29T13:51:00Z')).toBe('8:51 AM')
  })

  it('groups a thread by day, keeping order', () => {
    const g = groupByDay([{ sentAt: '2026-10-28T14:40:00Z' }, { sentAt: '2026-10-28T15:05:00Z' }, { sentAt: '2026-10-29T13:51:00Z' }], now)
    expect(g.map((x) => [x.label, x.messages.length])).toEqual([
      ['Yesterday', 2],
      ['Today', 1],
    ])
  })
})

describe('consent chips', () => {
  it('opted out beats an old yes', () => {
    expect(consentChip('text', false, '2026-10-29T15:00:00Z')).toEqual({ label: 'Opted out Oct 29, 2026', tone: 'bad' })
  })
  it('yes, no, and not recorded', () => {
    expect(consentChip('text', true, null)).toEqual({ label: 'Texts OK', tone: 'ok' })
    expect(consentChip('email', true, null)).toEqual({ label: 'Email OK', tone: 'ok' })
    expect(consentChip('email', false, null)).toEqual({ label: 'No email consent', tone: 'warn' })
    expect(consentChip('text', null, null)).toEqual({ label: 'Consent not recorded', tone: 'warn' })
  })
})

describe('shared phones', () => {
  it('finds people on the file who share a number, however it was typed', () => {
    const ids = sharedPhoneIds([
      { id: 'jordan', phoneDigits: '2145550198' },
      { id: 'maya', phoneDigits: '12145550198' },
      { id: 'other', phoneDigits: '9725550100' },
      { id: 'none', phoneDigits: null },
    ])
    expect([...ids].sort()).toEqual(['jordan', 'maya'])
  })
})
