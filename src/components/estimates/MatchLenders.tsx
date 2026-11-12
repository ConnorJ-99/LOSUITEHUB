import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckIcon, RotateCcwIcon, SlidersHorizontalIcon, SparklesIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, confirmAction } from '@/components/shared'
import { MORTGAGE_TYPE_OPTIONS } from '@/components/profile/options'
import { SHOWN_STATUSES, SearchForm } from '@/components/products/SearchForm'
import { db, keys, unwrap } from '@/lib/api/client'
import { useCreditEvents } from '@/lib/api/creditEvents'
import { addProgramOptions } from '@/lib/api/loanPricing'
import { saveLoanDetails } from '@/lib/api/loans'
import { useCatalog } from '@/lib/api/products'
import type { LoanProfile } from '@/lib/api/types'
import { todayIso } from '@/lib/dates'
import { MORTGAGE_TYPE_FOR_FAMILY } from '@/lib/estimates/estimate'
import { gate, missingForSearch } from '@/lib/products/engine'
import { matchCatalog, matchContext, matchFamilies, matchLenders, matchScenario, shortLines, type Grade, type MatchLine, type MatchRow } from '@/lib/products/match'
import { scenarioChips, scenarioFromFile, typeChips } from '@/lib/products/scenarioForm'
import { PRODUCT_FAMILIES, type LenderStatus, type ProductFamily } from '@/lib/products/taxonomy'
import type { Catalog, Scenario } from '@/lib/products/types'
import type { EstimateData } from './useEstimateData'

const GRADE_CLASS: Record<Grade, string> = {
  A: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  B: 'bg-primary/10 text-primary border-primary/20',
  C: 'bg-amber-50 text-amber-800 border-amber-200',
  D: 'bg-muted text-muted-foreground border-border',
}
const TONE_CLASS: Record<MatchLine['tone'], string> = { pass: 'text-emerald-700', limit: 'text-amber-700', verify: 'text-muted-foreground', fail: 'text-destructive' }

/**
 * Match lenders: parameters (Product Search's form, started from the file)
 * through the Product Search engine, with a grade per program. Check programs to build estimates for them, or set one
 * as the file's program. Nothing on the file changes until a button is pressed.
 */
