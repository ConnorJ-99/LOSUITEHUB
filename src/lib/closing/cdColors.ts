// The final CD's group colors: each group borrows an AI Fill section color, so
// the two readers look alike.
import { SECTION_DOT, SECTION_HL } from '@/lib/aifill/sections'
import type { FillSection } from '@/lib/aifill/plan'
import type { CdGroup } from './cdReview'

const GROUP_COLOR: Record<CdGroup, FillSection> = { loan: 'loan', dates: 'borrower', payment: 'income', credits: 'liabilities' }

/** The dot before a group's name (Tailwind classes). */
export const cdDot = (g: CdGroup) => SECTION_DOT[GROUP_COLOR[g]]
/** The highlight behind a figure's words while it plays (Tailwind classes). */
export const cdHighlight = (g: CdGroup) => SECTION_HL[GROUP_COLOR[g]]
