import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRightIcon, CalendarDaysIcon, KanbanIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared'
import { ApplicationLinkButton } from '@/components/applications/ApplicationLinkButton'
import { useNewLead } from '@/components/leads/new-lead-context'
import { LeadCard } from '@/components/pipeline/LeadCard'
import { SearchBox, TypeChips } from '@/components/pipeline/PipelineParts'
import { useBoardFiles, type BoardFile } from '@/lib/api/board'
import { todayIso } from '@/lib/dates'
import { formatCompactCurrency } from '@/lib/format'
import { boardStats, cardType, matchesSearch, sortCards } from '@/lib/pipeline/card'
import type { LeadTypeId } from '@/lib/pipeline/leadType'
import { matchesLoanNumber } from '@/lib/loans/numbers'
import { BOARDS, pipelineFor, pipelineInfo } from '@/lib/pipeline/pipelines'

/** Cards shown per stage on the overview; the rest are "+N more" (the board has them all). */
const PER_STAGE = 4
const isActive = (f: BoardFile) => f.stage !== 'closed' && f.stage !== 'lost' && f.stage !== 'nurture'

/**
 * The pipeline overview (Connor, 2026-11-13): full width. Totals, search and
 * the lead-type chips at the top; Priority and On hold strips; one section per
 * pipeline with its stage columns (4 cards each, then "+N more" to the board);
 * Closed and Nurture tiles at the bottom.
 */
export function PipelineOverviewPage() {
  const { files, loading, error } = useBoardFiles()
  const { openNewLead } = useNewLead()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<LeadTypeId | null>(null)
  const [now] = useState(() => new Date())
  const today = todayIso()

  const all = useMemo(() => files ?? [], [files])
  const shown = useMemo(() => all.filter((f) => (!type || cardType(f) === type) && (matchesSearch(search, [f.name, f.address]) || matchesLoanNumber(search, f.loanNumbers))), [all, type, search])
  const active = shown.filter(isActive)
  const totals = boardStats(active, now, today)

  if (loading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading the pipeline…</p>
  if (error) return <EmptyState title="The pipeline could not load" description={error.message} />

  const priority = sortCards(active.filter((f) => f.priority && !f.onHoldAt))
  const onHold = active.filter((f) => f.onHoldAt).sort((a, b) => a.onHoldAt!.localeCompare(b.onHoldAt!))
  const count = (id: 'closed' | 'nurture' | 'lost') => shown.filter((f) => f.stage === id).length

  return (
    <div className="flex flex-col gap-4 text-[#111827]">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
          <p className="text-[13px] text-[#374151]">
            <strong>{totals.count}</strong> active files · <strong>{formatCompactCurrency(totals.volume)}</strong> volume · <strong>{totals.closingThisMonth}</strong> closing this month
          </p>
        </div>
        <span className="flex-1" />
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, address, loan #, GF #" />
        <Button variant="outline" asChild>
          <Link to="/pipeline/closings">
            <CalendarDaysIcon />
            Closings
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/pipeline/all">
            <KanbanIcon />
            All loans
          </Link>
        </Button>
        <ApplicationLinkButton />
        <Button onClick={() => openNewLead()}>
          <PlusIcon />
          New lead
        </Button>
      </div>

      <TypeChips files={all.filter(isActive)} value={type} onChange={setType} />

      {/* Priority and On hold */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Strip title="Priority" files={priority} now={now} empty="Star a file to keep it here." />
        <Strip title="On hold" files={onHold} now={now} empty="No files on hold." />
      </div>

      {/* One section per pipeline */}
      {BOARDS.map((id) => {
        const info = pipelineInfo(id)
        const mine = active.filter((f) => pipelineFor(f) === id)
        const s = boardStats(mine, now, today)
        return (
          <section key={id} className="rounded-xl border border-[#e3e8ef] bg-white p-3" aria-labelledby={`pl-${id}`}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id={`pl-${id}`} className="text-lg font-bold">
                {info.label}
              </h2>
              <span className="text-[13px] text-[#374151]">
                <strong>{s.count}</strong> active · <strong>{formatCompactCurrency(s.volume)}</strong> · <strong>{s.closingThisMonth}</strong> closing this month
              </span>
              <span className="flex-1" />
              <Link to={`/pipeline/${id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                Open board <ArrowRightIcon className="size-4" />
              </Link>
            </div>
            <div className="overflow-x-auto pb-1">
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${info.columns.length}, minmax(190px, 1fr))` }}>
                {info.columns.map((c) => {
                  const here = sortCards(mine.filter((f) => c.stages.includes(f.stage)))
                  return (
                    <div key={c.id} className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-[#eaeef3] p-2">
                      <div className="flex items-baseline justify-between px-1">
                        <span className="text-[13px] font-bold">{c.label}</span>
                        <span className="rounded-full bg-white px-2 text-xs font-semibold text-[#374151]">{here.length}</span>
                      </div>
                      {here.length === 0 && <p className="px-1 py-2 text-xs text-[#5b6472]">No files</p>}
                      {here.slice(0, PER_STAGE).map((f) => (
                        <LeadCard key={f.id} file={f} now={now} mini />
                      ))}
                      {here.length > PER_STAGE && (
                        <Link to={`/pipeline/${id}?stage=${c.id}`} className="px-1 text-xs font-semibold text-primary hover:underline">
                          +{here.length - PER_STAGE} more
                        </Link>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        )
      })}

      {/* Closed and Nurture keep their own pages */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile to="/contacts?tab=closed" label="Closed" n={count('closed')} hint="Closed loans and production" />
        <Tile to="/pipeline/nurture" label="Nurture" n={count('nurture')} hint="Not ready yet; keep in touch" />
        <Tile to="/pipeline/lost" label="Lost" n={count('lost')} hint="Files marked lost, with the reason" />
      </div>
    </div>
  )
}

function Strip({ title, files, now, empty }: { title: string; files: BoardFile[]; now: Date; empty: string }) {
  return (
    <section className="rounded-xl border border-[#e3e8ef] bg-white p-3" aria-label={title}>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-bold">{title}</h2>
        <span className="rounded-full bg-[#eaeef3] px-2 text-xs font-semibold text-[#374151]">{files.length}</span>
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-[#5b6472]">{empty}</p>
      ) : (
        <div className="grid max-h-[340px] gap-2 overflow-y-auto pr-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {files.map((f) => (
            <LeadCard key={f.id} file={f} now={now} mini />
          ))}
        </div>
      )}
    </section>
  )
}

function Tile({ to, label, n, hint }: { to: string; label: string; n: number; hint: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-xl border border-[#e3e8ef] bg-white p-3 hover:border-primary/40">
      <span className="text-2xl font-bold tabular-nums">{n}</span>
      <span className="min-w-0">
        <span className="block font-semibold">{label}</span>
        <span className="block truncate text-xs text-[#5b6472]">{hint}</span>
      </span>
      <ArrowRightIcon className="ml-auto size-4 text-[#5b6472]" />
    </Link>
  )
}
