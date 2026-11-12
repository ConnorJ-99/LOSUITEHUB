import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { PlusIcon, SparklesIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, CurrencyInput, DateInput, SearchInput, Select } from '@/components/shared'
import { TERM_OPTIONS } from '@/components/profile/options'
import { newProgramOption, useProgramList } from '@/lib/api/estimates'
import { useProgramOptions } from '@/lib/api/loanPricing'
import type { LoanProfile } from '@/lib/api/types'
import { parseNumber, formatCurrency, formatPercent } from '@/lib/format'
import { ESTIMATE_DEFAULTS, activeRules, computeEstimate, defaultDownPct, draftFromRow, estimateName, type BuildRow, type SharedDeal } from '@/lib/estimates/estimate'
import { PRODUCT_FAMILIES, type ProductFamily } from '@/lib/products/taxonomy'
import { scenarioFrom } from '@/lib/pricing/scenario'
import type { EstimateData } from './useEstimateData'

interface Pick {
  programId: string
  programName: string
  family: ProductFamily
  lenderId: string | null
  lenderName: string
  /** Its option on the file, if it's already there. */
  optionId: string | null
}

type Filter = 'all' | 'file' | ProductFamily

let rowSeq = 0
const nextKey = () => `row-${++rowSeq}`

/** Build estimates: pick programs, set each row's rate and down payment, and create a full estimate for every row at once. */
export function BuildEstimates({ loan, data, onClose, onCreated }: { loan: LoanProfile; data: EstimateData; onClose: () => void; onCreated: (ids: string[]) => void }) {
  const options = useProgramOptions(loan.id)
  const catalog = useProgramList()
  const [params] = useSearchParams()
  const isPurchase = loan.purpose === 'purchase'
  const d = loan.details
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  // Match lenders can hand over the price and down payment % it matched (?price=&down=).
  const matchedPrice = isPurchase ? Number(params.get('price')) || null : null
  const matchedDown = isPurchase && params.get('down') != null && Number.isFinite(Number(params.get('down'))) ? Number(params.get('down')) : null
  const [shared, setShared] = useState<SharedDeal>({
    purchasePrice: isPurchase ? (matchedPrice ?? d.purchasePrice) : null,
    propertyValue: null,
    closingDate: d.closingDate ?? d.estimatedFundingDate,
    sellerCredits: d.sellerCredits,
    earnestMoney: null,
    propertyId: d.subjectPropertyId,
  })
  const [rows, setRows] = useState<BuildRow[]>([])
  const [creating, setCreating] = useState(false)
  const [preselected, setPreselected] = useState(false)

  const onFile: Pick[] = []
  for (const o of options.data ?? []) {
    if (!onFile.some((p) => p.programId === o.programId)) onFile.push({ programId: o.programId, programName: o.programName, family: o.family, lenderId: o.lenderId || null, lenderName: o.lenderShortName ?? o.lenderName, optionId: o.id })
  }
  const fromCatalog: Pick[] = (catalog.data ?? [])
    .filter((p) => p.active && p.lien === 'first' && p.lenderStatus !== 'inactive' && !onFile.some((f) => f.programId === p.id))
    .map((p) => ({ programId: p.id, programName: p.name, family: p.family, lenderId: p.lenderId, lenderName: p.lenderName, optionId: null }))
  const q = search.trim().toLowerCase()
  const list = (filter === 'file' ? onFile : [...onFile, ...fromCatalog])
    .filter((p) => filter === 'all' || filter === 'file' || p.family === filter)
    .filter((p) => !q || `${p.programName} ${p.lenderName}`.toLowerCase().includes(q))

  const subject = data.properties.find((p) => p.id === shared.propertyId) ?? null
  const base = { ...scenarioFrom(loan, subject, '', data.properties), ...ESTIMATE_DEFAULTS }
  const facts = data.factsFor(shared.propertyId)
  const loanSeller = d.sellerCredits
  const takenBefore = data.list.map((e) => e.name)

  const rowFor = (p: Pick): BuildRow => ({
    key: nextKey(),
    programOptionId: p.optionId,
    programId: p.programId,
    programName: p.programName,
    family: p.family,
    lenderId: p.lenderId,
    lenderName: p.lenderName,
    label: '',
    ratePct: d.noteRate,
    pointsPct: 0,
    downPct: isPurchase ? (matchedDown ?? defaultDownPct(p.family)) : null,
    loanAmount: isPurchase ? null : d.loanAmount,
    termMonths: d.termMonths ?? 360,
  })
  // Programs sent from Product Search (?programs=a,b) start checked.
  if (!preselected && options.data && catalog.data) {
    const ids = (params.get('programs') ?? '').split(',').filter(Boolean)
    if (ids.length) setRows(ids.map((id) => [...onFile, ...fromCatalog].find((p) => p.programId === id)).filter((p): p is Pick => !!p).map(rowFor))
    setPreselected(true)
  }

  const toggle = (p: Pick, on: boolean) => setRows((rs) => (on ? [...rs, rowFor(p)] : rs.filter((r) => r.programId !== p.programId)))
  const update = (key: string, patch: Partial<BuildRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const again = (r: BuildRow) => setRows((rs) => {
    const i = rs.findIndex((x) => x.key === r.key)
    return [...rs.slice(0, i + 1), { ...r, key: nextKey(), label: '' }, ...rs.slice(i + 1)]
  })
  const remove = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key))

  // Names: the label, else "Program · Lender", with "· Option B" for the same program again.
  const names: string[] = []
  for (const r of rows) names.push(r.label.trim() || estimateName(`${r.programName} · ${r.lenderName}`, [...takenBefore, ...names]))
  const sharedForDraft: SharedDeal = { ...shared, sellerCredits: shared.sellerCredits === loanSeller ? null : shared.sellerCredits }
  const drafts = rows.map((r, i) => draftFromRow(base, r, sharedForDraft, isPurchase, names[i]))
  const previews = drafts.map((x, i) => computeEstimate({ ...x, feeRules: activeRules(data.templates, rows[i].lenderId) }, [], data.templates, facts).saved)

  const create = async () => {
    const missing = rows.findIndex((r) => r.ratePct == null)
    if (missing >= 0) return toast.error(`Row ${missing + 1} needs a rate.`)
    setCreating(true)
    const ids: string[] = []
    try {
      const used = new Set<string>()
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        // The first row of a program already on the file uses its option; every other row gets its own.
        let optionId = r.programOptionId && !used.has(r.programOptionId) && !data.list.some((e) => e.programOptionId === r.programOptionId) ? r.programOptionId : null
        if (!optionId && r.programId) optionId = await newProgramOption(loan.id, loan.organizationId, r.programId)
        if (optionId) used.add(optionId)
        const created = await data.create({ ...drafts[i], programOptionId: optionId }, [], r.lenderId)
        ids.push(created.id)
      }
      await data.refresh()
      toast.success(`Created ${ids.length} estimate${ids.length > 1 ? 's' : ''} as Drafts`)
      onCreated(ids)
    } catch (e) {
      toast.error(`Created ${ids.length} of ${rows.length}: ${(e as Error).message}`)
      if (ids.length) onCreated(ids)
    } finally {
      setCreating(false)
    }
  }

  const FILTERS: [Filter, string][] = [
    ['all', 'All'],
    ['file', `On this file (${onFile.length})`],
    ['fha', 'FHA'],
    ['conventional', 'Conv'],
    ['va', 'VA'],
    ['non_qm', 'Non-QM'],
  ]
  const field = 'h-8 w-full rounded-md border bg-card px-2 text-sm tabular-nums'

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="mr-auto">
          <h3 className="text-lg font-bold">Build estimates</h3>
          <p className="text-sm text-muted-foreground">Pick programs, set each one's rate and down payment, and create a full estimate for every row at once.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <XIcon />
          Close
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card title="Programs" description="On this file + catalog" contentClassName="p-0">
          <div className="space-y-2 p-3">
            <SearchInput label="Search programs" value={search} onChange={setSearch} placeholder="Search programs or lenders…" />
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map(([k, label]) => (
                <button key={k} type="button" onClick={() => setFilter(k)} className={cn('rounded-full px-2.5 py-1 text-xs font-medium', filter === k ? 'bg-navy text-white' : 'bg-muted text-muted-foreground hover:text-foreground')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ul className="max-h-[28rem] divide-y overflow-y-auto border-t">
            {(catalog.isLoading || options.isLoading) && <li className="p-3 text-sm text-muted-foreground">Loading programs…</li>}
            {list.map((p) => {
              const on = rows.some((r) => r.programId === p.programId)
              return (
                <li key={p.programId}>
                  <label className={cn('flex cursor-pointer items-start gap-2.5 px-3 py-2', on && 'bg-primary/5')}>
                    <input type="checkbox" className="mt-1 size-4 accent-primary" checked={on} onChange={(e) => toggle(p, e.target.checked)} />
                    <span>
                      <span className="block text-sm font-semibold">{p.programName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.lenderName} · {PRODUCT_FAMILIES.label[p.family]}
                        {p.optionId && ' · on this file'}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
            {!catalog.isLoading && list.length === 0 && <li className="p-3 text-sm text-muted-foreground">No programs match. Add lenders and programs on the Lenders page, or type an estimate by hand with "One estimate from the loan".</li>}
          </ul>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">Checked programs appear as rows on the right →</p>
        </Card>

        <Card title={`Estimates to create · ${rows.length} row${rows.length === 1 ? '' : 's'}`} description={'Same program twice? Use "+ Add again" and change the rate, points, down payment or term.'} contentClassName="p-0">
          <div className="border-b bg-muted/30 p-3">
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Shared deal inputs · from the loan, used by every row</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {isPurchase && <CurrencyInput label="Purchase price" value={shared.purchasePrice} onChange={(v) => setShared({ ...shared, purchasePrice: v })} />}
              <CurrencyInput label={isPurchase ? 'Appraised value' : 'Value'} value={shared.propertyValue} onChange={(v) => setShared({ ...shared, propertyValue: v })} placeholder={isPurchase ? 'Same as price' : formatCurrency(base.propertyValue)} />
              <DateInput label="Closing date" value={shared.closingDate} onChange={(v) => setShared({ ...shared, closingDate: v })} />
              <Select label="Property" value={shared.propertyId} options={data.properties.map((p) => ({ value: p.id, label: p.addressLine }))} onChange={(v) => setShared({ ...shared, propertyId: v })} onClear={() => setShared({ ...shared, propertyId: null })} placeholder="TBD" />
              {isPurchase && <CurrencyInput label="Seller credit" value={shared.sellerCredits} onChange={(v) => setShared({ ...shared, sellerCredits: v })} />}
              {isPurchase && <CurrencyInput label="Earnest money" value={shared.earnestMoney} onChange={(v) => setShared({ ...shared, earnestMoney: v })} placeholder={formatCurrency(facts.earnestMoney)} />}
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Check one or more programs on the left. Each check adds a row.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="w-8 py-2 pl-3" />
                    <th className="py-2 font-medium">Program · label</th>
                    <th className="py-2 font-medium">Lender</th>
                    <th className="w-24 py-2 font-medium">Rate</th>
                    <th className="w-24 py-2 font-medium">Points / credit</th>
                    <th className="w-32 py-2 font-medium">{isPurchase ? 'Down payment' : 'Loan amount'}</th>
                    <th className="w-24 py-2 font-medium">Term</th>
                    <th className="py-2 font-medium">Preview</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r, i) => {
                    const p = previews[i]
                    const dupe = rows.findIndex((x) => x.programId === r.programId) !== i
                    return (
                      <tr key={r.key} className="align-top">
                        <td className="py-2 pl-3">
                          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">{i + 1}</span>
                        </td>
                        <td className="py-2 pr-2">
                          <span className="block font-semibold">
                            {r.programName}
                            {dupe && <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 uppercase">{names[i].match(/Option [A-Z]$/)?.[0] ?? 'again'}</span>}
                          </span>
                          <input aria-label={`Row ${i + 1} label`} className="mt-1 h-7 w-full rounded-md border border-transparent bg-transparent px-1 text-xs text-muted-foreground hover:border-border focus:border-ring focus:outline-none" value={r.label} placeholder={`“${names[i]}”`} onChange={(e) => update(r.key, { label: e.target.value })} />
                        </td>
                        <td className="py-2 pr-2">{r.lenderName}</td>
                        <td className="py-2 pr-2">
                          <NumberCell label={`Row ${i + 1} rate`} value={r.ratePct} suffix="%" className={field} onChange={(v) => update(r.key, { ratePct: v })} />
                        </td>
                        <td className="py-2 pr-2">
                          <NumberCell label={`Row ${i + 1} points`} value={r.pointsPct} suffix="pt" className={field} onChange={(v) => update(r.key, { pointsPct: v ?? 0 })} />
                        </td>
                        <td className="py-2 pr-2">
                          {isPurchase ? (
                            <>
                              <NumberCell label={`Row ${i + 1} down payment`} value={r.downPct} suffix="%" className={field} onChange={(v) => update(r.key, { downPct: v })} />
                              <span className="text-xs text-muted-foreground">{formatCurrency(p.downPayment)}</span>
                            </>
                          ) : (
                            <NumberCell label={`Row ${i + 1} loan amount`} value={r.loanAmount} className={field} onChange={(v) => update(r.key, { loanAmount: v })} />
                          )}
                        </td>
                        <td className="py-2 pr-2">
                          <select aria-label={`Row ${i + 1} term`} className={field} value={String(r.termMonths)} onChange={(e) => update(r.key, { termMonths: Number(e.target.value) })}>
                            {TERM_OPTIONS.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-2 whitespace-nowrap">
                          <span className="block font-semibold text-money tabular-nums">{formatCurrency(p.pitia)}/mo</span>
                          <span className="block text-xs text-muted-foreground tabular-nums">
                            {formatCurrency(Math.abs(p.cashToClose))} to close{p.dtiBack != null && ` · DTI ${formatPercent(p.dtiBack, 1)}`}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap">
                          <Button size="sm" variant="outline" onClick={() => again(r)}>
                            <PlusIcon />
                            Add again
                          </Button>
                          <Button size="icon-sm" variant="ghost" aria-label={`Remove row ${i + 1}`} onClick={() => remove(r.key)}>
                            <XIcon />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t p-3">
            <p className="mr-auto text-sm text-muted-foreground">
              Each row gets its own Smart Fees, payment, cash to close and DTI · saved as <b>Drafts</b>
            </p>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button className="bg-money text-white hover:bg-money/90" disabled={!rows.length || creating} onClick={create}>
              <SparklesIcon />
              {creating ? 'Creating…' : `Create ${rows.length || ''} estimate${rows.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

/** A number typed in a row (rate, points, down payment), kept as typed until you leave the cell. */
function NumberCell({ label, value, suffix, className, onChange }: { label: string; value: number | null; suffix?: string; className: string; onChange: (v: number | null) => void }) {
  const [text, setText] = useState<string | null>(null)
  return (
    <div className="relative">
      <input
        aria-label={label}
        inputMode="decimal"
        className={className}
        value={text ?? (value == null ? '' : String(value))}
        onFocus={(e) => (setText(value == null ? '' : String(value)), e.currentTarget.select())}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value.trim() === '' ? null : parseNumber(e.target.value))
        }}
        onBlur={() => setText(null)}
      />
      {suffix && <span className="pointer-events-none absolute top-1.5 right-2 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  )
}

