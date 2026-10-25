import { describe, expect, it } from 'vitest'
import { toSnake } from './urla'

describe('field to column names', () => {
  it('converts camelCase to the database column names', () => {
    expect(toSnake('monthsAtAddress')).toBe('months_at_address')
    expect(toSnake('deedInLieuPast7Years')).toBe('deed_in_lieu_past_7_years')
    expect(toSnake('bankruptcyChapter13')).toBe('bankruptcy_chapter_13')
    expect(toSnake('ownership25OrMore')).toBe('ownership_25_or_more')
    expect(toSnake('militaryServiceExpiresOn')).toBe('military_service_expires_on')
    expect(toSnake('raceOtherPacificIslanderText')).toBe('race_other_pacific_islander_text')
  })

  it('uses overrides where the simple rule would be wrong', () => {
    expect(toSnake('accountLast4')).toBe('account_last4')
  })
})
