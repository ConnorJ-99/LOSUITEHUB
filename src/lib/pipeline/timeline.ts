// Timeline: when the borrower wants to buy or refinance (Pipeline v2 card
// dropdown). It lives in loans.timeline, which call notes and web leads also
// fill in their own words; those stay as typed and show as "Other". Pure.

export const TIMELINE_OPTIONS = ['ASAP', '1 month', '2 months', '3 months', '3–6 months', '6+ months', 'Just looking'] as const
export type TimelineOption = (typeof TIMELINE_OPTIONS)[number]

const ALIASES: Record<string, TimelineOption> = {
  asap: 'ASAP',
  now: 'ASAP',
  immediately: 'ASAP',
  'right away': 'ASAP',
  '30 days': '1 month',
  '1 month': '1 month',
  'one month': '1 month',
  '60 days': '2 months',
  '2 months': '2 months',
  'two months': '2 months',
  '90 days': '3 months',
  '3 months': '3 months',
  'three months': '3 months',
  '3-6 months': '3–6 months',
  '3 to 6 months': '3–6 months',
  '6+ months': '6+ months',
  '6 months+': '6+ months',
  'over 6 months': '6+ months',
  'just looking': 'Just looking',
  browsing: 'Just looking',
}

const loose = (text: string) => text.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()

/** Which dropdown option a saved timeline is, or "other" for words typed elsewhere (e.g. "after the lease ends"). */
export function timelineChoice(saved: string | null): TimelineOption | 'other' | null {
  if (!saved || !saved.trim()) return null
  const exact = TIMELINE_OPTIONS.find((o) => loose(o) === loose(saved))
  return exact ?? ALIASES[loose(saved)] ?? 'other'
}
