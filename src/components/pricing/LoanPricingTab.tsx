import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, CurrencyInput, DateInput, EmptyState, FormGrid, PercentInput, Select, ToggleChip } from '@/components/shared'
import { LenderMark } from '@/components/products/ProgramCard'
import { breakEven, categoryWinners, sortQuotes, type QuoteFigures, type QuoteSort } from '@/lib/calc'
import { useUpdateLoanDetails } from '@/lib/api/loans'
import { markChosen, useAddProgramOptions, useProgramOptions, useRemoveProgramOption, useSaveQuote, type ProgramOption, type QuoteDraft } from '@/lib/api/loanPricing'
import { useCreateScenario, useFeeTemplates, usePricingScenarios, useScenarioFees } from '@/lib/api/pricing'
import { useCatalog } from '@/lib/api/products'
import { useProperties, useSaveProperty, type PropertyInput } from '@/lib/api/properties'
import type { LoanProfile, MortgageType, Property } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { useQueryClient } from '@tanstack/react-query'
import { keys } from '@/lib/api/client'
import { todayIso } from '@/lib/dates'
import { formatCurrency, formatPercent } from '@/lib/format'
import { compareQuotes, quoteClosingCosts, type CompareContext, type SavedQuote } from '@/lib/pricing/compare'
import { loanChangesFrom, payoffsFor, priceScenario, scenarioFigures, scenarioFrom, type PricingScenario } from '@/lib/pricing/scenario'
import { LENDER_STATUSES, PRODUCT_FAMILIES, type ProductFamily } from '@/lib/products/taxonomy'

const SORTS: [QuoteSort, string, string][] = [
  ['rate', 'Best rate', 'Best rate'],
  ['cash', 'Lowest cash to close', 'Lowest cash to close'],
  ['payment', 'Lowest payment', 'Lowest payment'],
  ['cost', 'Lowest 5-yr cost', 'Lowest 5-yr cost'],
]
const LOCK_OPTIONS = ['15', '30', '45', '60'].map((d) => ({ value: d, label: `${d} days` }))
const MORTGAGE_TYPE_FOR: Partial<Record<ProductFamily, MortgageType>> = { conventional: 'conventional', fha: 'fha', va: 'va', usda: 'usda_rural' }

function propertyInput(p: Property): PropertyInput {
  const { id: _id, loanId: _loan, createdAt: _created, liens: _liens, rentalIncomeMethod: _method, scheduleEMonthlyIncome: _e, ...input } = p
  return input
}

