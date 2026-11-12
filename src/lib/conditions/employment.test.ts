import { describe, expect, it } from 'vitest'
import { employmentDocs, historyChecks, windowStart, type HistoryJob } from './employment'

const today = '2026-11-12'
const job = (over: Partial<HistoryJob>): HistoryJob => ({ id: 'j', employerName: 'Acme', selfEmployed: false, current: false, startDate: null, endDate: null, ...over })
const excel = job({ id: 'excel', employerName: 'Excel', current: true, startDate: '2025-06-15' })
const homeDepot = job({ id: 'hd', employerName: 'Home Depot', startDate: '2024-06-01', endDate: '2025-06-01' })

describe('the lookback window', () => {
  it('is 24 months back, end of month safe', () => {
    expect(windowStart(today)).toBe('2024-11-12')
    expect(windowStart('2026-03-31')).toBe('2024-03-31')
    expect(windowStart('2026-02-29'.replace('29', '28'))).toBe('2024-02-28')
  })
})

describe("Connor's example: Excel (Jun 2025 – now) and Home Depot (Jun 2024 – Jun 2025)", () => {
  const docs = employmentDocs([excel, homeDepot], today)
  it('Excel: pay stubs + 2025 W-2; Home Depot: 2024 and 2025 W-2s + final pay stub', () => {
    expect(docs.map((d) => d.label)).toEqual(['Pay stubs: Excel', 'W-2 for 2025: Excel', 'W-2 for 2024: Home Depot', 'W-2 for 2025: Home Depot', 'Final pay stub: Home Depot'])
  })
  it('says why', () => {
    expect(docs[0].why).toBe('Excel, Jun 2025 – now')
    expect(docs[2].why).toBe('Home Depot, Jun 2024 – Jun 2025')
  })
  it('no history problems: 2 years covered, a 13-day break, no recent start', () => {
    expect(historyChecks([excel, homeDepot], today)).toEqual([])
  })
})

describe('documents', () => {
  it("this year's W-2 isn't asked for; a job that ended before the window isn't either", () => {
    const old = job({ id: 'old', employerName: 'Old Co', startDate: '2019-01-01', endDate: '2024-09-30' })
    const longTime = job({ id: 'lt', employerName: 'Long Time', current: true, startDate: '2015-03-01' })
    expect(employmentDocs([old, longTime], today).map((d) => d.label)).toEqual(['Pay stubs: Long Time', 'W-2 for 2024: Long Time', 'W-2 for 2025: Long Time'])
  })
  it('self-employed and undated jobs are left to the general rules', () => {
    expect(employmentDocs([job({ selfEmployed: true, current: true, startDate: '2020-01-01' }), job({ current: true })], today)).toEqual([])
  })
})

describe('history checks', () => {
  it('under 2 years covered asks for more history', () => {
    const c = historyChecks([job({ employerName: 'New Co', current: true, startDate: '2025-08-01' })], today)
    expect(c[0]).toMatchObject({ type: 'short_history', body: 'Provide additional employment or education history to cover 2 years' })
    expect(c[0].why).toMatch(/cover 15 months \(since Aug 2025\)/)
  })
  it('a gap over 30 days gets a letter of explanation with the dates', () => {
    const c = historyChecks([job({ id: 'a', employerName: 'A', startDate: '2023-01-01', endDate: '2025-03-31' }), job({ id: 'b', employerName: 'B', current: true, startDate: '2025-07-01' })], today)
    expect(c).toEqual([{ type: 'gap', ref: '2025-04-01', body: 'Letter of explanation for the employment gap Apr 1, 2025 – Jun 30, 2025', why: '91 days with no job on the 1003' }])
  })
  it('no current job: the gap runs to today', () => {
    const c = historyChecks([job({ employerName: 'A', startDate: '2020-01-01', endDate: '2026-08-31' })], today)
    expect(c.map((x) => x.body)).toEqual(['Letter of explanation for the employment gap Sep 1, 2026 – now'])
  })
  it('a current job started in the last 6 months is flagged for review', () => {
    const c = historyChecks([job({ id: 'a', employerName: 'A', startDate: '2018-01-01', endDate: '2026-06-15' }), job({ id: 'b', employerName: 'B', current: true, startDate: '2026-06-20' })], today)
    expect(c.map((x) => x.type)).toEqual(['recent_start'])
    expect(c[0].body).toMatch(/started at B on Jun 20, 2026/)
  })
  it('nothing is checked while any job is missing a date', () => {
    expect(historyChecks([job({ employerName: 'A', current: true, startDate: '2026-01-01' }), job({ employerName: 'B' })], today)).toEqual([])
  })
})
