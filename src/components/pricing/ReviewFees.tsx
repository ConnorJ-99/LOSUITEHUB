import { useState } from 'react'
import { PlusIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, CurrencyInput, FormGrid, Input, NumberInput, Select, ToggleChip } from '@/components/shared'
import { pointsPct, round, type FeeLine, type FeeOverride, type FeeSection, type PaidBy, type SectionTotals } from '@/lib/calc'
import { FEE_SECTION_LABEL, PAID_BY_LABEL, useResetFee, useSaveFee } from '@/lib/api/pricing'
import { formatCurrency, parseNumber } from '@/lib/format'
import type { LoanPurpose } from '@/lib/pipeline/stages'
import { defaultMonths, type PricingScenario, type ScenarioDraft } from '@/lib/pricing/scenario'

const SECTIONS: FeeSection[] = ['A', 'B', 'C', 'E', 'F', 'G', 'H']
const PAID_BY: PaidBy[] = ['B', 'S', 'L', 'O']

interface Props {
  scenario: PricingScenario
  organizationId: string
  purpose: LoanPurpose
  draft: ScenarioDraft
  setDraft: React.Dispatch<React.SetStateAction<ScenarioDraft>>
  lines: FeeLine[]
  totals: SectionTotals
  overrides: FeeOverride[]
  closingCosts: number
  totalLoanAmount: number
  noFeeList: boolean
}