/** Loan · Pricing (mockups 06 and 07): lenders added from Product Search, each lender's quote on a pricing scenario, the comparison, and Choose. */
export function LoanPricingTab({ loan }: { loan: LoanProfile }) {
  const options = useProgramOptions(loan.id)
  const scenarios = usePricingScenarios(loan.id)
  const properties = useProperties(loan.id)
  const templates = useFeeTemplates()
  const app = useApplication(loan.id)
  const createScenario = useCreateScenario(loan.id, loan.organizationId)
  const [params, setParams] = useSearchParams()
  const [adding, setAdding] = useState(false)

  if (options.isLoading || scenarios.isLoading || properties.isLoading || app.isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  const error = options.error ?? scenarios.error
  if (error) return <p className="py-12 text-center text-sm text-destructive">{error.message.includes('loan_program_options') ? 'Run the product search script in Supabase to use Loan · Pricing.' : error.message}</p>

  const list = scenarios.data ?? []
  const wanted = params.get('pricing')
  const scenario = list.find((s) => s.id === wanted) ?? list.find((s) => s.id === loan.details.pricingScenarioId) ?? list[0] ?? null
  const pick = (id: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.set('pricing', id)
        return next
      },
      { replace: true },
    )
  const startTbd = () =>
    createScenario.mutate(scenarioFrom(loan, null, loan.purpose === 'purchase' ? 'TBD purchase' : 'TBD'), {
      onSuccess: (s) => pick(s.id),
      onError: (e) => toast.error(e.message),
    })
  const opts = options.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Pricing comparison</h2>
          <p className="text-sm text-muted-foreground">Lenders added from Product Search. Enter each lender's quote to compare.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to={`/product-search?loan=${loan.id}`}>Open Product Search</Link>
          </Button>
          <Button variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add lender
          </Button>
        </div>
      </div>

      <Card contentClassName="py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Pricing scenario</span>
          {list.map((s) => (
            <button key={s.id} type="button" onClick={() => pick(s.id)} className={cn('rounded-lg border px-3 py-1.5 text-sm', s.id === scenario?.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}>
              {s.propertyId ? s.name : `${s.name} · no property yet`}
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={startTbd} disabled={createScenario.isPending}>
            <PlusIcon />
            TBD scenario
          </Button>
          {scenario && (
            <>
              <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
              <ScenarioFacts scenario={scenario} />
              <Link to={`/loans/${loan.id}?tab=fees&scenario=${scenario.id}`} className="ml-auto text-sm font-medium text-primary hover:underline">
                Edit scenario
              </Link>
            </>
          )}
        </div>
      </Card>

      {!scenario ? (
        <Card>
          <EmptyState title="No pricing scenario yet" description="Quotes are entered against a scenario: a TBD purchase with no property yet, or one of the saved homes (from the Fees tab or Push to pricer)." action={<Button onClick={startTbd}>Start a TBD scenario</Button>} />
        </Card>
      ) : opts.length === 0 ? (
        <Card>
          <EmptyState
            title="No lenders on this file yet"
            description="Run Product Search from this borrower, select the programs that fit, and add them here for pricing. Or add one by hand."
            action={
              <Button asChild>
                <Link to={`/product-search?loan=${loan.id}`}>Open Product Search</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <Comparison
          key={scenario.id}
          loan={loan}
          scenario={scenario}
          options={opts}
          property={(properties.data ?? []).find((p) => p.id === scenario.propertyId) ?? null}
          templates={templates.data ?? []}
          earnestMoney={(app.data?.assets ?? []).filter((a) => a.assetType === 'earnest_money').reduce((sum, a) => sum + a.amount, 0)}
        />
      )}
      {adding && <AddLenderDialog loan={loan} existing={opts.map((o) => o.programId)} onClose={() => setAdding(false)} />}
    </div>
  )
}

function ScenarioFacts({ scenario: s }: { scenario: PricingScenario }) {
  const f = scenarioFigures(s)
  const down = s.purchasePrice && s.loanAmount != null ? s.purchasePrice - s.loanAmount : null
  const facts = [
    s.purchasePrice ? `Price ${formatCurrency(s.purchasePrice)}` : s.propertyValue ? `Value ${formatCurrency(s.propertyValue)}` : null,
    down != null && s.purchasePrice ? `${formatPercent((down / s.purchasePrice) * 100, 2)} down · ${formatCurrency(down)}` : null,
    s.loanAmount ? formatCurrency(f.totalLoanAmount) : null,
    s.termMonths ? `${s.termMonths / 12}-yr ${s.amortizationType === 'arm' ? 'ARM' : 'fixed'}` : null,
    `Taxes & HOI ${formatCurrency(Math.round((f.payment.taxes + f.payment.hoi) * 100) / 100)}/mo`,
  ].filter((x): x is string => !!x)
  return (
    <>
      {facts.map((x) => (
        <span key={x} className="rounded-full border px-2.5 py-0.5 text-xs">
          {x}
        </span>
      ))}
    </>
  )
}

interface ComparisonProps {
  loan: LoanProfile
  scenario: PricingScenario
  options: ProgramOption[]
  property: Property | null
  templates: ReturnType<typeof useFeeTemplates>['data'] & object
  earnestMoney: number
}

function Comparison({ loan, scenario, options, property, templates, earnestMoney }: ComparisonProps) {
  const overrides = useScenarioFees(scenario.id)
  const [sort, setSort] = useState<QuoteSort>('rate')
  const [editing, setEditing] = useState<string | null>(null)
  const ctx: CompareContext = { purpose: loan.purpose, scenario, property, templates, overrides: overrides.data ?? [], earnestMoney, sellerCredits: loan.details.sellerCredits ?? 0 }
  const quoted = options.flatMap((o) => {
    const q = o.quotes.find((x) => x.pricingScenarioId === scenario.id)
    return q ? [{ option: o, quote: q }] : []
  })
  const figures = compareQuotes(
    quoted.map((x) => x.quote),
    ctx,
  )
  const byId = new Map(figures.map((f) => [f.id, f]))
  const winners = quoted.length > 1 ? categoryWinners(figures) : null
  const ranked = sortQuotes(figures, sort).map((f) => quoted.find((x) => x.quote.id === f.id)!)
  const unquoted = options.filter((o) => !quoted.some((x) => x.option.id === o.id))
  const sortLabel = SORTS.find(([k]) => k === sort)![2]

  return (
    <div className="space-y-4">
      {quoted.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Sort by</span>
          {SORTS.map(([k, label]) => (
            <ToggleChip key={k} label={label} pressed={sort === k} onChange={() => setSort(k)} />
          ))}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ranked.map(({ option, quote }, i) => {
          const f = byId.get(quote.id)!
          const won = winners ? SORTS.filter(([k]) => winners[k] === quote.id).map(([k, , label]) => [k, label] as const) : []
          const top = i === 0 && quoted.length > 1
          const otherWin = !top && won.length > 0
          return editing === option.id ? (
            <QuoteForm key={option.id} loan={loan} option={option} scenarioId={scenario.id} quote={quote} ctx={ctx} onDone={() => setEditing(null)} />
          ) : (
            <QuoteCard
              key={option.id}
              loan={loan}
              option={option}
              quote={quote}
              figures={f}
              rank={i + 1}
              banner={top ? `★ ${sortLabel}` : sortLabel.replace(/^(Best|Lowest) /, '').toUpperCase()}
              tone={top ? 'win' : otherWin ? 'other' : 'plain'}
              chips={won.filter(([k]) => !(top && k === sort)).map(([, l]) => l)}
              ctx={ctx}
              scenario={scenario}
              property={property}
              onEdit={() => setEditing(option.id)}
            />
          )
        })}
        {unquoted.map((o) =>
          editing === o.id ? (
            <QuoteForm key={o.id} loan={loan} option={o} scenarioId={scenario.id} quote={null} ctx={ctx} onDone={() => setEditing(null)} />
          ) : (
            <EmptyQuoteCard key={o.id} loan={loan} option={o} onAdd={() => setEditing(o.id)} />
          ),
        )}
      </div>
      {figures.length > 1 && <NumbersSay figures={figures} names={new Map(quoted.map((x) => [x.quote.id, optionName(x.option, quoted.map((y) => y.option))]))} />}
      {quoted.length === 0 && <p className="rounded-xl bg-accent px-4 py-3 text-sm text-accent-foreground">Enter each lender's quote: rate, lock, points, lender credit and total closing costs (or use this scenario's fee sheet). Reading a lender's quote PDF comes with the assistant.</p>}
    </div>
  )
}

/** The lender's short name, plus the program when the same lender is quoted twice ("NW Conventional HomeReady"). */
function optionName(o: ProgramOption, all: ProgramOption[]) {
  const lender = o.lenderShortName ?? o.lenderName
  return all.filter((x) => x.lenderId === o.lenderId).length > 1 ? `${lender} ${o.programName}` : lender
}

function OptionHeader({ option: o, children }: { option: ProgramOption; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <LenderMark name={o.lenderShortName ?? o.lenderName} />
      <div className="min-w-0 flex-1">
        <p className="leading-tight font-semibold">{o.lenderName}</p>
        <p className="text-xs text-muted-foreground">
          {o.programName}
          {o.lenderStatus !== 'approved' && <span className="ml-1 text-amber-700">· {LENDER_STATUSES.label[o.lenderStatus]}</span>}
        </p>
      </div>
      {children}
    </div>
  )
}

function RemoveButton({ loan, option }: { loan: LoanProfile; option: ProgramOption }) {
  const remove = useRemoveProgramOption(loan.id)
  return (
    <button type="button" title="Take off this comparison" className="text-muted-foreground hover:text-foreground" onClick={() => window.confirm(`Take ${option.lenderName} · ${option.programName} off the comparison? Its quotes are kept if you add it again.`) && remove.mutate(option.id, { onError: (e) => toast.error(e.message) })}>
      <XIcon className="size-4" />
    </button>
  )
}

function EmptyQuoteCard({ loan, option, onAdd }: { loan: LoanProfile; option: ProgramOption; onAdd: () => void }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <OptionHeader option={option}>
        <RemoveButton loan={loan} option={option} />
      </OptionHeader>
      <div className="mt-4 flex flex-col items-center gap-3 rounded-lg border border-dashed py-8">
        <p className="text-sm text-muted-foreground">No pricing yet</p>
        <Button variant="outline" onClick={onAdd}>
          <PlusIcon />
          Add pricing
        </Button>
      </div>
    </div>
  )
}

function QuoteForm({ loan, option, scenarioId, quote, ctx, onDone }: { loan: LoanProfile; option: ProgramOption; scenarioId: string; quote: SavedQuote | null; ctx: CompareContext; onDone: () => void }) {
  const save = useSaveQuote(loan.id, loan.organizationId)
  const [q, setQ] = useState<QuoteDraft>(() =>
    quote ? { ...quote } : { optionId: option.id, pricingScenarioId: scenarioId, rate: 0, lockDays: 30, pointsPct: 0, lenderCredit: 0, closingCosts: null, closingCostsFromFeeSheet: false, monthlyMi: null, quoteDate: todayIso(), notes: null },
  )
  const set = <K extends keyof QuoteDraft>(key: K) => (value: QuoteDraft[K]) => setQ((x) => ({ ...x, [key]: value }))
  const feeSheet = q.rate > 0 ? quoteClosingCosts({ ...q, closingCostsFromFeeSheet: true }, ctx) : null
  return (
    <div className="rounded-xl border-2 border-primary bg-card p-4">
      <OptionHeader option={option}>
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">Entering quote</span>
      </OptionHeader>
      <FormGrid className="mt-4 lg:grid-cols-2">
        <PercentInput label="Rate" required value={q.rate || null} onChange={(v) => set('rate')(v ?? 0)} />
        <Select label="Lock period" value={q.lockDays ? String(q.lockDays) : null} options={LOCK_OPTIONS} onChange={(v) => set('lockDays')(Number(v))} />
        <PercentInput label="Points / price" value={q.pointsPct} onChange={(v) => set('pointsPct')(v ?? 0)} hint="Points +, credit −" />
        <CurrencyInput label="Lender credit" value={q.lenderCredit} onChange={(v) => set('lenderCredit')(v ?? 0)} />
        <div className="sm:col-span-2">
          {q.closingCostsFromFeeSheet ? (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              Total closing costs (incl. points): <span className="font-semibold tabular-nums">{feeSheet != null ? formatCurrency(feeSheet) : 'enter the rate first'}</span> from this scenario's fee sheet
            </p>
          ) : (
            <CurrencyInput label="Total closing costs (incl. points)" required value={q.closingCosts} onChange={set('closingCosts')} />
          )}
          <div className="mt-1.5">
            <ToggleChip label="Use fee sheet" pressed={q.closingCostsFromFeeSheet} onChange={set('closingCostsFromFeeSheet')} />
          </div>
        </div>
        <CurrencyInput label="Monthly MI" value={q.monthlyMi} onChange={set('monthlyMi')} hint="Blank = calculated" />
        <DateInput label="Quote date" value={q.quoteDate} onChange={(v) => set('quoteDate')(v ?? todayIso())} />
      </FormGrid>
      <div className="mt-4 flex gap-2">
        <Button disabled={save.isPending} onClick={() => save.mutate(q, { onSuccess: () => (toast.success('Quote saved'), onDone()), onError: (e) => toast.error(e.message) })}>
          {save.isPending ? 'Saving…' : 'Save quote'}
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

interface QuoteCardProps {
  loan: LoanProfile
  option: ProgramOption
  quote: SavedQuote
  figures: QuoteFigures
  rank: number
  banner: string
  tone: 'win' | 'other' | 'plain'
  chips: string[]
  ctx: CompareContext
  scenario: PricingScenario
  property: Property | null
  onEdit: () => void
}

function QuoteCard({ loan, option, quote, figures: f, rank, banner, tone, chips, ctx, scenario, property, onEdit }: QuoteCardProps) {
  const updateLoan = useUpdateLoanDetails(loan.id)
  const saveProperty = useSaveProperty(loan.id, loan.organizationId)
  const queryClient = useQueryClient()
  const [choosing, setChoosing] = useState(false)
  const chosen = loan.details.chosenQuoteId === quote.id
  const name = option.lenderShortName ?? option.lenderName
  const choose = async () => {
    if (!window.confirm(`Choose ${option.lenderName} · ${option.programName} at ${formatPercent(quote.rate)}? This writes the rate, points, lender credit, loan amount and closing cost estimates to the loan${property ? ` and the taxes and insurance to ${property.addressLine}` : ''}, and completes "Select lender & program".`)) return
    setChoosing(true)
    try {
      const at = { ...scenario, noteRate: quote.rate, pointsPct: Math.max(0, quote.pointsPct), lenderCredit: quote.lenderCredit }
      const priced = priceScenario(at, ctx.purpose, ctx.templates, ctx.overrides)
      const changes = loanChangesFrom(at, ctx.purpose, quoteClosingCosts(quote, ctx) - quote.lenderCredit, priced.totals.F + priced.totals.G)
      const mortgageType = MORTGAGE_TYPE_FOR[option.family]
      await updateLoan.mutateAsync({ ...changes.loan, ...(mortgageType && { mortgageType }), programId: option.programId, chosenQuoteId: quote.id })
      if (changes.property && property) await saveProperty.mutateAsync({ ...propertyInput(property), ...changes.property, id: property.id })
      await markChosen(loan.id, option.id)
      await queryClient.invalidateQueries({ queryKey: keys.programOptions(loan.id) })
      await queryClient.invalidateQueries({ queryKey: keys.loanFile(loan.id) })
      toast.success(`Chose ${option.lenderName}`)
    } catch (e) {
      toast.error(`Could not choose it: ${(e as Error).message}`)
    } finally {
      setChoosing(false)
    }
  }
  const cash = f.cashToClose
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-xl border-2 bg-card', tone === 'win' ? 'border-emerald-600 shadow-md' : tone === 'other' ? 'border-amber-400' : 'border-border')}>
      <div className={cn('flex justify-between px-4 py-1.5 text-xs font-semibold tracking-wide', tone === 'win' ? 'bg-emerald-700 text-white' : tone === 'other' ? 'bg-amber-50 text-amber-800' : 'bg-muted text-muted-foreground')}>
        <span>{banner}</span>
        <span>#{rank}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <OptionHeader option={option}>{!chosen && <RemoveButton loan={loan} option={option} />}</OptionHeader>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                {c}
              </span>
            ))}
          </div>
        )}
        <p className="mt-3">
          <span className={cn('text-3xl font-semibold tabular-nums', tone === 'win' && 'text-emerald-700')}>{formatPercent(quote.rate)}</span>
          {quote.lockDays != null && <span className="ml-2 text-sm text-muted-foreground">{quote.lockDays}-day lock</span>}
        </p>
        <dl className="mt-3 divide-y text-sm">
          <Row label={`Closing costs incl. points${quote.closingCostsFromFeeSheet ? ' (fee sheet)' : ''}`} value={formatCurrency(quoteClosingCosts(quote, ctx))} strong />
          {quote.lenderCredit > 0 && <Row label="Lender credit" value={`−${formatCurrency(quote.lenderCredit)}`} />}
          {ctx.purpose === 'purchase' ? <Row label="Down payment" value={formatCurrency(f.downPayment)} /> : <Row label="Payoffs" value={formatCurrency(payoffsFor(ctx.purpose, ctx.property))} />}
          <Row label={cash >= 0 ? 'Cash to close' : 'Cash to borrower'} value={formatCurrency(Math.abs(cash))} strong />
          <Row label="Principal & interest" value={formatCurrency(f.principalAndInterest)} />
          <Row label="Mortgage insurance" value={formatCurrency(f.mi)} />
          <Row label="Taxes & insurance" value={formatCurrency(f.taxesInsurance)} />
          <Row label="Total payment" value={formatCurrency(f.totalPayment)} strong />
          <Row label="5-yr cost (cash + P&I + MI)" value={formatCurrency(Math.round(f.horizonCost))} />
        </dl>
        <div className="mt-auto flex gap-2 pt-4">
          {chosen ? (
            <span className="flex-1 rounded-md bg-emerald-50 px-3 py-2 text-center text-sm font-medium text-emerald-700">Chosen ✓</span>
          ) : (
            <Button className="flex-1" variant={tone === 'win' ? 'default' : 'outline'} disabled={choosing} onClick={choose}>
              {choosing ? 'Choosing…' : `Choose ${name}`}
            </Button>
          )}
          <Button variant="outline" onClick={onEdit}>
            Edit
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {PRODUCT_FAMILIES.label[option.family]} · quoted {new Date(`${quote.quoteDate}T12:00:00`).toLocaleDateString('en-US')}
        </p>
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</dt>
      <dd className={cn('tabular-nums', strong && 'font-semibold')}>{value}</dd>
    </div>
  )
}

