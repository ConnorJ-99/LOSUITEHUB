// The FHFA House Price Index for MyHome's home value estimate (closed view
// Step B, docs/plans/myhome.md section 5): which series, and how to read
// FHFA's master file and FRED's backup. Pure, with no imports, so the
// hpi-refresh function (Deno) and the tests share it.

/** FHFA's metro divisions (place_id) for DFW: Dallas-Plano-Irving and Fort Worth-Arlington-Grapevine. */
export const SERIES = { dallas: '19124', fortWorth: '23104' } as const
export type SeriesId = (typeof SERIES)[keyof typeof SERIES]
export const SERIES_IDS: SeriesId[] = [SERIES.dallas, SERIES.fortWorth]

/** FHFA's master file and FRED's copies of the same all-transactions series. */
export const FHFA_URL = 'https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv'
export const fredUrl = (series: SeriesId) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=ATNHPIUS${series}Q`

export interface IndexRow {
  series: SeriesId
  year: number
  quarter: number
  index: number
}

/** One CSV line into its fields (place names hold commas inside quotes). */
export function csvFields(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** Cheap test before parsing: only lines naming one of our two places can matter. */
export const mightMatter = (line: string) => SERIES_IDS.some((s) => line.includes(`,${s},`))

/**
 * A row of FHFA's master file (hpi_type, hpi_flavor, frequency, level,
 * place_name, place_id, yr, period, index_nsa, …) when it is one of our two
 * places' quarterly all-transactions numbers; else null.
 */
export function fhfaRow(line: string): IndexRow | null {
  const f = csvFields(line.replace(/\r$/, ''))
  if (f.length < 9) return null
  const [type, flavor, frequency, , , placeId, yr, period, nsa] = f
  if (type !== 'traditional' || flavor !== 'all-transactions' || frequency !== 'quarterly') return null
  if (!(SERIES_IDS as string[]).includes(placeId)) return null
  const year = Number(yr)
  const quarter = Number(period)
  const index = Number(nsa)
  if (!Number.isInteger(year) || !Number.isInteger(quarter) || quarter < 1 || quarter > 4 || !(index > 0)) return null
  return { series: placeId as SeriesId, year, quarter, index }
}

/** FRED's CSV ("observation_date,ATNHPIUS19124Q" then "2026-04-01,426.45"; "." = no value). */
export function fredRows(text: string, series: SeriesId): IndexRow[] {
  const out: IndexRow[] = []
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [date, value] = line.split(',')
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date?.trim() ?? '')
    const index = Number(value)
    if (!m || !(index > 0)) continue
    out.push({ series, year: Number(m[1]), quarter: Math.floor((Number(m[2]) - 1) / 3) + 1, index })
  }
  return out
}

/** "2026 Q2" for the latest quarter in a set of rows, or null. */
export function latestLabel(rows: IndexRow[]): string | null {
  const last = rows.reduce<IndexRow | null>((a, r) => (!a || r.year * 4 + r.quarter > a.year * 4 + a.quarter ? r : a), null)
  return last ? `${last.year} Q${last.quarter}` : null
}

/** A source is good enough only when it has recent quarters for both places. */
export function complete(rows: IndexRow[]): boolean {
  return SERIES_IDS.every((s) => rows.filter((r) => r.series === s).length >= 8)
}
