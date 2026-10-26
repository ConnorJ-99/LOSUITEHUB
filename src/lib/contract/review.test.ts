import { describe, expect, it } from 'vitest'
import type { ExtractedField } from '../../../supabase/functions/assistant/contract'
import { details as testLoanDetails } from '@/lib/mismo/testFixture'
import { buildReview, defaultDecisions, reviewChanges, reviewRecord, type FileNow } from './review'

const f = (key: ExtractedField['key'], value: ExtractedField['value'], confidence: ExtractedField['confidence'] = 'high'): ExtractedField => ({ key, value, text: String(value), quote: `quote for ${key}`, page: 1, confidence })

const now: FileNow = {
  details: { ...testLoanDetails, purchasePrice: 307000, contractDate: null, closingDate: '2026-11-07', optionEndDate: null, sellerCredits: null, mortgageType: 'conventional' },
  earnestMoney: null,
  propertyAddress: '88 Test Owned Ct, Dallas, TX 75201',
}

const fields = [
  f('sales_price', 307000),
  f('effective_date', '2026-10-25'),
  f('closing_date', '2026-11-20', 'low'),
  f('earnest_money', 3000),
  f('option_period_days', 7),
  f('survey_days', 10),
  f('seller_concessions', 6000),
  f('financing_type', 'fha'),
  f('hoa_addendum', true),
  f('property_address', '88 Test Owned Court, Dallas, Texas'),
]

describe('contract review', () => {
  it('shows what each term would change, working out deadlines from the effective date', () => {
    const rows = buildReview(fields, now, defaultDecisions(fields, now))
    const row = (k: string) => rows.find((r) => r.key === k)!
    expect(row('sales_price')).toMatchObject({ same: true, proposedLabel: '$307,000', currentLabel: '$307,000' })
    expect(row('option_period_days')).toMatchObject({ proposed: '2026-11-01', proposedLabel: 'Nov 1, 2026', note: '7 days after the effective date (Oct 25, 2026)' })
    expect(row('survey_days').proposed).toBe('2026-11-04')
    expect(row('financing_type')).toMatchObject({ proposedLabel: 'FHA', currentLabel: 'Conventional', same: false })
    expect(row('hoa_addendum').proposedLabel).toBe('Yes')
    expect(row('property_address')).toMatchObject({ applicable: false, same: true })
  })

  it('starts with every change picked except low-confidence ones and ones already on file', () => {
    const d = defaultDecisions(fields, now)
    expect(d.sales_price?.use).toBe(false) // already the same
    expect(d.closing_date?.use).toBe(false) // low confidence
    expect(d.effective_date?.use).toBe(true)
    expect(d.property_address?.use).toBe(false) // only compared
  })

  it('without the effective date, deadlines wait (from the file or the reading)', () => {
    const d = { ...defaultDecisions(fields, now), effective_date: { use: false } }
    const rows = buildReview(fields, now, d)
    expect(rows.find((r) => r.key === 'option_period_days')).toMatchObject({ proposed: null, applicable: false, note: 'Needs the effective date to work out the deadline.' })
    const withFileDate = buildReview(fields, { ...now, details: { ...now.details, contractDate: '2026-10-20' } }, d)
    expect(withFileDate.find((r) => r.key === 'option_period_days')?.proposed).toBe('2026-10-27')
  })

  it('saves only the picked changes, with edits, to the right places', () => {
    const d = { ...defaultDecisions(fields, now), seller_concessions: { use: true, edited: 5000 }, financing_type: { use: false } }
    const rows = buildReview(fields, now, d)
    expect(reviewChanges(rows, d)).toEqual({
      details: { contractDate: '2026-10-25', optionEndDate: '2026-11-01', surveyDeadline: '2026-11-04', sellerCredits: 5000, hasHoaAddendum: true },
      earnestMoney: 3000,
    })
    const record = reviewRecord(rows, d)
    expect(record.outcome).toBe('edited')
    expect(record.fields.find((x) => x.key === 'seller_concessions')).toMatchObject({ decision: 'edited', final: 5000, value: 6000 })
    expect(record.fields.find((x) => x.key === 'financing_type')).toMatchObject({ decision: 'skipped', final: null })
    expect(record.fields.find((x) => x.key === 'effective_date')).toMatchObject({ decision: 'accepted', final: '2026-10-25' })
  })
})
