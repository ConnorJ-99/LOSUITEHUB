import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, PageHeader, Select } from '@/components/shared'
import { SearchForm, SHOWN_STATUSES } from '@/components/products/SearchForm'
import { SearchResults } from '@/components/products/SearchResults'
import { useCreditEvents } from '@/lib/api/creditEvents'
import { useLoan, usePipeline } from '@/lib/api/loans'
import { useCatalog, useLogSearch, useRecentSearches } from '@/lib/api/products'
import { useProperties } from '@/lib/api/properties'
import { useApplication } from '@/lib/api/urla'
import { relativeTime, todayIso } from '@/lib/dates'
import { fullName } from '@/lib/pipeline/helpers'
import { purposeLabel, stageLabel } from '@/lib/pipeline/stages'
import { gate, missingForSearch, search } from '@/lib/products/engine'
import { blankScenario, scenarioFromFile, scenarioLabel } from '@/lib/products/scenarioForm'
import type { LenderStatus } from '@/lib/products/taxonomy'
import type { Catalog, Scenario, SearchResult } from '@/lib/products/types'

const MODES = [
  { id: 'params', label: 'Search by parameters', note: null },
  { id: 'assistant', label: 'Ask the assistant', note: 'Comes in step 9' },
  { id: 'browse', label: 'Browse all programs', note: 'Comes in step 7' },
] as const

/** Product Search: which of Connor's lenders has a program for this borrower. Rule-based, no AI. */
export function ProductSearchPage() {
  const [params, setParams] = useSearchParams()
  const loanId = params.get('loan')
  const catalog = useCatalog()
  const pipeline = usePipeline()
  const recent = useRecentSearches()
  const logSearch = useLogSearch()
  const [scenario, setScenario] = useState<Scenario>(blankScenario)
  const [statuses, setStatuses] = useState<LenderStatus[]>(SHOWN_STATUSES)
  const [shown, setShown] = useState<{ scenario: Scenario; result: SearchResult } | null>(null)

  const borrower = pipeline.data?.find((l) => l.id === loanId) ?? null
  const borrowerName = borrower ? fullName(borrower.borrower) : null

  /** The catalog limited to the lender statuses picked on the form. */
  const limited: Catalog | null = useMemo(() => {
    if (!catalog.data) return null
    const lenders = catalog.data.lenders.filter((l) => statuses.includes(l.status))
    const ids = new Set(lenders.map((l) => l.id))
    return { lenders, programs: catalog.data.programs.filter((p) => ids.has(p.lenderId)), overlays: catalog.data.overlays }
  }, [catalog.data, statuses])
  const typeCount = limited ? gate(scenario, limited.programs, new Map(limited.lenders.map((l) => [l.id, l]))).searched.length : 0

  const run = (s: Scenario) => {
    if (!limited) return
    const result = search(s, limited)
    setShown({ scenario: s, result })
    window.scrollTo({ top: 0 })
    logSearch.mutate({ scenario: s, result, loanId }, { onError: (e) => toast.error(`Search ran, but couldn't be saved to Recent searches: ${e.message}`) })
  }
  const startFrom = (id: string | null) => {
    setShown(null)
    if (!id) setScenario(blankScenario())
    setParams(id ? { loan: id } : {}, { replace: true })
  }

  const programCount = catalog.data?.programs.filter((p) => p.active).length ?? 0
  const lenderCount = catalog.data?.lenders.length ?? 0

  return (
    <>
      <PageHeader
        title="Product Search"
        description={shown ? `Results${borrowerName ? ` for ${borrowerName}` : ''}` : `Find which of your lenders has a program for this borrower. ${programCount} programs · ${lenderCount} lenders.`}
        action={
          <div className="flex rounded-lg bg-muted p-1">
            {MODES.map((m) => (
              <button key={m.id} type="button" disabled={!!m.note} title={m.note ?? undefined} className={cn('rounded-md px-3 py-1.5 text-sm', m.id === 'params' ? 'bg-card font-medium text-primary shadow-sm' : 'text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60')}>
                {m.label}
              </button>
            ))}
          </div>
        }
      />
      {loanId && <FilePrefill key={loanId} loanId={loanId} onReady={(s) => setScenario(s)} />}

      {catalog.isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading your lenders…</p>
      ) : catalog.error ? (
        <p className="py-12 text-center text-sm text-destructive">{catalog.error.message.includes('lenders') ? 'Run the product search script in Supabase to use Product Search.' : catalog.error.message}</p>
      ) : shown ? (
        <SearchResults
          scenario={shown.scenario}
          result={shown.result}
          verifiedOn={catalog.data!.verifiedOn}
          borrowerName={borrowerName}
          onEdit={() => setShown(null)}
          onWiden={shown.scenario.family === 'any' ? null : () => run({ ...shown.scenario, family: 'any' })}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <SearchForm scenario={scenario} onChange={setScenario} statuses={statuses} onStatuses={setStatuses} typeCount={typeCount} missing={missingForSearch(scenario)} onSearch={() => run(scenario)} />
          <div className="space-y-4">
            <Card title="Start from">
              <Select
                label="Borrower"
                value={loanId}
                placeholder="Pick a borrower file"
                options={(pipeline.data ?? []).filter((l) => l.stage !== 'lost').map((l) => ({ value: l.id, label: `${fullName(l.borrower)} · ${purposeLabel(l.purpose)} · ${stageLabel(l.stage)}` }))}
                onChange={startFrom}
                onClear={() => startFrom(null)}
              />
              <p className="mt-2 text-xs text-muted-foreground">Pre-filled from the borrower file. Changes here don't edit the file.</p>
              <Button variant="outline" className="mt-3 w-full" onClick={() => startFrom(null)}>
                Blank search (no borrower)
              </Button>
            </Card>
            <Card title="Recent searches">
              {(recent.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Your searches will show here.</p>
              ) : (
                <ul className="space-y-3">
                  {recent.data!.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="text-left" onClick={() => setScenario(r.scenario)}>
                        <span className="block text-sm font-medium">{scenarioLabel(r.scenario)}</span>
                        <span className="text-xs text-muted-foreground">
                          {relativeTime(r.createdAt)} · {r.fits} fit, {r.close} close
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <p className="rounded-xl bg-accent px-4 py-3 text-sm text-accent-foreground">
              <span className="font-semibold">Tip:</span> pick the loan type first. The search never mixes in other loan types, so a DSCR second never returns FHA or down payment assistance programs.
            </p>
            {programCount === 0 && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">No lender programs yet. Lenders are added on the Lenders page (coming in step 5).</p>}
          </div>
        </div>
      )}
    </>
  )
}

/** Loads a borrower file and hands back a pre-filled scenario once. */
function FilePrefill({ loanId, onReady }: { loanId: string; onReady: (s: Scenario) => void }) {
  const loan = useLoan(loanId)
  const app = useApplication(loanId)
  const properties = useProperties(loanId)
  const contactIds = app.data?.borrowers.map((b) => b.contactId) ?? []
  const events = useCreditEvents(loanId, contactIds)
  const done = useRef(false)
  const ready = loan.data && app.data && properties.data && (contactIds.length === 0 || events.data)
  useEffect(() => {
    if (!ready || done.current) return
    done.current = true
    onReady(scenarioFromFile({ loan: loan.data!, app: app.data!, properties: properties.data!, creditEvents: events.data ?? [], today: todayIso() }))
  }, [ready, loan.data, app.data, properties.data, events.data, onReady])
  return null
}
