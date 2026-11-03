import { useState } from 'react'
import { AlertTriangleIcon, PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CurrencyInput, NumberInput, confirmAction } from '@/components/shared'
import type { FeeOverride, FeeSection } from '@/lib/calc'
import { formatIsoDate } from '@/lib/dates'
import { applyChange, computeEstimate, estimateName, type ChangeField, type ChangeForAll, type Estimate, type EstimateDraft } from '@/lib/estimates/estimate'
import { formatCurrency } from '@/lib/format'
import { draftOf, type EstimateData } from './useEstimateData'

const FIELDS: { field: Exclude<ChangeField, 'fee'>; label: string; kind: 'money' | 'date' | 'days' }[] = [
  { field: 'closingDate', label: 'Closing date', kind: 'date' },
  { field: 'sellerCredits', label: 'Seller credit', kind: 'money' },
  { field: 'earnestMoney', label: 'Earnest money', kind: 'money' },
  { field: 'annualInsurance', label: "Homeowner's insurance (per year)", kind: 'money' },
  { field: 'annualTaxes', label: 'Property taxes (per year)', kind: 'money' },
  { field: 'monthlyHoa', label: 'HOA (per month)', kind: 'money' },
  { field: 'purchasePrice', label: 'Purchase price (same down %)', kind: 'money' },
  { field: 'lockDays', label: 'Lock days', kind: 'days' },
]

interface Row {
  id: number
  /** A field, or "fee:<key>". */
  what: string
  value: number | string | null
}

interface Props {
  data: EstimateData
  estimates: Estimate[]
  initial: string[]
  selectedId: string | null
  onSelectAgain: (e: Estimate) => Promise<void>
  onClose: () => void
}

