import { describe, expect, it } from 'vitest'
import { blankProperty, type OpenHouseProperty } from '@/lib/pages/openHouse'
import { flyerFileName, flyerHeadline, flyerProblems, flyerView } from './openHouseFlyer'

const home = (): OpenHouseProperty => {
  const p = { ...blankProperty(), address: '4218 Fairway Bend Dr', cityLine: 'Frisco, TX 75034', listPrice: 485000, beds: 4, baths: 3, sqft: 2640, taxesMonthly: 849, insuranceMonthly: 180, hoaMonthly: 75, openDate: '2026-11-14', ratesAsOf: '2026-11-06' }
  p.financing = p.financing.map((o) =>
    o.key === 'conventional'
      ? { ...o, ratePct: 6.5, figures: { downPayment: 24250, baseLoanAmount: 460750, loanAmount: 460750, monthlyPayment: 4170.4, principalAndInterest: 2912, mortgageInsurance: 192, closingCosts: 11500, cashToClose: 35750 } }
      : o,
  )
  return p
}

const input = (p = home()) => ({ property: p, url: 'https://app.mps.mortgage/p/4218-fairway-bend', hero: null, lo: { name: 'Connor Jacquart', nmls: '2611188', phone: '2145550100', email: 'connor@mps.mortgage', photo: null }, agent: null, company: null })

describe('open house flyer', () => {
  it('headline from the open house time', () => {
    expect(flyerHeadline({ openDate: '2026-11-14', startTime: '13:00', endTime: '16:00' })).toBe('Saturday 1–4 PM')
    expect(flyerHeadline({ openDate: '2026-11-15', startTime: '11:00', endTime: '14:30' })).toBe('Sunday 11 AM–2:30 PM')
    expect(flyerHeadline({ openDate: null, startTime: null, endTime: null })).toBe('Open house')
  })

  it('lays out the mockup lines from saved data', () => {
    const v = flyerView(input())
    expect(v.dateLine).toBe('November 14 · 4218 Fairway Bend Dr, Frisco')
    expect(v.details).toBe('4 beds · 3 baths · 2,640 sq ft')
    expect(v.price).toBe('$485,000')
    expect(v.rows).toEqual([{ program: 'Conventional', down: '5% · $24,250', rate: '6.500%', cashToClose: '$35,750', payment: '$4,170' }])
    expect(v.costsNote).toBe('Payments include principal & interest, taxes ($849), insurance ($180), HOA ($75) and mortgage insurance where required. 30-year fixed.')
    expect(v.lo.line).toBe('Loan Officer · NMLS #2611188')
    expect(v.lo.phone).toBe('(214) 555-0100')
    expect(v.disclaimer).toContain('NMLS #2501110 · Equal Housing Opportunity')
    expect(v.disclaimer).toContain('Sample rates as of Nov 6, 2026')
    expect(v.disclaimer).toContain('not a commitment to lend')
    expect(v.disclaimer).toContain('deemed reliable but not guaranteed')
  })

  it('only programs that are shown and figured', () => {
    const p = home()
    p.financing = p.financing.map((o) => ({ ...o, show: o.key !== 'conventional' ? o.show : false }))
    expect(flyerView(input(p)).rows).toEqual([])
  })

  it('blocks until it can be printed', () => {
    expect(flyerProblems({ published: true, property: home(), loNmls: '2611188' })).toEqual([])
    const blank = flyerProblems({ published: false, property: blankProperty(), loNmls: null })
    expect(blank).toHaveLength(5)
  })

  it('file name', () => {
    expect(flyerFileName('4218 Fairway Bend Dr')).toBe('open-house-4218-fairway-bend-dr.pdf')
  })
})
