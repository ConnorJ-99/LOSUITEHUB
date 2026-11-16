// The Nurture board (Connor, 2026-11-16; plan docs/plans/buyer-nurture.md
// Step 3): every file in Nurture, one column per nurture stage, with filters
// for obstacle, loan officer, realtor and overdue follow-ups. Each loan
// officer sees their own files; the Admin login sees all (the file rule).
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { cn } from 'cn'
import { Card, EmptyState, PageHeader, SearchInput, Select, ToggleChip } from '@/components/shared'
import { usePipeline } from '@/lib/api/loans'
import { useNurtureBoard, type NurtureBoardRow } from '@/lib/api/nurture'
import type { PipelineLoan } from '@/lib/api/types'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { daysInNurture, followUpOverdue, NURTURE_STAGES, OBSTACLE_GROUPS, obstacleLabel } from '@/lib/nurture/obstacles'

interface Item {
  loan: PipelineLoan
  n: NurtureBoardRow
  name: string
}

function NurtureCard({ item, now, today }: { item: Item; now: Date; today: string }) {
  const navigate = useNavigate()
  const { n, loan } = item
  const days = daysInNurture(n.enteredAt, now)
  const overdue = followUpOverdue(n.nextFollowUp, today)
  return (
    <button type="button" onClick={() => navigate(`/loans/${loan.id}`)} className="w-full rounded-[10px] border border-[#dfe4ea] bg-white px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(16,24,40,.04)] hover:border-primary/40">
      <p className="truncate text-[15px] font-bold">{item.name}</p>
      {n.obstacles.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {n.obstacles.slice(0, 2).map((o) => (
            <span key={o} className="max-w-full truncate rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
              {obstacleLabel(o)}
            </span>
          ))}
          {n.obstacles.length > 2 && <span className="text-[11px] text-muted-foreground">+{n.obstacles.length - 2}</span>}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 text-xs text-[#4b5563]">
        <span>{days !== null ? `${days}d in Nurture` : ''}</span>
        {n.target && <span>Target: {n.target}</span>}
      </div>
      <p className={cn('mt-1 text-xs', overdue ? 'font-semibold text-[#b4372c]' : 'text-[#4b5563]')}>{n.nextFollowUp ? `Follow up ${formatIsoDate(n.nextFollowUp)}${overdue ? ' (overdue)' : ''}` : 'No follow-up date'}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {[loan.assignedLo?.name, n.realtors[0] && `Realtor: ${n.realtors[0]}`].filter(Boolean).join(' · ')}
      </p>
    </button>
  )
}

export function NurtureBoardPage() {
  const pipeline = usePipeline()
  const board = useNurtureBoard()
  const [search, setSearch] = useState('')
  const [obstacle, setObstacle] = useState<string | null>(null)
  const [lo, setLo] = useState<string | null>(null)
  const [realtor, setRealtor] = useState<string | null>(null)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [now] = useState(() => new Date())
  const today = todayIso()

  const items: Item[] = useMemo(() => {
    if (!pipeline.data || !board.data) return []
    return pipeline.data.flatMap((loan) => {
      const n = board.data!.get(loan.id)
      if (loan.stage !== 'nurture' || !n) return []
      return [{ loan, n, name: loan.borrower ? `${loan.borrower.firstName} ${loan.borrower.lastName}`.trim() : 'No borrower' }]
    })
  }, [pipeline.data, board.data])

  const los = [...new Map(items.flatMap((i) => (i.loan.assignedLo ? [[i.loan.assignedLo.id, i.loan.assignedLo.name] as const] : []))).entries()]
  const realtors = [...new Set(items.flatMap((i) => i.n.realtors))].sort()
  const q = search.trim().toLowerCase()
  const shown = items.filter(
    (i) =>
      (!q || i.name.toLowerCase().includes(q)) &&
      (!obstacle || i.n.obstacles.includes(obstacle) || (obstacle === 'custom' && i.n.obstacles.some((o) => o.startsWith('custom:')))) &&
      (!lo || i.loan.assignedLo?.id === lo) &&
      (!realtor || i.n.realtors.includes(realtor)) &&
      (!overdueOnly || followUpOverdue(i.n.nextFollowUp, today)),
  )
  const obstacleOptions = [...OBSTACLE_GROUPS.flatMap((g) => g.items.map((x) => ({ value: x.key, label: `${g.label}: ${x.label}` }))), { value: 'custom', label: 'Other: typed in' }]

  return (
    <>
      <Link to="/pipeline" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        Leads
      </Link>
      <PageHeader title="Nurture" description={`Buyers preparing for homeownership${items.length ? ` · ${items.length} file${items.length === 1 ? '' : 's'}` : ''}`} />

      {(pipeline.isLoading || board.isLoading) && <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}
      {board.data === null && (
        <Card>
          <p className="text-sm text-destructive">The nurture board turns on once the nurture database script has run.</p>
        </Card>
      )}

      {board.data && (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <div className="w-56">
              <SearchInput value={search} onChange={setSearch} placeholder="Search by name" />
            </div>
            <div className="w-64">
              <Select label="Obstacle" value={obstacle ?? ''} options={obstacleOptions} onChange={(v) => setObstacle(v || null)} placeholder="Any obstacle" />
            </div>
            {los.length > 1 && (
              <div className="w-48">
                <Select label="Loan officer" value={lo ?? ''} options={los.map(([value, label]) => ({ value, label }))} onChange={(v) => setLo(v || null)} placeholder="Anyone" />
              </div>
            )}
            {realtors.length > 0 && (
              <div className="w-48">
                <Select label="Realtor" value={realtor ?? ''} options={realtors.map((r) => ({ value: r, label: r }))} onChange={(v) => setRealtor(v || null)} placeholder="Any realtor" />
              </div>
            )}
            <ToggleChip label="Follow-up overdue" pressed={overdueOnly} onChange={setOverdueOnly} />
          </div>

          {items.length === 0 ? (
            <Card>
              <EmptyState title="No one in Nurture" description="Use Move to Nurture on a file when a buyer isn't mortgage-ready yet." />
            </Card>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-3">
              {NURTURE_STAGES.map((s) => {
                const here = shown.filter((i) => (i.n.stage ?? 'initial_review') === s.id)
                return (
                  <section key={s.id} className="flex w-64 shrink-0 flex-col rounded-xl bg-[#eef1f5] p-2">
                    <h2 className="mb-2 flex items-baseline justify-between px-1 text-sm font-semibold">
                      <span className="truncate">{s.label}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{here.length}</span>
                    </h2>
                    <div className="space-y-2">
                      {here.map((i) => (
                        <NurtureCard key={i.loan.id} item={i} now={now} today={today} />
                      ))}
                      {here.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">None</p>}
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </>
      )}
    </>
  )
}
