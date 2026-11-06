import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { InfoIcon, LockIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, confirmAction, EmptyState, Input, NumberInput, PageHeader, PercentInput } from '@/components/shared'
import { useRefiBenchmarks, useRefiRuns, useRefiScenarios, useSaveBenchmarks, useSkipBenchmarkRun } from '@/lib/api/refiWatch'
import { useAuth } from '@/lib/auth/context'
import { formatIsoDate } from '@/lib/dates'
import { blankDrafts, draftError, formatLtv, formatPoints, latestByScenario, openRun, orderScenarios, pricedCount, pricingIsStale, type BenchmarkDraft, type RefiBenchmark, type RefiScenario } from '@/lib/refi/benchmarks'

/** Desktop: one table row per scenario under a header row. Phone: each scenario stacks with its own labels. */
const ROW_GRID = 'grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1.6fr)_3.5rem_4rem_7.5rem_7.5rem_minmax(0,1.3fr)_7.5rem] md:items-center'

function LastPriced({ last }: { last: RefiBenchmark | undefined }) {
  if (!last) return <span className="text-muted-foreground">Not priced yet</span>
  return (
    <span className="tabular-nums">
      {last.rate.toFixed(3)}% · {formatPoints(last.pointsOrCredit)}
      <span className="block text-muted-foreground">{formatIsoDate(last.benchmarkDate)}</span>
    </span>
  )
}

function ScenarioRow({ scenario: s, draft, last, onChange }: { scenario: RefiScenario; draft: BenchmarkDraft; last: RefiBenchmark | undefined; onChange: (d: BenchmarkDraft) => void }) {
  const error = draftError(draft)
  return (
    <li className="py-3">
      <div className={ROW_GRID}>
        <div className="col-span-2 min-w-0 md:col-span-1">
          <p className="text-sm font-medium">{s.name}</p>
          {s.mipRemoval && <span className="mt-0.5 inline-block rounded-md bg-nurture/10 px-1.5 py-0.5 text-xs font-semibold text-nurture">MIP removal</span>}
          {/* On a phone FICO and LTV sit under the name. */}
          <p className="text-xs text-muted-foreground tabular-nums md:hidden">
            FICO {s.fico} · LTV {s.ltv != null ? formatLtv(s.ltv) : '—'}
          </p>
        </div>
        <span className="hidden text-sm tabular-nums md:block">{s.fico}</span>
        <span className="hidden text-sm tabular-nums md:block">{s.ltv != null ? formatLtv(s.ltv) : '—'}</span>
        <div className="md:[&_label]:sr-only">
          <PercentInput label="Rate" value={draft.rate} onChange={(rate) => onChange({ ...draft, rate })} placeholder="Enter rate" />
        </div>
        <div className="md:[&_label]:sr-only">
          <NumberInput label="Points / credit" value={draft.pointsOrCredit} onChange={(pointsOrCredit) => onChange({ ...draft, pointsOrCredit })} maxDecimals={3} placeholder="0.000" />
        </div>
        <div className="col-span-2 md:col-span-1 md:[&_label]:sr-only">
          <Input label="Lender" value={draft.lender} onChange={(lender) => onChange({ ...draft, lender })} placeholder="Lender" />
        </div>
        <div className="col-span-2 text-xs md:col-span-1">
          <span className="text-muted-foreground md:hidden">Last priced: </span>
          <LastPriced last={last} />
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  )
}

