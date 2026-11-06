import { describe, expect, it } from 'vitest'
import type { FeeTemplate } from '@/lib/calc'
import { monthlyPrincipalAndInterest } from '@/lib/calc'
import { blankProperty, estimatedHousing, financingFigures, openHouseSlugBase, openHouseTag, openHouseWhen, readProperty, refigure, type OpenHouseProperty } from './openHouse'

const fee = (key: string, amount: number): FeeTemplate => ({ key, section: 'B', name: key, amountType: 'fixed', amount, purposes: null, mortgageTypes: null, paidBy: 'B', apr: false, paidTo: null, sortOrder: 10, active: true })
const templates = [fee('appraisal', 650), fee('title', 2000)]

const home = (): OpenHouseProperty => ({
  ...blankProperty(),
  address: '4218 Fairway Bend Dr',
  cityLine: 'Frisco, TX 75034',
  listPrice: 485000,
  taxesMonthly: 849,
  hoaMonthly: 75,
  insuranceMonthly: 180,
})

describe('open house financing', () => {
  it('needs a price and a rate', () => {
    const p = home()
    expect(financingFigures(p, p.financing[0], templates)).toBeNull()
    expect(financingFigures({ ...p, listPrice: null }, { ...p.financing[0], ratePct: 6.5 }, templates)).toBeNull()
  })

  it('conventional 5% down: P&I plus taxes, insurance, HOA and MI; cash = down + costs', () => {
    const p = home()
    const f = financingFigures(p, { ...p.financing[0], ratePct: 6.5 }, templates)!
    expect(f.downPayment).toBe(24250)
    expect(f.baseLoanAmount).toBe(460750)
    expect(f.principalAndInterest).toBeCloseTo(monthlyPrincipalAndInterest(460750, 6.5, 360), 1)
    expect(f.mortgageInsurance).toBeGreaterThan(0)
    expect(f.monthlyPayment).toBeCloseTo(f.principalAndInterest + 849 + 180 + 75 + f.mortgageInsurance, 0)
    expect(f.cashToClose).toBeGreaterThan(f.downPayment + 2650)
  })

  it('FHA and VA finance their upfront fee; VA has no down payment', () => {
    const p = refigure(
      { ...home(), financing: home().financing.map((o) => ({ ...o, ratePct: o.key === 'fha' ? 6.125 : o.key === 'va' ? 6 : null })) },
      templates,
    )
    const fha = p.financing.find((o) => o.key === 'fha')!.figures!
    const va = p.financing.find((o) => o.key === 'va')!.figures!
    expect(fha.downPayment).toBe(16975)
    expect(fha.loanAmount).toBeGreaterThan(fha.baseLoanAmount)
    expect(va.downPayment).toBe(0)
    expect(va.loanAmount).toBeGreaterThan(485000)
    expect(p.financing.find((o) => o.key === 'conventional')!.figures).toBeNull()
  })

  it('estimates taxes and insurance from the price', () => {
    expect(estimatedHousing(485000)).toEqual({ taxesMonthly: 889.17, insuranceMonthly: 300 })
  })
})

describe('open house details', () => {
  it('when', () => {
    expect(openHouseWhen({ openDate: '2026-11-14', startTime: '13:00', endTime: '16:00' })).toBe('Sat, Nov 14 · 1:00–4:00 PM')
    expect(openHouseWhen({ openDate: '2026-11-14', startTime: '11:00', endTime: '14:00' })).toBe('Sat, Nov 14 · 11:00 AM–2:00 PM')
    expect(openHouseWhen({ openDate: null, startTime: '13:00', endTime: null })).toBeNull()
  })
  it('tag and web address', () => {
    expect(openHouseTag('4218 Fairway Bend Dr')).toBe('Open House – 4218 Fairway Bend Dr')
    expect(openHouseSlugBase('4218 Fairway Bend Dr, Frisco')).toBe('4218-fairway-bend-dr-frisco')
  })
  it('reads older saves', () => {
    const p = readProperty({ address: 'x', financing: [{ key: 'fha', ratePct: 6 }] })
    expect(p.financing).toHaveLength(4)
    expect(p.financing.find((o) => o.key === 'fha')!.ratePct).toBe(6)
    expect(p.photos).toEqual([])
  })
})