export function MatchLenders({ loan, data, onClose, onCreate }: { loan: LoanProfile; data: EstimateData; onClose: () => void; onCreate: (programIds: string[], scenario: Scenario) => void }) {
  const catalog = useCatalog()
  const contactIds = data.application.borrowers.map((b) => b.contactId)
  const events = useCreditEvents(loan.id, contactIds)
  const queryClient = useQueryClient()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [family, setFamily] = useState<ProductFamily | 'all'>('all')
  const [showExcluded, setShowExcluded] = useState(false)
  const [setting, setSetting] = useState<string | null>(null)
  // Parameters: start from the file; edits here never change the file. `ran` is what the results show.
  const [draft, setDraft] = useState<Scenario | null>(null)
  const [ran, setRan] = useState<Scenario | null>(null)
  const [editing, setEditing] = useState(true)
  const [statuses, setStatuses] = useState<LenderStatus[]>(SHOWN_STATUSES)
  const eventsReady = contactIds.length === 0 || !!events.data

  const fromFile = useMemo(() => (eventsReady ? matchScenario(scenarioFromFile({ loan, app: data.application, properties: data.properties, creditEvents: events.data ?? [], today: todayIso() })) : null), [eventsReady, loan, data.application, data.properties, events.data])
  const params = draft ?? fromFile
  const scenario = ran ?? fromFile
  const vaEligible = loan.details.mortgageType === 'va' || data.application.borrowers.some((b) => b.person.militaryService === true)
  const limited: Catalog | null = useMemo(() => {
    if (!catalog.data) return null
    const lenders = catalog.data.lenders.filter((l) => statuses.includes(l.status))
    const ids = new Set(lenders.map((l) => l.id))
    return { lenders, programs: catalog.data.programs.filter((p) => ids.has(p.lenderId)), overlays: catalog.data.overlays }
  }, [catalog.data, statuses])
  const missing = scenario ? missingForSearch(scenario) : []
  const match = useMemo(() => (scenario && limited && missingForSearch(scenario).length === 0 ? matchLenders(scenario, limited, vaEligible) : null), [scenario, limited, vaEligible])

  const header = (
    <div className="flex items-start gap-3">
      <div className="mr-auto">
        <h3 className="text-lg font-bold">Match lenders</h3>
        <p className="text-sm text-muted-foreground">Set the parameters for what you're trying to do (they start from the file and never change it), then match every program in your lender catalog.</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onClose}>
        <XIcon />
        Close
      </Button>
    </div>
  )

  if (catalog.isLoading || !eventsReady || !params || !limited) return <div className="space-y-4">{header}<p className="py-12 text-center text-sm text-muted-foreground">{catalog.error ? '' : 'Loading your lenders…'}</p>{catalog.error && <p className="text-center text-sm text-destructive">{catalog.error.message}</p>}</div>

  const changed = !!draft && draft !== ran
  const runMatch = () => {
    setRan(params)
    setEditing(false)
    setChecked(new Set())
  }
  const reset = () => {
    setDraft(null)
    setRan(null)
  }
  const typeCount = gate(params, matchCatalog(limited, vaEligible || params.family === 'va').programs, new Map(limited.lenders.map((l) => [l.id, l]))).searched.length
  const parameters = editing ? (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-semibold">Parameters</p>
        {draft && (
          <Button size="xs" variant="ghost" onClick={reset}>
            <RotateCcwIcon />
            Reset to the file
          </Button>
        )}
        {ran && (
          <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
            Hide parameters
          </Button>
        )}
      </div>
      <SearchForm scenario={params} onChange={setDraft} statuses={statuses} onStatuses={setStatuses} typeCount={typeCount} missing={missingForSearch(params)} onSearch={runMatch} />
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card px-3 py-2">
      <span className="mr-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Parameters</span>
      {[...typeChips(scenario!), ...scenarioChips(scenario!)].map((c) => (
        <span key={c} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          {c}
        </span>
      ))}
      {ran && <span className="text-xs font-medium text-amber-700">Edited, not saved to the file</span>}
      <Button size="xs" variant="outline" className="ml-auto" onClick={() => setEditing(true)}>
        <SlidersHorizontalIcon />
        Edit parameters
      </Button>
    </div>
  )

  if (!scenario || !match || missing.length)
    return (
      <div className="space-y-4">
        {header}
        {parameters}
        {!editing && (
          <Card>
            <EmptyState title="A few facts are missing" description={`Add the ${missing.join(', ')} in the parameters, then match.`} />
          </Card>
        )}
      </div>
    )

  const loanType = scenario.family !== 'any' ? PRODUCT_FAMILIES.label[scenario.family] : (MORTGAGE_TYPE_OPTIONS.find((o) => o.value === loan.details.mortgageType)?.label ?? null)
  const families = matchFamilies(match)
  const inFamily = (r: MatchRow) => family === 'all' || r.result.program.family === family
  const fits = match.fits.filter(inFamily)
  const near = match.nearMisses.filter(inFamily)
  const excluded = match.excluded.filter(inFamily)
  const lienFirst = scenario.lien === 'first'
  const checkedIds = [...match.fits, ...match.nearMisses].map((r) => r.result.program.id).filter((id) => checked.has(id))
  const toggle = (id: string, on: boolean) => setChecked((c) => (on ? new Set([...c, id]) : new Set([...c].filter((x) => x !== id))))

  const setAsFileProgram = async (r: MatchRow) => {
    const p = r.result.program
    const selected = data.list.find((e) => e.id === loan.details.pricingScenarioId)
    const otherSelected = selected?.program && selected.program.programId !== p.id
    const same = loan.details.programId === p.id
    if (same) return toast.info('That is already the file program.')
    const question = otherSelected
      ? `The Selected estimate ("${selected!.name}") is on another program. Set ${p.name} · ${r.result.lender.name} as the file program anyway? Only the program, lender and loan type change; the rate, fees and the Selected estimate stay as they are.`
      : `Set ${p.name} · ${r.result.lender.name} as the file program? Only the program, lender and loan type change; the rate and fees stay as they are.`
    if (!(await confirmAction(question, { confirmLabel: 'Set as file program' }))) return
    setSetting(p.id)
    try {
      const mortgageType = MORTGAGE_TYPE_FOR_FAMILY[p.family]
      await saveLoanDetails(loan.id, { programId: p.id, lenderName: r.result.lender.name, programName: p.name, ...(mortgageType && { mortgageType }) })
      await addProgramOptions(loan.id, loan.organizationId, [p.id], null)
      if (loan.borrower) unwrap(await db().from('notes').insert({ organization_id: loan.organizationId, contact_id: loan.borrower.id, loan_id: loan.id, kind: 'note', body: `File program set to ${p.name} · ${r.result.lender.name} from Match lenders (${r.grade} · ${r.score}).` }).select('id'))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.loan(loan.id) }),
        queryClient.invalidateQueries({ queryKey: keys.loanFile(loan.id) }),
        queryClient.invalidateQueries({ queryKey: keys.pipeline }),
        queryClient.invalidateQueries({ queryKey: keys.programOptions(loan.id) }),
        ...(loan.borrower ? [queryClient.invalidateQueries({ queryKey: keys.notes(loan.borrower.id) })] : []),
      ])
      toast.success(`File program set to ${p.name} · ${r.result.lender.name}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSetting(null)
    }
  }

  const rowProps = { checked, onToggle: toggle, onSetProgram: setAsFileProgram, settingId: setting, fileProgramId: loan.details.programId, canBuild: lienFirst }

  return (
    <div className="space-y-4">
      {header}
      {parameters}
      {editing && changed && <p className="text-sm text-amber-700">The results below are from the last match. Press Search programs to match these parameters.</p>}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <p className="mr-auto text-sm font-medium tabular-nums">{matchContext(scenario, match, loanType)}</p>
        <Button size="sm" className="bg-money text-white hover:bg-money/90" disabled={checkedIds.length === 0 || !lienFirst} title={lienFirst ? undefined : 'Estimates are for 1st liens'} onClick={() => onCreate(checkedIds, scenario)}>
          <SparklesIcon />
          Create estimates{checkedIds.length ? ` (${checkedIds.length})` : ''}
        </Button>
      </div>
      {families.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {(['all', ...families] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFamily(f)} className={cn('rounded-full px-2.5 py-1 text-xs font-medium', family === f ? 'bg-navy text-white' : 'bg-muted text-muted-foreground hover:text-foreground')}>
              {f === 'all' ? 'All types' : PRODUCT_FAMILIES.label[f]}
            </button>
          ))}
        </div>
      )}

      <Card title={`Fits · ${fits.length}`} description="Ranked by score. A 90+, B 80–89, C 70–79, D below." contentClassName="p-0">
        {fits.length ? <MatchList rows={fits} {...rowProps} /> : <p className="p-4 text-sm text-muted-foreground">No program fits this file as it stands. Check the near misses below.</p>}
      </Card>

      {near.length > 0 && (
        <Card title={`Near misses · ${near.length}`} description="Each fails exactly one thing. The red line says which and by how much." contentClassName="p-0">
          <MatchList rows={near} {...rowProps} />
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => setShowExcluded((v) => !v)}>
          {showExcluded ? 'Hide' : 'Show'} excluded ({excluded.length})
        </button>
        {match.notSearched > 0 && <span>{match.notSearched} other program{match.notSearched === 1 ? ' is' : 's are'} for a different lien or income documentation and weren't checked.</span>}
        {!vaEligible && <span>VA programs are left out (no military service on the 1003).</span>}
      </div>
      {showExcluded && excluded.length > 0 && (
        <Card title={`Excluded · ${excluded.length}`} description="Fail more than one thing, or nothing in this scenario can fix it." contentClassName="p-0">
          <MatchList rows={excluded} {...rowProps} excluded />
        </Card>
      )}
    </div>
  )
}

interface ListProps {
  rows: MatchRow[]
  checked: Set<string>
  onToggle: (id: string, on: boolean) => void
  onSetProgram: (r: MatchRow) => void
  settingId: string | null
  fileProgramId: string | null
  canBuild: boolean
  excluded?: boolean
}

function MatchList({ rows, checked, onToggle, onSetProgram, settingId, fileProgramId, canBuild, excluded }: ListProps) {
  return (
    <ul className="divide-y">
      {rows.map((r) => {
        const p = r.result.program
        const on = checked.has(p.id)
        const isFileProgram = fileProgramId === p.id
        return (
          <li key={p.id} className={cn('flex items-start gap-3 px-3 py-2.5', on && 'bg-primary/5')}>
            {!excluded && canBuild ? (
              <input type="checkbox" aria-label={`Check ${p.name}`} className="mt-1 size-4 shrink-0 accent-primary" checked={on} onChange={(e) => onToggle(p.id, e.target.checked)} />
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className={cn('mt-0.5 inline-flex h-6 min-w-14 shrink-0 items-center justify-center rounded-md border px-1.5 text-xs font-semibold tabular-nums', r.grade ? GRADE_CLASS[r.grade] : 'border-border text-muted-foreground')}>{r.grade ? `${r.grade} · ${r.score}` : '—'}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-tight font-semibold">
                {p.name}
                {isFileProgram && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 align-middle text-[0.7rem] font-medium text-emerald-700">
                    <CheckIcon className="size-3" />
                    File program
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {r.result.lender.name} · {PRODUCT_FAMILIES.label[p.family]}
              </p>
              <p className="mt-1 text-xs leading-relaxed" title={r.lines.filter((l) => l.tone === 'verify').map((l) => l.text).join('\n') || undefined}>
                {shortLines(r.lines).map((l, i) => (
                  <span key={i}>
                    {i > 0 && <span className="text-muted-foreground"> · </span>}
                    <span className={TONE_CLASS[l.tone]}>{l.text}</span>
                  </span>
                ))}
              </p>
            </div>
            {!excluded && !isFileProgram && (
              <Button size="xs" variant="outline" className="shrink-0" disabled={settingId != null} onClick={() => onSetProgram(r)}>
                {settingId === p.id ? 'Setting…' : <><span className="hidden sm:inline">Set as file program</span><span className="sm:hidden">Set</span></>}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