/** Change for all: set a value once and apply it to the estimates you pick. Each keeps its other edits. */
export function ChangeForAllDialog({ data, estimates, initial, selectedId, onSelectAgain, onClose }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initial))
  const [rows, setRows] = useState<Row[]>([{ id: 1, what: 'closingDate', value: null }])
  const [busy, setBusy] = useState(false)

  const results = new Map(estimates.map((e) => [e.id, computeEstimate(draftOf(e), data.feesOf(e.id), data.templates, e.loanSnapshot?.facts ?? data.factsFor(e.propertyId))]))
  const fees = new Map<string, { section: FeeSection; name: string; amount: number }>()
  for (const r of results.values()) for (const l of r.priced.lines) if (l.key !== 'points' && !fees.has(l.key)) fees.set(l.key, { section: l.section, name: l.name, amount: l.atClosing })
  const toChange = (r: Row): ChangeForAll => {
    if (r.what.startsWith('fee:')) {
      const key = r.what.slice(4)
      const f = fees.get(key)!
      return { field: 'fee', value: r.value, fee: { key, section: f.section, name: f.name } }
    }
    return { field: r.what as ChangeField, value: r.value }
  }
  const ready = rows.filter((r) => r.value !== null && r.value !== '')
  const apply = (e: Estimate): { draft: EstimateDraft; overrides: FeeOverride[] } => {
    let draft = draftOf(e)
    let overrides = data.feesOf(e.id)
    for (const r of ready) {
      const c = applyChange(draft, toChange(r), overrides)
      draft = { ...draft, ...c.changes }
      if (c.fee) overrides = [...overrides.filter((o) => o.key !== c.fee!.key), c.fee]
    }
    return { draft, overrides }
  }
  const chosen = estimates.filter((e) => picked.has(e.id))
  const preview = chosen.map((e) => {
    const before = results.get(e.id)!.saved
    const { draft, overrides } = apply(e)
    const after = computeEstimate(draft, overrides, data.templates, e.loanSnapshot?.facts ?? data.factsFor(e.propertyId)).saved
    const changedFees = new Set(ready.filter((r) => r.what.startsWith('fee:')).map((r) => r.what.slice(4)))
    const kept = data.feesOf(e.id).filter((o) => !changedFees.has(o.key)).length
    return { e, before, after, kept }
  })
  const wasText = (r: Row) => {
    const first = chosen[0]
    if (!first) return ''
    if (r.what.startsWith('fee:')) return `now ${formatCurrency(results.get(first.id)!.priced.lines.find((l) => l.key === r.what.slice(4))?.atClosing ?? 0)}`
    const d = draftOf(first)
    const facts = first.loanSnapshot?.facts
    const map: Record<string, string> = {
      closingDate: d.estimatedFundingDate ? `was ${formatIsoDate(d.estimatedFundingDate)}` : 'was blank',
      sellerCredits: `was ${formatCurrency(d.sellerCredits ?? facts?.sellerCredits ?? 0)}`,
      earnestMoney: `was ${formatCurrency(d.earnestMoney ?? facts?.earnestMoney ?? 0)}`,
      annualInsurance: `was ${formatCurrency(results.get(first.id)!.saved.hoi * 12)}/yr`,
      annualTaxes: `was ${formatCurrency(results.get(first.id)!.saved.taxes * 12)}/yr`,
      monthlyHoa: `was ${formatCurrency(d.monthlyHoa ?? 0)}`,
      purchasePrice: `was ${formatCurrency(d.purchasePrice)}`,
      lockDays: d.lockDays ? `was ${d.lockDays} days` : 'was blank',
    }
    return map[r.what] ?? ''
  }

  const go = async () => {
    if (!ready.length) return toast.error('Set at least one new value.')
    setBusy(true)
    let done = 0
    try {
      for (const e of chosen) {
        const { draft, overrides } = apply(e)
        if (e.id === selectedId) {
          const update = await confirmAction(`"${e.name}" is Selected for the file. Update the file too? Choose "Keep the file" to save this change as a new Draft instead.`, { confirmLabel: 'Yes, update the file', cancelLabel: 'Keep the file' })
          if (update) {
            const saved = await data.save(e, draft, overrides)
            await data.refresh()
            await onSelectAgain({ ...e, ...saved })
          } else {
            await data.create({ ...draft, name: estimateName(`${e.name} (changed)`, data.list.map((x) => x.name)), archivedAt: null }, overrides)
          }
        } else {
          await data.save(e, draft, overrides)
        }
        done++
      }
      await data.refresh()
      toast.success(`Changed ${done} estimate${done > 1 ? 's' : ''}`)
      onClose()
    } catch (err) {
      await data.refresh()
      toast.error(`Changed ${done} of ${chosen.length}: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const fieldSelect = 'h-9 w-full rounded-md border bg-card px-2 text-sm'
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Change for all</DialogTitle>
          <DialogDescription>Set a value once and apply it to the estimates you pick. Each estimate keeps its other edits.</DialogDescription>
        </DialogHeader>

        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">1 · Apply to</p>
        <div className="flex flex-wrap gap-2">
          {estimates.map((e) => (
            <label key={e.id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm', picked.has(e.id) && 'border-primary bg-primary/5')}>
              <input type="checkbox" className="size-4 accent-primary" checked={picked.has(e.id)} onChange={(ev) => setPicked((p) => (ev.target.checked ? new Set([...p, e.id]) : new Set([...p].filter((x) => x !== e.id))))} />
              {e.name}
              {e.id === selectedId && <span className="rounded bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-700 uppercase">Selected</span>}
            </label>
          ))}
        </div>

        <p className="mt-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">2 · What changes</p>
        <div className="space-y-2">
          {rows.map((r) => {
            const def = FIELDS.find((f) => f.field === r.what)
            const set = (value: number | string | null) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, value } : x)))
            return (
              <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                <select aria-label="Field" className={fieldSelect} value={r.what} onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, what: e.target.value, value: null } : x)))}>
                  {FIELDS.map((f) => (
                    <option key={f.field} value={f.field}>
                      {f.label}
                    </option>
                  ))}
                  <optgroup label="A fee">
                    {[...fees.entries()].map(([key, f]) => (
                      <option key={key} value={`fee:${key}`}>
                        Fee: {f.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {def?.kind === 'date' ? (
                  <input type="date" aria-label="New value" className={fieldSelect} value={(r.value as string) ?? ''} onChange={(e) => set(e.target.value || null)} />
                ) : def?.kind === 'days' ? (
                  <NumberInput label="New value" hideLabel value={(r.value as number) ?? null} onChange={set} maxDecimals={0} suffix="days" />
                ) : (
                  <CurrencyInput label="New value" hideLabel value={(r.value as number) ?? null} onChange={set} />
                )}
                <span className="flex h-9 items-center rounded-md bg-muted px-3 text-sm text-muted-foreground">{wasText(r)}</span>
                <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.id !== r.id) : rs))}>
                  <XIcon />
                </Button>
              </div>
            )
          })}
          <Button size="sm" variant="link" onClick={() => setRows((rs) => [...rs, { id: Math.max(...rs.map((x) => x.id)) + 1, what: 'sellerCredits', value: null }])}>
            <PlusIcon />
            Add a field
          </Button>
        </div>

        <p className="mt-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">3 · Preview</p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Estimate</th>
                <th className="px-3 py-2 text-right font-medium">Payment</th>
                <th className="px-3 py-2 text-right font-medium">Cash to close</th>
                <th className="px-3 py-2 text-right font-medium">Kept edits</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {preview.map(({ e, before, after, kept }) => (
                <tr key={e.id}>
                  <td className="px-3 py-2">{e.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(before.pitia)} → <span className="text-money">{formatCurrency(after.pitia)}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(Math.abs(before.cashToClose))} → <span className="text-money">{formatCurrency(Math.abs(after.cashToClose))}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-money">{kept ? `${kept} fee edit${kept > 1 ? 's' : ''} kept` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {chosen.some((e) => e.id === selectedId) && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangleIcon className="size-3.5" />"{chosen.find((e) => e.id === selectedId)!.name}" is <b className="text-nurture">Selected for file</b>. You'll be asked whether to update the file too.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={go} disabled={busy || !chosen.length || !ready.length}>
            {busy ? 'Applying…' : `Apply to ${chosen.length} estimate${chosen.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