/** The Mon/Wed/Fri admin task: price each active scenario, then save (screening runs) or skip. */
export function RefiBenchmarksPage() {
  const { state } = useAuth()
  const navigate = useNavigate()
  const scenarios = useRefiScenarios()
  const benchmarks = useRefiBenchmarks()
  const runs = useRefiRuns()
  const save = useSaveBenchmarks()
  const skip = useSkipBenchmarkRun()
  const [drafts, setDrafts] = useState<BenchmarkDraft[] | null>(null)

  const role = state.status === 'signedIn' ? state.user.role : null
  if (state.status === 'preview') {
    return (
      <>
        <PageHeader title="Price refi benchmarks" />
        <EmptyState icon={InfoIcon} title="Preview mode" description="Connect Supabase to price benchmarks." />
      </>
    )
  }
  if (role !== 'owner' && role !== 'admin') {
    return (
      <>
        <PageHeader title="Price refi benchmarks" />
        <Card>
          <EmptyState icon={LockIcon} title="Owners and admins only" description="An admin prices the refi benchmarks on Mondays, Wednesdays and Fridays." />
        </Card>
      </>
    )
  }

  const loading = scenarios.isLoading || benchmarks.isLoading || runs.isLoading
  const error = scenarios.error ?? benchmarks.error ?? runs.error
  const active = orderScenarios(scenarios.data ?? [])
  const latest = latestByScenario(benchmarks.data ?? [])
  const rows = drafts ?? blankDrafts(active, latest)
  const waiting = openRun(runs.data ?? [])
  const stale = pricingIsStale(runs.data ?? [])
  const priced = pricedCount(rows)
  const hasErrors = rows.some((d) => draftError(d) !== null)
  const busy = save.isPending || skip.isPending

  const setRow = (d: BenchmarkDraft) => setDrafts(rows.map((r) => (r.scenarioId === d.scenarioId ? d : r)))

  const onSave = () => {
    save.mutate(rows, {
      onSuccess: () => {
        toast.success(`Saved ${priced} benchmark${priced === 1 ? '' : 's'}`)
        setDrafts(null)
        navigate('/')
      },
      onError: (e) => toast.error(e.message),
    })
  }

  const onSkip = async () => {
    if (!(await confirmAction('Skip this run? Screening keeps using the last saved prices, and alerts show "Stale pricing" until the next save.', { confirmLabel: 'Skip this run' }))) return
    skip.mutate(undefined, {
      onSuccess: () => {
        toast.success('Run skipped')
        setDrafts(null)
        navigate('/')
      },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <>
      <PageHeader
        eyebrow={waiting ? `Admin task · ${formatIsoDate(waiting.runDate)}` : 'Refi Watch'}
        title="Price refi benchmarks"
        description="Price each scenario in your lender's pricing and enter the rate. Saving runs Refi Watch screening across every closed loan."
      />
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : active.length === 0 ? (
        <Card>
          <EmptyState icon={InfoIcon} title="No scenarios to price" description="Add or turn on a scenario in Settings › Refi Watch." action={<Button variant="outline" asChild><Link to="/settings#refi-watch">Open Settings</Link></Button>} />
        </Card>
      ) : (
        <div className="space-y-4">
          {stale && (
            <p className="flex items-start gap-2 rounded-lg border border-money/30 bg-money/10 px-3 py-2 text-sm">
              <InfoIcon className="mt-0.5 size-4 shrink-0 text-money" />
              The last run was skipped, so alerts show <strong className="font-semibold">Stale pricing</strong> until you save.
            </p>
          )}
          <Card>
            <div className={`${ROW_GRID} hidden border-b pb-2 text-xs font-medium text-muted-foreground md:grid`}>
              <span>Scenario</span>
              <span>FICO</span>
              <span>LTV</span>
              <span>Rate</span>
              <span>Points / credit</span>
              <span>Lender</span>
              <span>Last priced</span>
            </div>
            <ul className="divide-y">
              {active.map((s) => (
                <ScenarioRow key={s.id} scenario={s} draft={rows.find((d) => d.scenarioId === s.id)!} last={latest.get(s.id)} onChange={setRow} />
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Points the borrower pays are positive; a lender credit is negative (e.g. −0.250).</p>
          </Card>
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-sm text-muted-foreground">
              {priced} of {active.length} priced · scenarios are edited in{' '}
              <Link to="/settings#refi-watch" className="text-primary hover:underline">
                Settings › Refi Watch
              </Link>
            </p>
            <div className="flex w-full gap-2 sm:w-auto">
              {waiting && (
                <Button variant="outline" className="flex-1 sm:flex-none" disabled={busy} onClick={onSkip}>
                  Skip this run
                </Button>
              )}
              <Button className="flex-1 sm:flex-none" disabled={busy || priced === 0 || hasErrors} onClick={onSave}>
                {save.isPending ? 'Saving…' : 'Save & run screening'}
              </Button>
            </div>
          </div>
          <p className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
            {waiting
              ? 'If a run is skipped, screening keeps using the last saved set and every alert shows a Stale pricing badge until the next save. A scenario left blank keeps its last price.'
              : 'No scheduled run is waiting (they open Mon, Wed and Fri at 8:00 AM Central). Saving now records an extra pricing. A scenario left blank keeps its last price.'}
          </p>
        </div>
      )}
    </>
  )
}
