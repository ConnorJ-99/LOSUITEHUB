// The Nurture dashboard (Connor, 2026-11-16; plan docs/plans/buyer-nurture.md
// Step 9): how many buyers are preparing, what's holding them back, plans and
// milestones, how often they answer check-ins, who moved on (and funded), and
// who needs you or is getting close. A loan officer sees their own files; the
// Admin login sees every file. Read only; the math is src/lib/nurture/dashboard.ts.
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Card, EmptyState, PageHeader, Select } from '@/components/shared'
import { RESPONSE_DAYS, RESPONSE_WINDOW_DAYS, useNurtureDashboardData } from '@/lib/api/nurtureDashboard'
import { todayIso } from '@/lib/dates'
import { nurtureDashboard, type NurtureDashboard } from '@/lib/nurture/dashboard'
import { NURTURE_STAGES, OBSTACLE_GROUPS } from '@/lib/nurture/obstacles'

const ALL = 'all'
const GROUP_LABEL = new Map(OBSTACLE_GROUPS.map((g) => [g.id as string, g.label]))
const pct = (v: number | null) => (v == null ? '—' : `${v}%`)

const TILES: { label: string; value: (d: NurtureDashboard) => string; sub: (d: NurtureDashboard) => string | null; help: string }[] = [
  { label: 'In Nurture now', value: (d) => String(d.active), sub: (d) => (d.avgDaysNow == null ? null : `${d.avgDaysNow} days on average so far`), help: 'Files in the Nurture pipeline today' },
  { label: 'Plans approved', value: (d) => String(d.plansApproved), sub: (d) => `${d.plansDelivered} roadmap${d.plansDelivered === 1 ? '' : 's'} delivered`, help: 'Files in Nurture with an approved Buyer Readiness Plan, and how many have had the roadmap sent' },
  { label: 'Milestones outstanding', value: (d) => String(d.milestonesOutstanding), sub: (d) => (d.milestonesOverdue ? `${d.milestonesOverdue} overdue` : 'None overdue'), help: 'Not yet marked done on approved plans' },
  { label: 'Response rate', value: (d) => pct(d.responsePct), sub: (d) => (d.checkInsSent ? `${d.checkInsAnswered} of ${d.checkInsSent} check-ins answered` : 'No check-ins sent yet'), help: `Nurture check-ins sent in the last ${RESPONSE_WINDOW_DAYS} days that got a reply within ${RESPONSE_DAYS} days` },
  { label: 'Ready to reassess', value: (d) => String(d.readyToReassess), sub: (d) => `${d.reassessAsks} review request${d.reassessAsks === 1 ? '' : 's'} sent (90 days)`, help: 'Every plan milestone done; and review requests sent from the queue' },
  { label: 'Moved on to a loan', value: (d) => String(d.toActive), sub: (d) => (d.leftNurture ? `${pct(d.toActivePct)} of the ${d.leftNurture} that left Nurture` : null), help: 'Files that left Nurture for an active stage (not Lost), all time' },
  { label: 'Funded', value: (d) => String(d.funded), sub: (d) => (d.leftNurture ? `${pct(d.fundedPct)} of the ${d.leftNurture} that left Nurture` : null), help: 'Files that left Nurture and are now Closed' },
  { label: 'Time to move on', value: (d) => (d.avgDaysToLeave == null ? '—' : `${d.avgDaysToLeave} days`), sub: () => 'Average time in Nurture before leaving', help: 'From the move into Nurture to the move out, for files that left' },
]

function Bars({ rows, total }: { rows: { key: string; label: string; n: number }[]; total: number }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">None yet.</p>
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate">{r.label}</span>
            <span className="tabular-nums text-muted-foreground">{r.n}</span>
          </div>
          <div className="mt-0.5 h-1.5 rounded bg-muted">
            <div className="h-1.5 rounded bg-[#2E8B6A]" style={{ width: `${total ? Math.max(4, Math.round((r.n / total) * 100)) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function NurtureDashboardPage() {
  const navigate = useNavigate()
  const data = useNurtureDashboardData()
  const [lo, setLo] = useState<string>(ALL)
  const today = todayIso()
  const d = useMemo(() => (data.data ? nurtureDashboard({ ...data.data, today, loId: lo === ALL ? null : lo }) : null), [data.data, today, lo])
  const names = data.data?.names ?? []

  return (
    <>
      <Link to="/pipeline/nurture" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        Nurture board
      </Link>
      <PageHeader eyebrow="Nurture" title="Nurture dashboard" description="Buyers preparing for homeownership: where they stand, what’s holding them back, and who needs you." />
      {data.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !d ? (
        <EmptyState title="Not ready yet" description="The dashboard turns on once the nurture database scripts have run." />
      ) : (
        <div className="space-y-4">
          {names.length > 1 && (
            <div className="max-w-xs">
              <Select label="Loan officer" value={lo} options={[{ value: ALL, label: 'Everyone I can see' }, ...[...names].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))]} onChange={(v) => setLo(v ?? ALL)} />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {TILES.map((t) => (
              <Card key={t.label} className="p-0">
                <div className="p-4" title={t.help}>
                  <p className="text-xs font-medium text-muted-foreground">{t.label}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{t.value(d)}</p>
                  {t.sub(d) && <p className="mt-0.5 text-xs text-muted-foreground">{t.sub(d)}</p>}
                </div>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="What’s holding them back" description="Files per obstacle area (a file can count in more than one)">
              <Bars rows={d.byGroup.map(([key, n]) => ({ key, label: GROUP_LABEL.get(key) ?? key, n }))} total={d.active} />
            </Card>
            <Card title="Most common obstacles">
              <Bars rows={d.topObstacles.map((o) => ({ key: o.key, label: o.label, n: o.n }))} total={d.active} />
            </Card>
            <Card title="By nurture stage">
              <Bars rows={NURTURE_STAGES.filter((s) => d.byStage.get(s.id)).map((s) => ({ key: s.id, label: s.label, n: d.byStage.get(s.id)! }))} total={d.active} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Needs attention" description="Updates to verify, overdue milestones and follow-ups, and files still without a plan after a week">
              {d.attention.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing waiting on you.</p>
              ) : (
                <ul className="divide-y">
                  {d.attention.slice(0, 15).map((a) => (
                    <li key={a.loanId}>
                      <button type="button" onClick={() => navigate(`/loans/${a.loanId}`)} className="flex w-full items-center gap-2 py-2 text-left hover:bg-muted/40">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{a.borrower}</span>
                          <span className="block text-xs text-[#b4372c]">{a.reasons.join(' · ')}</span>
                        </span>
                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {d.attention.length > 15 && <p className="mt-2 text-xs text-muted-foreground">and {d.attention.length - 15} more</p>}
            </Card>
            <Card title="Getting close" description="Ready to reassess, or at least 3 in 4 plan milestones done">
              {d.close.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one is close yet.</p>
              ) : (
                <ul className="divide-y">
                  {d.close.map((c) => (
                    <li key={c.loanId}>
                      <button type="button" onClick={() => navigate(`/loans/${c.loanId}`)} className="flex w-full items-center gap-2 py-2 text-left hover:bg-muted/40">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{c.borrower}</span>
                          <span className="block text-xs text-[#1f6b51]">
                            {c.why}
                            {c.total > 0 && c.why.startsWith('Ready') && ` · ${c.done} of ${c.total} milestones done`}
                          </span>
                        </span>
                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
