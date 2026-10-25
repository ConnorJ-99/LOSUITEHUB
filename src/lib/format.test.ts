import { describe, expect, it } from 'vitest'
import { formatCurrency } from './format'

describe('formatCurrency', () => {
  it('shows whole dollars without cents and cents with two digits', () => {
    expect(formatCurrency(1250)).toBe('$1,250')
    expect(formatCurrency(1905.3)).toBe('$1,905.30')
    expect(formatCurrency(-250.5)).toBe('-$250.50')
    expect(formatCurrency(null)).toBe('—')
  })
})
