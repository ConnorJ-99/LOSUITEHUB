import { describe, expect, it } from 'vitest'
import { assetDepletionIncome, fundsByUse, reservesAfterClosing, saleProceeds, type UsableAsset } from './assets'

const assets: UsableAsset[] = [
  { assetType: 'checking', amount: 40_000, useAs: 'down_payment' },
  { assetType: 'retirement', amount: 220_000, useAs: 'depletion' },
  { assetType: 'savings', amount: 10_000, useAs: 'reserves' },
  { assetType: 'savings', amount: null, useAs: 'down_payment' },
]

describe('savings by use', () => {
  it('splits accounts by how they are used', () => {
    expect(fundsByUse(assets)).toEqual({ downPayment: 40_000, reserves: 10_000, depletion: 220_000 })
  })

  it('counts retirement at 70% over 360 months for depletion income', () => {
    expect(assetDepletionIncome(assets)).toBe(427.78) // 220,000 × 70% ÷ 360
    expect(assetDepletionIncome([{ assetType: 'stocks', amount: 36_000, useAs: 'depletion' }])).toBe(100)
  })
})

describe('sale proceeds', () => {
  it('takes off selling costs and the mortgages', () => {
    expect(saleProceeds(400_000, [250_000])).toBe(118_000) // 400k − 32k − 250k
    expect(saleProceeds(400_000, [250_000], 6)).toBe(126_000)
    expect(saleProceeds(300_000, [290_000])).toBe(-14_000)
  })
})

describe('reserves', () => {
  it('adds leftover closing funds to reserve accounts, in months of payment', () => {
    expect(reservesAfterClosing(40_000, 32_000, 10_000, 3_000)).toEqual({ amount: 18_000, months: 6 })
    expect(reservesAfterClosing(20_000, 32_000, 0, 3_000)).toEqual({ amount: 0, months: 0 })
    expect(reservesAfterClosing(20_000, 0, 0, null).months).toBeNull()
  })
})