/** Break-even between the options (calculated, not AI). */
function NumbersSay({ figures, names }: { figures: QuoteFigures[]; names: Map<string, string> }) {
  const pairs: [QuoteFigures, QuoteFigures][] = []
  for (let a = 0; a < figures.length; a++) for (let b = a + 1; b < figures.length; b++) pairs.push([figures[a], figures[b]])
  return (
    <Card title="What the numbers say" description="Calculated, not AI. Monthly differences are principal, interest and mortgage insurance.">
      <div className="grid gap-4 md:grid-cols-3">
        {pairs.slice(0, 6).map(([a, b]) => {
          const r = breakEven(a, b)
          const n = (id: string) => names.get(id) ?? id
          return (
            <p key={`${a.id}-${b.id}`} className="border-l-4 border-primary/40 pl-3 text-sm">
              {r.kind === 'same' ? (
                <>
                  <span className="font-semibold">
                    {n(a.id)} and {n(b.id)}:
                  </span>{' '}
                  the same cost up front and each month.
                </>
              ) : r.kind === 'never' ? (
                <>
                  <span className="font-semibold">
                    {n(r.better)} vs {n(r.better === a.id ? b.id : a.id)}:
                  </span>{' '}
                  {n(r.better)} costs less up front and each month, so it's ahead from day one.
                </>
              ) : (
                <>
                  <span className="font-semibold">
                    {n(r.payMoreUpFront)} vs {n(r.payLessUpFront)}:
                  </span>{' '}
                  {formatCurrency(r.monthlyDifference)}/mo lower, but {formatCurrency(r.upFrontDifference)} more up front. Breaks even after <span className="font-semibold">{r.years} years</span>; {n(r.payLessUpFront)} costs less if the loan is paid off or refinanced sooner.
                </>
              )}
            </p>
          )
        })}
      </div>
    </Card>
  )
}

