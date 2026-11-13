import { describe, expect, it } from 'vitest'
import { findQuote } from './findQuote'

// A pay stub's text items as pdfjs gives them (one per cell, sometimes split).
const items = ['Regular Pay', '38.680000', '$850.96', '$33,419.76', 'Period End Date', '10/24/2026', 'Pay Rate', '$22.0000']

describe('finding a quote on the page', () => {
  it('ignores case, spaces, $ and commas', () => {
    expect(findQuote(items, 'regular pay 38.680000')).toEqual({ first: 0, last: 1, by: 'quote' })
    expect(findQuote(items, 'Period End Date 10/24/2026')).toEqual({ first: 4, last: 5, by: 'quote' })
  })
  it('a quote split across items is found', () => {
    expect(findQuote(['YTD Gr', 'oss 41,250', '.00'], 'YTD Gross 41,250.00')).toEqual({ first: 0, last: 2, by: 'quote' })
  })
  it('falls back to the value when the quote is not on the page', () => {
    expect(findQuote(items, 'YTD regular 33,419.76', 33419.76)).toEqual({ first: 3, last: 3, by: 'value' })
    expect(findQuote(items, 'Rate 22', 22)).toEqual({ first: 6, last: 7, by: 'quote' })
    expect(findQuote(items, 'Hourly 22', 22)).toEqual({ first: 7, last: 7, by: 'value' })
  })
  it('nothing found (a scan, or a quote that is not there)', () => {
    expect(findQuote([], 'Regular Pay')).toBeNull()
    expect(findQuote(items, 'Overtime 500', 500)).toBeNull()
  })
})
