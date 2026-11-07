import { describe, expect, it } from 'vitest'
import { lastDays, pageAnalytics, sourceOf } from './analytics'

describe('page analytics', () => {
  it('30 days ending today, oldest first', () => {
    const d = lastDays('2026-11-07')
    expect(d).toHaveLength(30)
    expect(d[0]).toBe('2026-10-09')
    expect(d[29]).toBe('2026-11-07')
  })

  it('where a submission came from', () => {
    expect(sourceOf({ outcome: 'personal_link', source: {} })).toBe('Personal link')
    expect(sourceOf({ outcome: 'new_lead', source: { utm_source: 'facebook', utm_campaign: 'fall' } })).toBe('facebook · fall')
    expect(sourceOf({ outcome: 'new_lead', source: { referrer: 'https://www.zillow.com/x' } })).toBe('zillow.com')
    expect(sourceOf({ outcome: 'new_lead', source: {} })).toBe('Direct')
  })

  it('counts, conversion and sources', () => {
    const a = pageAnalytics({
      today: '2026-11-07',
      viewDays: [
        { day: '2026-11-07', views: 30 },
        { day: '2026-11-01', views: 10 },
        { day: '2026-09-01', views: 99 },
      ],
      viewCountAll: 139,
      submissions: [
        { createdAt: '2026-11-07T15:00:00Z', outcome: 'new_lead', source: { utm_source: 'facebook' } },
        { createdAt: '2026-11-01T15:00:00Z', outcome: 'personal_link', source: {} },
        // 2:30 AM UTC on Nov 8 is still Nov 7 in Texas.
        { createdAt: '2026-11-08T02:30:00Z', outcome: 'new_lead', source: { utm_source: 'facebook' } },
        { createdAt: '2026-08-01T15:00:00Z', outcome: 'new_lead', source: {} },
      ],
    })
    expect(a.views30).toBe(40)
    expect(a.submissions30).toBe(3)
    expect(a.conversionPct).toBe(7.5)
    expect(a.days.at(-1)).toEqual({ day: '2026-11-07', views: 30, submissions: 2 })
    expect(a.viewsAll).toBe(139)
    expect(a.submissionsAll).toBe(4)
    expect(a.sources).toEqual([
      { source: 'facebook', submissions: 2 },
      { source: 'Direct', submissions: 1 },
      { source: 'Personal link', submissions: 1 },
    ])
  })

  it('no views, no conversion', () => {
    expect(pageAnalytics({ today: '2026-11-07', viewDays: [], viewCountAll: 0, submissions: [] }).conversionPct).toBeNull()
  })
})
