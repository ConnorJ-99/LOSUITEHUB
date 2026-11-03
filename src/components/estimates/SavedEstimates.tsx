import { useState } from 'react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, SearchInput } from '@/components/shared'
import { formatIsoDate } from '@/lib/dates'
import { estimateLender, estimateProgramName, estimateStatus, type Estimate, type EstimateStatus, type SavedFigures } from '@/lib/estimates/estimate'
import { formatCurrency, formatPercent } from '@/lib/format'

type Sort = 'edited' | 'created' | 'payment' | 'cash'

const STATUS_STYLE: Record<EstimateStatus, string> = {
  selected: 'bg-emerald-50 text-emerald-700',
  draft: 'bg-muted text-muted-foreground',
  archived: 'bg-rose-50 text-rose-700',
}
const STATUS_LABEL: Record<EstimateStatus, string> = { selected: 'Selected', draft: 'Draft', archived: 'Archived' }

export function StatusBadge({ status }: { status: EstimateStatus }) {
  return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase', STATUS_STYLE[status])}>{status === 'selected' ? 'Selected for file' : STATUS_LABEL[status]}</span>
}

const when = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  return d.toDateString() === today.toDateString() ? `Today ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Props {
  estimates: Estimate[]
  selectedId: string | null
  figuresOf: (e: Estimate) => SavedFigures
  checked: Set<string>
  onCheck: (id: string, on: boolean) => void
  onOpen: (id: string) => void
  onSelect: (e: Estimate) => void
  onRestore: (e: Estimate) => void
  isPurchase: boolean
  readOnly?: boolean
  /** Download the Loan Estimate PDF from the saved figures (closed files). */
  onPdf?: (e: Estimate) => void
}

/** Saved estimates: every estimate on the file with its saved numbers (a table on a computer, cards on a phone). */
export function SavedEstimates({ estimates, selectedId, figuresOf, checked, onCheck, onOpen, onSelect, onRestore, isPurchase, readOnly, onPdf }: Props) {
  const [search, setSearch] = useState('')
  const [program, setProgram] = useState('')
  const [sort, setSort] = useState<Sort>('edited')
  const [archived, setArchived] = useState(false)
  const programs = [...new Set(estimates.map((e) => estimateProgramName(e)).filter((x): x is string => !!x))].sort()
  const rows = estimates
    .filter((e) => archived || !e.archivedAt)
    .filter((e) => !search.trim() || e.name.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((e) => !program || estimateProgramName(e) === program)
    .map((e) => ({ e, f: figuresOf(e), status: estimateStatus(e, selectedId) }))
    .sort((a, b) => {
      if (sort === 'payment') return a.f.pitia - b.f.pitia
      if (sort === 'cash') return a.f.cashToClose - b.f.cashToClose
      if (sort === 'created') return b.e.createdAt.localeCompare(a.e.createdAt)
      return b.e.updatedAt.localeCompare(a.e.updatedAt)
    })
  const select = 'h-8 rounded-md border bg-card px-2 text-sm'
  const down = (f: SavedFigures, e: Estimate) => (isPurchase && e.purchasePrice ? formatPercent((f.downPayment / e.purchasePrice) * 100, 2) : '—')

  return (
    <Card title={`Saved estimates (${estimates.filter((e) => !e.archivedAt).length})`} description={readOnly ? 'Read only on a closed file. PDFs can still be downloaded from an open estimate.' : 'Autosaved · open any time · the selected one feeds the 1003, Overview, Prequal and letters'}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-64 max-w-full">
          <SearchInput value={search} onChange={setSearch} placeholder="Search estimates…" />
        </div>
        <select aria-label="Program" className={select} value={program} onChange={(e) => setProgram(e.target.value)}>
          <option value="">Program: All</option>
          {programs.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select aria-label="Sort" className={select} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="edited">Sort: Last edited</option>
          <option value="created">Sort: Created</option>
          <option value="payment">Sort: Payment</option>
          <option value="cash">Sort: Cash to close</option>
        </select>
        <label className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="size-4 accent-primary" />
          Show archived
        </label>
      </div>

      {/* Phones: cards. */}
      <div className="space-y-2 md:hidden">
        {rows.map(({ e, f, status }) => (
          <button key={e.id} type="button" onClick={() => onOpen(e.id)} className={cn('w-full rounded-lg border p-3 text-left', status === 'selected' && 'border-emerald-300 bg-emerald-50/40', status === 'archived' && 'opacity-60')}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{e.name}</span>
              <StatusBadge status={status} />
            </div>
            <p className="text-xs text-muted-foreground">{[estimateProgramName(e), estimateLender(e)].filter(Boolean).join(' · ')}</p>
            <p className="mt-1 text-sm tabular-nums">
              {formatPercent(f.ratePct)} · <span className="text-money">{formatCurrency(f.pitia)}/mo</span> · <span className="text-money">{formatCurrency(Math.abs(f.cashToClose))}</span> to close
            </p>
          </button>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="w-8 py-2" />
              <th className="py-2 font-medium">Estimate</th>
              <th className="py-2 font-medium">Program · lender</th>
              <th className="py-2 text-right font-medium">Rate</th>
              {isPurchase && <th className="py-2 text-right font-medium">Down</th>}
              <th className="py-2 text-right font-medium">Payment</th>
              <th className="py-2 text-right font-medium">Cash to close</th>
              <th className="py-2 pl-4 font-medium">Priced</th>
              <th className="py-2 font-medium">Last edited</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ e, f, status }) => (
              <tr key={e.id} className={cn('cursor-pointer hover:bg-muted/50', status === 'selected' && 'bg-emerald-50/50', status === 'archived' && 'text-muted-foreground')} onClick={() => onOpen(e.id)}>
                <td className="py-2.5" onClick={(ev) => ev.stopPropagation()}>
                  <input type="checkbox" aria-label={`Check ${e.name}`} disabled={status === 'archived'} checked={checked.has(e.id)} onChange={(ev) => onCheck(e.id, ev.target.checked)} className="size-4 accent-primary" />
                </td>
                <td className="py-2.5">
                  <span className="font-semibold">{e.name}</span>
                  {e.fromLoanId && <span className="block text-xs text-muted-foreground">From previous loan</span>}
                </td>
                <td className="py-2.5">{[estimateProgramName(e), estimateLender(e)].filter(Boolean).join(' · ') || '—'}</td>
                <td className="py-2.5 text-right tabular-nums">{formatPercent(f.ratePct)}</td>
                {isPurchase && <td className="py-2.5 text-right tabular-nums">{down(f, e)}</td>}
                <td className="py-2.5 text-right font-semibold text-money tabular-nums">{formatCurrency(f.pitia)}</td>
                <td className="py-2.5 text-right font-semibold text-money tabular-nums">{formatCurrency(Math.abs(f.cashToClose))}</td>
                <td className="py-2.5 pl-4">{e.quoteDate ? formatIsoDate(e.quoteDate) : e.pricedAt ? when(e.pricedAt) : '—'}</td>
                <td className="py-2.5">{when(e.updatedAt)}</td>
                <td className="py-2.5">
                  <StatusBadge status={status} />
                </td>
                <td className="py-2.5 text-right" onClick={(ev) => ev.stopPropagation()}>
                  {readOnly ? (
                    onPdf && (
                      <Button size="sm" variant="outline" onClick={() => onPdf(e)}>
                        PDF
                      </Button>
                    )
                  ) : status === 'archived' ? (
                    <Button size="sm" variant="outline" onClick={() => onRestore(e)}>
                      Restore
                    </Button>
                  ) : status === 'draft' ? (
                    <Button size="sm" className="bg-nurture text-white hover:bg-nurture/90" onClick={() => onSelect(e)}>
                      Select for this file
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => onOpen(e.id)}>
                      Open
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No estimates match.</p>}
    </Card>
  )
}
