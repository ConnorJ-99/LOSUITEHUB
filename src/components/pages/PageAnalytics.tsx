// Analytics for one page (Pages Phase 3): views, submissions and conversion
// for the last 30 days, a bar chart of each (two charts, one scale each), and
// where submissions came from. Math in src/lib/pages/analytics.ts.
import { useState } from 'react'
import { Card } from '@/components/shared'
import { usePageViewDays } from '@/lib/api/pagesPhase3'
import type { PageSubmission } from '@/lib/api/pages'
import { pageAnalytics, type DayCount } from '@/lib/pages/analytics'
import { todayIso } from '@/lib/dates'

const shortDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-soft">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

/** One series, one scale: a bar per day, the day's count on hover. */
function DayBars({ days, pick, title, unit }: { days: DayCount[]; pick: (d: DayCount) => number; title: string; unit: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const values = days.map(pick)
  const max = Math.max(1, ...values)
  const w = 600
  const h = 110
  const slot = w / days.length
  const bar = Math.max(2, slot - 2)
  const shown = hover ?? values.length - 1
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {shortDay(days[shown].day)} · {values[shown]} {values[shown] === 1 ? unit : `${unit}s`}
        </p>
      </div>
      <svg viewBox={`0 0 ${w} ${h + 16}`} className="h-32 w-full" role="img" aria-label={`${title}, last 30 days`} onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={w} y1={h} y2={h} stroke="var(--border)" strokeWidth={1} />
        <text x={0} y={10} className="fill-muted-foreground" fontSize={10}>
          {max}
        </text>
        {values.map((v, i) => {
          const bh = v === 0 ? 0 : Math.max(3, (v / max) * (h - 16))
          return (
            <g key={days[i].day} onMouseEnter={() => setHover(i)}>
              {/* A tall, invisible target so a thin bar is easy to point at. */}
              <rect x={i * slot} y={0} width={slot} height={h} fill="transparent" />
              {bh > 0 && <rect x={i * slot + 1} y={h - bh} width={bar} height={bh} rx={2} fill="var(--primary)" opacity={hover === null || hover === i ? 1 : 0.45} />}
            </g>
          )
        })}
        <text x={0} y={h + 13} className="fill-muted-foreground" fontSize={10}>
          {shortDay(days[0].day)}
        </text>
        <text x={w} y={h + 13} textAnchor="end" className="fill-muted-foreground" fontSize={10}>
          Today
        </text>
      </svg>
    </div>
  )
}

export function PageAnalytics({ pageId, viewCountAll, submissions }: { pageId: string; viewCountAll: number; submissions: PageSubmission[] }) {
  const views = usePageViewDays(pageId)
  const a = pageAnalytics({ today: todayIso(), viewDays: views.data ?? [], viewCountAll, submissions })
  return (
    <Card title="Analytics" description="Last 30 days, Central time. Views are counted per visit to the page; nothing about visitors is kept." className="mb-5">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Views · 30 days" value={a.views30.toLocaleString('en-US')} sub={`${a.viewsAll.toLocaleString('en-US')} all time`} />
          <Tile label="Submissions · 30 days" value={String(a.submissions30)} sub={`${a.submissionsAll} all time`} />
          <Tile label="Conversion" value={a.conversionPct === null ? '—' : `${a.conversionPct}%`} sub="submissions ÷ views" />
          <Tile label="Top source" value={a.sources[0]?.source ?? '—'} sub={a.sources[0] ? `${a.sources[0].submissions} submission${a.sources[0].submissions === 1 ? '' : 's'}` : undefined} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <DayBars days={a.days} pick={(d) => d.views} title="Views per day" unit="view" />
          <DayBars days={a.days} pick={(d) => d.submissions} title="Submissions per day" unit="submission" />
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Submissions by source</p>
          {a.sources.length ? (
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {a.sources.map((s) => (
                  <tr key={s.source}>
                    <td className="py-1.5">{s.source}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.submissions}</td>
                    <td className="w-1/3 py-1.5 pl-3">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${(s.submissions / a.sources[0].submissions) * 100}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No submissions yet. Add ?utm_source=facebook (or instagram, flyer…) to a link you share to see where people come from.</p>
          )}
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-primary">Show the numbers by day</summary>
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1">Day</th>
                <th className="py-1 text-right">Views</th>
                <th className="py-1 text-right">Submissions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...a.days].reverse().map((d) => (
                <tr key={d.day}>
                  <td className="py-1">{shortDay(d.day)}</td>
                  <td className="py-1 text-right tabular-nums">{d.views}</td>
                  <td className="py-1 text-right tabular-nums">{d.submissions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </Card>
  )
}
