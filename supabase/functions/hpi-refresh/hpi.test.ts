import { describe, expect, it } from 'vitest'
import { complete, csvFields, fhfaRow, fredRows, fredUrl, latestLabel, mightMatter, type IndexRow } from './hpi'

const line = (flavor: string, placeId: string, yr: string, period: string, nsa: string, frequency = 'quarterly') =>
  `traditional,${flavor},${frequency},MSA,"Dallas-Plano-Irving, TX (MSAD)",${placeId},${yr},${period},${nsa},,0.5,`

describe('reading the FHFA master file', () => {
  it('splits quoted place names', () => {
    expect(csvFields('a,"Dallas-Plano-Irving, TX (MSAD)",19124')).toEqual(['a', 'Dallas-Plano-Irving, TX (MSAD)', '19124'])
    expect(csvFields('"say ""hi""",2')).toEqual(['say "hi"', '2'])
  })
  it('keeps our two places, all-transactions, quarterly', () => {
    expect(fhfaRow(line('all-transactions', '19124', '2026', '2', '426.45'))).toEqual({ series: '19124', year: 2026, quarter: 2, index: 426.45 })
    expect(fhfaRow(line('all-transactions', '23104', '2026', '2', '400.37\r'))).toEqual({ series: '23104', year: 2026, quarter: 2, index: 400.37 })
    expect(fhfaRow(line('purchase-only', '19124', '2026', '2', '300'))).toBeNull()
    expect(fhfaRow(line('all-transactions', '19124', '2026', '5', '300', 'monthly'))).toBeNull()
    expect(fhfaRow(line('all-transactions', '12345', '2026', '2', '300'))).toBeNull()
    expect(fhfaRow(line('all-transactions', '19124', '2026', '2', ''))).toBeNull()
    expect(fhfaRow('hpi_type,hpi_flavor')).toBeNull()
  })
  it('skips lines that cannot matter before parsing', () => {
    expect(mightMatter(line('all-transactions', '19124', '2026', '2', '1'))).toBe(true)
    expect(mightMatter('traditional,all-transactions,quarterly,MSA,"Austin, TX",12420,2026,2,1')).toBe(false)
  })
})

describe('reading FRED', () => {
  it('turns dates into quarters and skips blanks', () => {
    expect(fredUrl('19124')).toBe('https://fred.stlouisfed.org/graph/fredgraph.csv?id=ATNHPIUS19124Q')
    const rows = fredRows('observation_date,ATNHPIUS19124Q\n2026-01-01,420.10\r\n2026-04-01,426.45\n2026-07-01,.\n', '19124')
    expect(rows).toEqual([
      { series: '19124', year: 2026, quarter: 1, index: 420.1 },
      { series: '19124', year: 2026, quarter: 2, index: 426.45 },
    ])
  })
})

describe('checking a source', () => {
  const quarters = (series: IndexRow['series'], n: number) => Array.from({ length: n }, (_, i) => ({ series, year: 2020 + Math.floor(i / 4), quarter: (i % 4) + 1, index: 300 + i }))
  it('names the latest quarter', () => {
    expect(latestLabel(quarters('19124', 10))).toBe('2022 Q2')
    expect(latestLabel([])).toBeNull()
  })
  it('needs both places', () => {
    expect(complete([...quarters('19124', 8), ...quarters('23104', 8)])).toBe(true)
    expect(complete(quarters('19124', 40))).toBe(false)
  })
})