/** Adds a program from the catalog by hand. */
function AddLenderDialog({ loan, existing, onClose }: { loan: LoanProfile; existing: string[]; onClose: () => void }) {
  const catalog = useCatalog()
  const add = useAddProgramOptions(loan.id, loan.organizationId)
  const [programId, setProgramId] = useState<string | null>(null)
  const lenders = new Map((catalog.data?.lenders ?? []).map((l) => [l.id, l]))
  const options = (catalog.data?.programs ?? [])
    .filter((p) => p.active && !existing.includes(p.id) && lenders.get(p.lenderId)?.status !== 'inactive')
    .map((p) => ({ value: p.id, label: `${lenders.get(p.lenderId)?.name ?? ''} · ${p.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return (
    <Card title="Add a lender program" description="Usually added from Product Search; pick one here to price it directly." action={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Select label="Program" value={programId} options={options} onChange={setProgramId} placeholder={catalog.isLoading ? 'Loading…' : 'Pick a program'} />
        </div>
        <Button disabled={!programId || add.isPending} onClick={() => programId && add.mutate({ programIds: [programId], searchId: null }, { onSuccess: () => (toast.success('Added'), onClose()), onError: (e) => toast.error(e.message) })}>
          Add
        </Button>
      </div>
    </Card>
  )
}