/** Review Fees: sections A–H. Typing over a fee saves an edit for this scenario (with a reset); points edit the scenario's points. */
export function ReviewFees({ scenario, organizationId, purpose, draft, setDraft, lines, totals, overrides, closingCosts, totalLoanAmount, noFeeList }: Props) {
  const saveFee = useSaveFee(scenario, organizationId)
  const reset = useResetFee(scenario.id)
  const [adding, setAdding] = useState(false)
  const months = defaultMonths(purpose)
  const set = <K extends keyof ScenarioDraft>(key: K) => (value: ScenarioDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const done = { onError: (e: Error) => toast.error(e.message) }

  /** Saves a change to one line. Amounts not typed keep following the calculation. */
  const change = (line: FeeLine, patch: Partial<Pick<FeeOverride, 'atClosing' | 'beforeClosing' | 'paidBy'>>) => {
    if (line.key === 'points') {
      if (patch.atClosing !== undefined) set('pointsPct')(pointsPct(patch.atClosing ?? 0, totalLoanAmount))
      return
    }
    const existing = overrides.find((o) => o.key === line.key)
    const base: FeeOverride = existing ?? { key: line.key, section: line.section, name: line.name, atClosing: null, beforeClosing: null, paidBy: line.paidBy, apr: line.apr, paidTo: line.paidTo, custom: line.custom }
    saveFee.mutate({ ...base, ...patch }, done)
  }

  const sectionExtras: Partial<Record<FeeSection, React.ReactNode>> = {
    F: (
      <>
        <NumberInput label="Interest days" value={draft.prepaidInterestDays} onChange={set('prepaidInterestDays')} maxDecimals={0} placeholder="From funding date" />
        <NumberInput label="Insurance months" value={draft.hoiPrepaidMonths} onChange={set('hoiPrepaidMonths')} maxDecimals={0} placeholder={String(months.hoiPrepaid)} />
        <NumberInput label="Tax months" value={draft.taxPrepaidMonths} onChange={set('taxPrepaidMonths')} maxDecimals={0} placeholder={String(months.taxPrepaid)} />
      </>
    ),
    G: (
      <>
        <NumberInput label="Insurance months" value={draft.hoiReserveMonths} onChange={set('hoiReserveMonths')} maxDecimals={0} placeholder={String(months.hoiReserve)} />
        <NumberInput label="Tax months" value={draft.taxReserveMonths} onChange={set('taxReserveMonths')} maxDecimals={0} placeholder={String(months.taxReserve)} />
        <NumberInput label="MI months" value={draft.miReserveMonths} onChange={set('miReserveMonths')} maxDecimals={0} placeholder={String(months.miReserve)} />
        <CurrencyInput label="Aggregate adjustment" value={draft.aggregateAdjustment} onChange={(v) => set('aggregateAdjustment')(v ?? 0)} />
      </>
    ),
  }

  return (
    <Card
      title="Review fees"
      description={noFeeList ? 'Your fee list in Settings is empty, so only points, prepaids and escrows are shown. Add fees here or in Settings.' : 'Type over a fee to change it for this scenario. Only fees the borrower pays count in the totals.'}
      action={
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <PlusIcon />
          Add fee
        </Button>
      }
    >
      <div className="space-y-5">
        {SECTIONS.map((section) => {
          const rows = lines.filter((l) => l.section === section)
          return (
            <section key={section}>
              <div className="flex items-baseline justify-between border-b pb-1">
                <h3 className="text-sm font-semibold">{FEE_SECTION_LABEL[section]}</h3>
                <span className="text-sm font-semibold tabular-nums">{formatCurrency(totals[section])}</span>
              </div>
              {section === 'G' && draft.impoundWaiver === 'all' && <p className="pt-1 text-xs text-muted-foreground">Escrows waived: no initial escrow payment.</p>}
              {sectionExtras[section] && <FormGrid className="pt-2 lg:grid-cols-4">{sectionExtras[section]}</FormGrid>}
              {rows.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">None</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                        <th className="py-1 font-medium">Fee</th>
                        <th className="py-1 font-medium">Paid by</th>
                        <th className="py-1 text-right font-medium">At closing</th>
                        <th className="py-1 text-right font-medium">Before closing</th>
                        <th className="w-20" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.map((l) => (
                        <tr key={l.key} className={l.paidBy !== 'B' ? 'text-muted-foreground' : undefined}>
                          <td className="py-1 pr-3">
                            <span className="flex items-center gap-1.5">
                              {l.edited && <span className="size-1.5 shrink-0 rounded-full bg-primary" title="Changed on this scenario" />}
                              {l.name}
                              {l.apr && <span className="text-[10px] text-muted-foreground">APR</span>}
                              {l.custom && <span className="text-[10px] text-muted-foreground">added</span>}
                            </span>
                            {l.paidTo && <span className="block text-xs text-muted-foreground">to {l.paidTo}</span>}
                          </td>
                          <td className="py-1 pr-3">
                            {l.key === 'points' ? (
                              <span className="text-xs">Borrower</span>
                            ) : (
                              <select aria-label={`${l.name} paid by`} value={l.paidBy} onChange={(e) => change(l, { paidBy: e.target.value as PaidBy })} className="h-8 rounded-md border bg-transparent px-1.5 text-xs text-foreground">
                                {PAID_BY.map((p) => (
                                  <option key={p} value={p}>
                                    {PAID_BY_LABEL[p]}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="py-1 pr-2 text-right">
                            <MoneyCell label={`${l.name} at closing`} value={l.atClosing} onCommit={(v) => change(l, { atClosing: v })} />
                          </td>
                          <td className="py-1 pr-2 text-right">
                            {l.key === 'points' ? null : <MoneyCell label={`${l.name} before closing`} value={l.beforeClosing} onCommit={(v) => change(l, { beforeClosing: v })} />}
                          </td>
                          <td className="py-1 text-right">
                            {l.edited && (
                              <Button size="sm" variant="ghost" title={`Back to ${formatCurrency(l.calculated)}`} disabled={reset.isPending} onClick={() => reset.mutate(l.key, done)}>
                                <RotateCcwIcon />
                                Reset
                              </Button>
                            )}
                            {l.custom && (
                              <Button size="sm" variant="ghost" title="Remove this fee" disabled={reset.isPending} onClick={() => reset.mutate(l.key, done)}>
                                <XIcon />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        })}
        <dl className="ml-auto max-w-xs space-y-1 border-t pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Total A–H</dt>
            <dd className="tabular-nums">{formatCurrency(round(closingCosts + draft.lenderCredit))}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Lender credit</dt>
            <dd className="tabular-nums">{draft.lenderCredit ? `−${formatCurrency(draft.lenderCredit)}` : '$0'}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>Total closing costs</dt>
            <dd className="tabular-nums">{formatCurrency(closingCosts)}</dd>
          </div>
        </dl>
      </div>
      {adding && <AddFeeDialog onClose={() => setAdding(false)} onSave={(o) => saveFee.mutateAsync(o)} />}
    </Card>
  )
}

/** An amount typed in a table cell, saved when you leave the cell or press Enter. */
function MoneyCell({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    if (text !== null) {
      const next = round(parseNumber(text) ?? 0)
      if (next !== value) onCommit(next)
    }
    setText(null)
  }
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={text ?? (value ? formatCurrency(value) : '')}
      placeholder="$0"
      onFocus={(e) => {
        setText(value ? String(value) : '')
        e.currentTarget.select()
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="h-8 w-28 rounded-md border border-transparent bg-transparent px-2 text-right text-sm tabular-nums hover:border-border focus:border-ring focus:outline-none"
    />
  )
}

function AddFeeDialog({ onClose, onSave }: { onClose: () => void; onSave: (o: FeeOverride) => Promise<unknown> }) {
  const [f, setF] = useState({ section: 'H' as FeeSection, name: '', amount: null as number | null, paidBy: 'B' as PaidBy, paidTo: '', apr: false })
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!f.name.trim()) return toast.error('The fee needs a name.')
    setSaving(true)
    try {
      await onSave({ key: `custom_${Date.now().toString(36)}`, section: f.section, name: f.name.trim(), atClosing: f.amount ?? 0, beforeClosing: null, paidBy: f.paidBy, apr: f.apr, paidTo: f.paidTo.trim() || null, custom: true })
      toast.success('Fee added')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a fee</DialogTitle>
          <DialogDescription>Added to this scenario only. To add it to every file, use the fee list in Settings.</DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-2">
          <Input label="Fee name" value={f.name} onChange={(name) => setF({ ...f, name })} required span={2} />
          <Select label="Section" value={f.section} options={SECTIONS.map((s) => ({ value: s, label: FEE_SECTION_LABEL[s] }))} onChange={(section) => setF({ ...f, section })} span={2} />
          <CurrencyInput label="Amount at closing" value={f.amount} onChange={(amount) => setF({ ...f, amount })} />
          <Select label="Paid by" value={f.paidBy} options={PAID_BY.map((p) => ({ value: p, label: PAID_BY_LABEL[p] }))} onChange={(paidBy) => setF({ ...f, paidBy })} />
          <Input label="Paid to" value={f.paidTo} onChange={(paidTo) => setF({ ...f, paidTo })} span={2} />
        </FormGrid>
        <ToggleChip label="Counts in the APR" pressed={f.apr} onChange={(apr) => setF({ ...f, apr })} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Add fee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
