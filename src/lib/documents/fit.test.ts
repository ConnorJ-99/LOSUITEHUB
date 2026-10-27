import { describe, expect, it } from 'vitest'
import { fitScales, fitToOnePage } from './fit'

describe('one page, always', () => {
  it('shrinks in 3% steps down to 82%', () => {
    expect(fitScales()).toEqual([1, 0.97, 0.94, 0.91, 0.88, 0.85, 0.82])
  })
  it('keeps full size when it fits', async () => {
    const tried: number[] = []
    const r = await fitToOnePage(async (s) => (tried.push(s), s), async () => 1)
    expect(r).toEqual({ ok: true, file: 1, scale: 1 })
    expect(tried).toEqual([1])
  })
  it('uses the first scale that fits', async () => {
    const r = await fitToOnePage(async (s) => s, async (s) => (s > 0.9 ? 2 : 1))
    expect(r).toEqual({ ok: true, file: 0.88, scale: 0.88 })
  })
  it('blocks the export when 82% is still two pages', async () => {
    expect(await fitToOnePage(async (s) => s, async () => 2)).toEqual({ ok: false, pages: 2 })
  })
})
