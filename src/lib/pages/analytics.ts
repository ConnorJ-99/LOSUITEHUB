// Page analytics (Pages Phase 3): views and submissions for the last 30 days,
// conversion, and where submissions came from. Views are counted per day in
// page_view_days (no visitor details); submissions are page_submissions.
// Pure.

export interface DayCount {
  /** YYYY-MM-DD (Central time). */
  day: string
  views: number
  submissions: number
}

export interface SourceCount {
  source: string
  submissions: number
}

export interface PageAnalytics {
  days: DayCount[]
  views30: number
  submissions30: number
  /** Submissions ÷ views over the 30 days, as a percent; null with no views. */
  conversionPct: number | null
  viewsAll: number
  submissionsAll: number
  sources: SourceCount[]
}

/** The last n days ending today, oldest first. */
export function lastDays(today: string, n = 30): string[] {
  const end = new Date(`${today}T12:00:00Z`)
  return Array.from({ length: n }, (_, i) => new Date(end.getTime() - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10))
}

/** Central-time day of a timestamp. */
export const centralDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(iso))

/** Where one submission came from: a personal link, its UTM source, the site that linked to it, or Direct. */
export function sourceOf(s: { outcome: string; source: Record<string, string> }): string {
  if (s.outcome === 'personal_link') return 'Personal link'
  if (s.source.utm_source) return s.source.utm_campaign ? `${s.source.utm_source} · ${s.source.utm_campaign}` : s.source.utm_source
  if (s.source.referrer) {
    try {
      return new URL(s.source.referrer).hostname.replace(/^www\./, '')
    } catch {
      return 'Link'
    }
  }
  return 'Direct'
}

export function pageAnalytics(input: { today: string; viewDays: { day: string; views: number }[]; viewCountAll: number; submissions: { createdAt: string; outcome: string; source: Record<string, string> }[] }): PageAnalytics {
  const days = lastDays(input.today)
  const inRange = new Set(days)
  const subs30 = input.submissions.filter((s) => inRange.has(centralDay(s.createdAt)))
  const counted: DayCount[] = days.map((day) => ({
    day,
    views: input.viewDays.filter((v) => v.day === day).reduce((a, v) => a + v.views, 0),
    submissions: subs30.filter((s) => centralDay(s.createdAt) === day).length,
  }))
  const views30 = counted.reduce((a, d) => a + d.views, 0)
  const bySource = new Map<string, number>()
  for (const s of input.submissions) bySource.set(sourceOf(s), (bySource.get(sourceOf(s)) ?? 0) + 1)
  return {
    days: counted,
    views30,
    submissions30: subs30.length,
    conversionPct: views30 > 0 ? Math.round((subs30.length / views30) * 1000) / 10 : null,
    // Never below the 30-day count (signed-in visits before 2026-11-07 only reached the daily count).
    viewsAll: Math.max(input.viewCountAll, views30),
    submissionsAll: input.submissions.length,
    sources: [...bySource.entries()].map(([source, submissions]) => ({ source, submissions })).sort((a, b) => b.submissions - a.submissions || a.source.localeCompare(b.source)),
  }
}
