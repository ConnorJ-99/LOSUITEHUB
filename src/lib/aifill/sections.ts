// The section names and colors AI Fill uses for its tags, cards and (step 3)
// highlights. Names are the 1003's own (URLA_SECTIONS); colors follow the
// AI Summary Fill mockup.

import { URLA_SECTIONS } from '@/lib/loanfile/urla'
import type { FillSection } from './plan'

export const SECTION_NAME = (s: FillSection) => URLA_SECTIONS.find((x) => x.id === s)?.label ?? s

/** A dot color per section (Tailwind classes). */
export const SECTION_DOT: Record<FillSection, string> = {
  borrower: 'bg-blue-500',
  credit: 'bg-indigo-500',
  income: 'bg-emerald-600',
  assets: 'bg-teal-500',
  liabilities: 'bg-amber-500',
  reo: 'bg-pink-500',
  loan: 'bg-violet-500',
  property: 'bg-violet-500',
  declarations: 'bg-gray-400',
}

/** The highlight behind a fact's words in the notes while it's read (Tailwind classes). */
export const SECTION_HL: Record<FillSection, string> = {
  borrower: 'bg-blue-500/25 shadow-[inset_0_-2px_0_rgb(59_130_246)]',
  credit: 'bg-indigo-500/25 shadow-[inset_0_-2px_0_rgb(99_102_241)]',
  income: 'bg-emerald-600/25 shadow-[inset_0_-2px_0_rgb(5_150_105)]',
  assets: 'bg-teal-500/25 shadow-[inset_0_-2px_0_rgb(20_184_166)]',
  liabilities: 'bg-amber-500/30 shadow-[inset_0_-2px_0_rgb(245_158_11)]',
  reo: 'bg-pink-500/25 shadow-[inset_0_-2px_0_rgb(236_72_153)]',
  loan: 'bg-violet-500/25 shadow-[inset_0_-2px_0_rgb(139_92_246)]',
  property: 'bg-violet-500/25 shadow-[inset_0_-2px_0_rgb(139_92_246)]',
  declarations: 'bg-gray-400/30 shadow-[inset_0_-2px_0_rgb(156_163_175)]',
}

/** Where a quote sits in the notes (ignoring case and spacing), or null. */
export function findQuote(notes: string, quote: string): [number, number] | null {
  const words = quote.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’‘]/g, "['’‘]")).join('\\s+'), 'i')
  const m = re.exec(notes)
  return m ? [m.index, m.index + m[0].length] : null
}

/** The notes cut into plain and highlighted pieces; overlapping quotes keep the first. */
export function highlightPieces(notes: string, marks: { range: [number, number]; section: FillSection }[]): { text: string; section: FillSection | null }[] {
  const sorted = [...marks].sort((a, b) => a.range[0] - b.range[0])
  const out: { text: string; section: FillSection | null }[] = []
  let at = 0
  for (const m of sorted) {
    const [s, e] = m.range
    if (s < at) continue
    if (s > at) out.push({ text: notes.slice(at, s), section: null })
    out.push({ text: notes.slice(s, e), section: m.section })
    at = e
  }
  if (at < notes.length) out.push({ text: notes.slice(at), section: null })
  return out
}

/** The 1003 section nav group each section lands in (UrlaSectionNav's ids). */
export const NAV_GROUP: Record<FillSection, string> = {
  borrower: 'section-1',
  credit: 'section-1',
  income: 'section-1',
  assets: 'section-2',
  liabilities: 'section-2',
  reo: 'section-3',
  loan: 'section-4',
  property: 'section-4',
  declarations: 'section-5',
}
