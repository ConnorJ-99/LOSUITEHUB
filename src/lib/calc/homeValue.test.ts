import { describe, expect, it } from 'vitest'
import { homeValue, indexEstimate, quarterOf } from './homeValue'

const basis = { base: 350_000, baseIndex: 300, latestIndex: 353.14, loadedOn: '2026-08-26' }

describe('home value estimate', () => {
  it('grows the starting value by the index, to the nearest $1,000', () => {
    // 350,000 × 353.14 / 300 = 411,996.67 → 412,000
    expect(indexEstimate(basis)).toBe(412_000)
    expect(indexEstimate({ ...basis, latestIndex: 300 })).toBe(350_000)
    expect(indexEstimate({ ...basis, baseIndex: 0 })).toBe(0)
  })
  it("shows the index estimate with the gain, unless Connor's figure is as new", () => {
    expect(homeValue(null, basis)).toEqual({ amount: 412_000, by: 'index', base: 350_000, gain: 62_000 })
    expect(homeValue({ amount: 420_000, on: '2026-09-01' }, basis)).toEqual({ amount: 420_000, by: 'connor', on: '2026-09-01' })
    expect(homeValue({ amount: 420_000, on: '2026-08-26' }, basis)).toEqual({ amount: 420_000, by: 'connor', on: '2026-08-26' })
    expect(homeValue({ amount: 420_000, on: '2026-01-15' }, basis)?.by).toBe('index')
    // A figure with no date: the index wins when there is one, else Connor's shows.
    expect(homeValue({ amount: 420_000, on: null }, basis)?.by).toBe('index')
    expect(homeValue({ amount: 420_000, on: null }, null)).toEqual({ amount: 420_000, by: 'connor', on: null })
    expect(homeValue(null, null)).toBeNull()
  })
  it('finds the quarter a date falls in', () => {
    expect(quarterOf('2021-03-19')).toEqual({ year: 2021, quarter: 1 })
    expect(quarterOf('2021-04-01')).toEqual({ year: 2021, quarter: 2 })
    expect(quarterOf('2025-12-31')).toEqual({ year: 2025, quarter: 4 })
  })
})
