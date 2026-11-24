import { describe, expect, it } from 'vitest'
import { assetColumns } from './borrowerAssets'

describe('assetColumns', () => {
  const reported = [{ balance: 2100.55 }, { balance: 900 }]
  const verified = [
    { assetType: 'checking', amount: 1200, useAs: 'down_payment' },
    { assetType: 'savings', amount: 800.25, useAs: 'down_payment' },
    { assetType: 'gift_cash', amount: 5000, useAs: 'down_payment' },
    { assetType: 'gift_equity', amount: 10000, useAs: 'down_payment' },
    { assetType: 'retirement', amount: 40000, useAs: 'depletion' },
    { assetType: 'stocks', amount: null, useAs: 'reserves' },
  ]
  it('adds the borrower-reported accounts', () => expect(assetColumns(reported, []).reported).toBe(3000.55))
  it('shows every 1003 asset as verified', () => expect(assetColumns(reported, verified).verified).toBe(57000.25))
  it('counts what Max Approval counts: own funds and gifts, no gift of equity or depletion-only', () => {
    const c = assetColumns(reported, verified)
    expect(c.eligibleOwn).toBe(2000.25)
    expect(c.eligibleGift).toBe(5000)
    expect(c.eligible).toBe(7000.25)
  })
  it('shows the gap between reported and the 1003', () => expect(assetColumns(reported, verified.slice(0, 2)).gap).toBe(1000.3))
  it('is all zeros with nothing', () => expect(assetColumns([], [])).toEqual({ reported: 0, verified: 0, eligibleOwn: 0, eligibleGift: 0, eligible: 0, gap: 0 }))
})
