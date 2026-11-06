import { describe, expect, it } from 'vitest'
import { blankDrafts, draftError, formatLtv, formatPoints, latestByScenario, openRun, orderScenarios, pricedCount, pricingIsStale, saveRows, scenarioError, scenarioLabel, type RefiBenchmark, type RefiRun } from './benchmarks'

const bm = (scenarioId: string, rate: number, createdAt: string, lender: string | null = null): RefiBenchmark => ({ id: `${scenarioId}-${createdAt}`, scenarioId, benchmarkDate: createdAt.slice(0, 10), rate, pointsOrCredit: 0, lender, createdAt })
const run = (status: RefiRun['status'], createdAt: string): RefiRun => ({ id: createdAt, runDate: createdAt.slice(0, 10), kind: 'scheduled', status, actedAt: null, createdAt })

describe('labels', () => {
  it('names scenarios the way the table shows them', () => {
    expect(scenarioLabel({ program: 'conventional', purpose: 'rate_term', fico: 720, ltv: 90 })).toBe('Conv R/T 720 · 90%')
    expect(scenarioLabel({ program: 'fha', purpose: 'rate_term', fico: 640, ltv: 97.5 })).toBe('FHA R/T 640 · 97.5%')
    expect(scenarioLabel({ program: 'fha', purpose: 'streamline', fico: 640, ltv: null })).toBe('FHA Streamline 640')
  })
  it('formats LTV and points (negative = credit)', () => {
    expect(formatLtv(80)).toBe('80%')
    expect(formatPoints(0.125)).toBe('0.125 pts')
    expect(formatPoints(-0.25)).toBe('0.250 credit')
    expect(formatPoints(0)).toBe('0.000')
  })
})

describe('orderScenarios', () => {
  it('lists active ones in their set order', () => {
    const s = [
      { name: 'B', fico: 660, sortOrder: 2, active: true },
      { name: 'A', fico: 720, sortOrder: 1, active: true },
      { name: 'Off', fico: 700, sortOrder: 0, active: false },
    ]
    expect(orderScenarios(s).map((x) => x.name)).toEqual(['A', 'B'])
    expect(orderScenarios(s, false).map((x) => x.name)).toEqual(['Off', 'A', 'B'])
  })
})

describe('latestByScenario', () => {
  it('keeps the newest price per scenario', () => {
    const latest = latestByScenario([bm('a', 6.5, '2026-11-02T14:00:00Z'), bm('a', 6.375, '2026-11-04T14:00:00Z'), bm('b', 6.0, '2026-11-02T14:00:00Z')])
    expect(latest.get('a')?.rate).toBe(6.375)
    expect(latest.get('b')?.rate).toBe(6.0)
    expect(latest.get('c')).toBeUndefined()
  })
})

describe('runs', () => {
  it('finds the open run', () => {
    expect(openRun([run('saved', '2026-11-02'), run('open', '2026-11-04')])?.createdAt).toBe('2026-11-04')
    expect(openRun([run('saved', '2026-11-02')])).toBeNull()
  })
  it('is stale after a skip or a missed run, until the next save', () => {
    expect(pricingIsStale([])).toBe(false)
    expect(pricingIsStale([run('saved', '2026-11-02')])).toBe(false)
    expect(pricingIsStale([run('saved', '2026-11-02'), run('skipped', '2026-11-04')])).toBe(true)
    expect(pricingIsStale([run('saved', '2026-11-02'), run('missed', '2026-11-04'), run('open', '2026-11-06')])).toBe(true)
    expect(pricingIsStale([run('skipped', '2026-11-02'), run('saved', '2026-11-04')])).toBe(false)
  })
  it('an open run on its own does not make pricing stale', () => {
    expect(pricingIsStale([run('saved', '2026-11-04'), run('open', '2026-11-06')])).toBe(false)
  })
})

describe('drafts', () => {
  it('checks each row', () => {
    expect(draftError({ scenarioId: 'a', rate: null, pointsOrCredit: null, lender: '' })).toBeNull()
    expect(draftError({ scenarioId: 'a', rate: null, pointsOrCredit: 0.5, lender: '' })).toMatch(/Enter a rate/)
    expect(draftError({ scenarioId: 'a', rate: 25, pointsOrCredit: null, lender: '' })).toMatch(/between 0% and 20%/)
    expect(draftError({ scenarioId: 'a', rate: 6.25, pointsOrCredit: -11, lender: '' })).toMatch(/Points/)
    expect(draftError({ scenarioId: 'a', rate: 6.25, pointsOrCredit: -0.25, lender: 'X' })).toBeNull()
  })
  it('sends only priced rows, with blanks filled', () => {
    const drafts = [
      { scenarioId: 'a', rate: 6.375, pointsOrCredit: null, lender: ' Lender A ' },
      { scenarioId: 'b', rate: null, pointsOrCredit: null, lender: 'Lender B' },
      { scenarioId: 'c', rate: 5.99, pointsOrCredit: -0.25, lender: '' },
    ]
    expect(pricedCount(drafts)).toBe(2)
    expect(saveRows(drafts)).toEqual([
      { scenario_id: 'a', rate: 6.375, points_or_credit: 0, lender: 'Lender A' },
      { scenario_id: 'c', rate: 5.99, points_or_credit: -0.25, lender: null },
    ])
  })
  it('starts each row blank with the last lender', () => {
    const latest = latestByScenario([bm('a', 6.5, '2026-11-02T14:00:00Z', 'Lender A')])
    expect(blankDrafts([{ id: 'a' }, { id: 'b' }], latest)).toEqual([
      { scenarioId: 'a', rate: null, pointsOrCredit: null, lender: 'Lender A' },
      { scenarioId: 'b', rate: null, pointsOrCredit: null, lender: '' },
    ])
  })
})

describe('scenarioError', () => {
  const ok = { name: 'Conventional R/T', program: 'conventional' as const, purpose: 'rate_term' as const, fico: 720, ltv: 90 }
  it('accepts a good scenario and an FHA streamline with no LTV', () => {
    expect(scenarioError(ok)).toBeNull()
    expect(scenarioError({ ...ok, program: 'fha', purpose: 'streamline', ltv: null })).toBeNull()
  })
  it('catches the problems', () => {
    expect(scenarioError({ ...ok, name: ' ' })).toMatch(/name/)
    expect(scenarioError({ ...ok, fico: 900 })).toMatch(/FICO/)
    expect(scenarioError({ ...ok, purpose: 'streamline' })).toMatch(/Only FHA/)
    expect(scenarioError({ ...ok, ltv: null })).toMatch(/LTV/)
  })
})
