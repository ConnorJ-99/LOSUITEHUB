// One lender's page (mockup 09): the products table, the header metrics and
// the last matrix update's changes. Pure.

import { formatCompactCurrency } from '@/lib/format'
import { BROWSE_GROUP_LABEL, browseGroup, programSummary, type BrowseGroup } from './browse'
import { offerTags, type OfferTag } from './lenderSummary'
import { diffCells, type CellChange } from './matrixImport'
import { OCCUPANCIES } from './taxonomy'
import type { CatalogProgram, MatrixCell } from './types'

export interface ProductRow {
  program: CatalogProgram
  group: BrowseGroup
  tags: OfferTag[]
  minFico: number | null
  maxRatio: number | null
  ratio: 'LTV' | 'CLTV'
  /** "$100K–$3.0M", "Up to $500K", "$150K+", or null with no matrix. */
  loanRange: string | null
  /** "Investment", "Primary, 2nd home", or "All". */
  occupancy: string | null
}

const OCC_SHORT = { primary: 'Primary', second_home: '2nd home', investment: 'Investment' } as const

/** A program's row in the lender's products table, from its approved matrix. */
export function productRow(p: CatalogProgram): ProductRow {
  const s = programSummary(p)
  const offered = p.cells.filter((c) => c.offered)
  const min = offered.length ? Math.min(...offered.map((c) => c.loanAmountMin)) : null
  const loanRange = offered.length === 0 ? null : s.maxLoan == null ? (min ? `${formatCompactCurrency(min)}+` : 'Any amount') : min ? `${formatCompactCurrency(min)}–${formatCompactCurrency(s.maxLoan)}` : `Up to ${formatCompactCurrency(s.maxLoan)}`
  const occ = OCCUPANCIES.values.filter((o) => offered.some((c) => c.occupancy === o))
  return {
    program: p,
    group: browseGroup(p),
    tags: offerTags(p),
    minFico: s.minFico,
    maxRatio: s.maxRatio,
    ratio: s.ratio,
    loanRange,
    occupancy: occ.length === 0 ? null : occ.length === OCCUPANCIES.values.length ? 'All' : occ.map((o) => OCC_SHORT[o]).join(', '),
  }
}

/** The products table: rows grouped by product type (browse order), names A–Z within a group. */
export function groupProducts(rows: ProductRow[]): { group: BrowseGroup; label: string; rows: ProductRow[] }[] {
  const order = Object.keys(BROWSE_GROUP_LABEL) as BrowseGroup[]
  return order
    .map((group) => ({ group, label: BROWSE_GROUP_LABEL[group], rows: rows.filter((r) => r.group === group).sort((a, b) => a.program.name.localeCompare(b.program.name)) }))
    .filter((g) => g.rows.length > 0)
}

/** "Licensed in TX, OK, FL, GA and 18 more" (or every state when there are four or fewer). */
export function licensedLine(states: string[] | null, show = 4): string | null {
  if (!states?.length) return null
  return states.length <= show ? `Licensed in ${states.join(', ')}` : `Licensed in ${states.slice(0, show).join(', ')} and ${states.length - show} more`
}

/** Average days from application to closing over your closed files with this lender; null when there are none. */
export function averageDaysToClose(files: { applicationOn: string | null; closedOn: string | null }[]): number | null {
  const days = files.flatMap((f) => (f.applicationOn && f.closedOn ? [(Date.parse(`${f.closedOn}T12:00:00`) - Date.parse(`${f.applicationOn}T12:00:00`)) / 86_400_000] : [])).filter((d) => d >= 0)
  return days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null
}

export interface ProgramVersions {
  programName: string
  /** The approved version in use. */
  current: { version: number; approvedAt: string | null; cells: MatrixCell[] }
  /** The version it replaced; null when this is the program's first. */
  previous: { version: number; cells: MatrixCell[] } | null
}

export interface MatrixUpdate {
  /** When the newest approval happened. */
  approvedAt: string | null
  /** Changed limits, prefixed with the program ("DSCR · Investment · …: 75% → 70%"); new programs separately. */
  changes: (CellChange & { programName: string; direction: 'up' | 'down' | 'new' | 'dropped' })[]
  newPrograms: string[]
}

/**
 * What the lender's last matrix update changed: for programs approved in the
 * newest update, every limit that moved against the version it replaced, and
 * programs that had no earlier version.
 */
export function lastMatrixUpdate(programs: ProgramVersions[]): MatrixUpdate | null {
  if (programs.length === 0) return null
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
  const newest = programs.reduce((m, p) => (day(p.current.approvedAt) > m ? day(p.current.approvedAt) : m), '')
  const latest = programs.filter((p) => day(p.current.approvedAt) === newest)
  const changes = latest.flatMap((p) =>
    p.previous
      ? diffCells(p.previous.cells, p.current.cells).map((c) => ({
          ...c,
          programName: p.programName,
          direction: c.from === undefined || c.from === null ? ('new' as const) : c.to === undefined || c.to === null ? ('dropped' as const) : (c.to as number) > (c.from as number) ? ('up' as const) : ('down' as const),
        }))
      : [],
  )
  return { approvedAt: latest[0]?.current.approvedAt ?? null, changes, newPrograms: latest.filter((p) => !p.previous).map((p) => p.programName) }
}

