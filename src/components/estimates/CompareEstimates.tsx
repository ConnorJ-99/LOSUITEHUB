import { useState } from 'react'
import { FileTextIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/shared'
import { useSavePdf } from '@/components/pdf/useSavePdf'
import { SendSavedPdf } from '@/components/messages/SendDocumentDialog'
import type { LoanProfile } from '@/lib/api/types'
import { round, type BreakEven } from '@/lib/calc'
import { nowIso } from '@/lib/dates'
import { LOAN_COMPARISON_TEMPLATE, MAX_COMPARISON_OPTIONS, loanComparison } from '@/lib/documents/loanComparison'
import { joinNames, worksheetFileName } from '@/lib/documents/feeWorksheet'
import {
  breakEvenAgainst,
  compareWinners,
  computeEstimate,
  estimateLender,
  estimateProgramName,
  estimateStatus,
  horizonCost,
  quoteFiguresOf,
  type CompareMetric,
  type Estimate,
  type EstimateDraft,
  type SavedFigures,
} from '@/lib/estimates/estimate'
import { formatCurrency, formatPercent, parseNumber } from '@/lib/format'
import { StatusBadge } from './SavedEstimates'
import { draftOf, type EstimateData } from './useEstimateData'

interface Props {
  loan: LoanProfile
  data: EstimateData
  estimates: Estimate[]
  selectedId: string | null
  readOnly: boolean
  onOpen: (id: string) => void
  onDuplicate: (e: Estimate) => void
  onSelect: (e: Estimate) => void
  onChangeForAll: () => void
  onClose: () => void
}

type Edit = Partial<Pick<EstimateDraft, 'noteRate' | 'loanAmount'>>

/** Compare: one column per estimate, the best value in each row highlighted, rate and down payment editable in place. */
export function CompareEstimates({ loan, data, estimates, selectedId, readOnly, onOpen, onDuplicate, onSelect, onChangeForAll, onClose }: Props) {
  const [years, setYears] = useState(5)
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const pdf = useSavePdf(loan)
  const isPurchase = loan.purpose === 'purchase'

  // Selected first, then the order they were made.
  const cols = [...estimates].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId))
  const figures = new Map<string, SavedFigures>(
    cols.map((e) => {
      const edit = edits[e.id]
      if (!edit) return [e.id, data.figuresOf(e)]
      const d = { ...draftOf(e), ...edit }
      return [e.id, computeEstimate(d, data.feesOf(e.id), data.templates, e.loanSnapshot?.facts ?? data.factsFor(e.propertyId)).saved]
    }),
  )
  const fig = (e: Estimate) => figures.get(e.id)!
  const winners = compareWinners(cols.map((e) => ({ id: e.id, figures: fig(e) })), years)
  const base = cols.find((e) => e.id === selectedId) ?? [...cols].sort((a, b) => horizonCost(fig(a), years) - horizonCost(fig(b), years))[0]

  const saveEdit = async (e: Estimate) => {
    const edit = edits[e.id]
    if (!edit) return
    try {
      await data.save(e, { ...draftOf(e), ...edit }, data.feesOf(e.id))
      await data.refresh()
      setEdits(({ [e.id]: _, ...rest }) => rest)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const borrowerNames = data.application.borrowers.map((b) => `${b.person.firstName} ${b.person.lastName}`)
  const savePdf = () => {
    const shown = cols.slice(0, MAX_COMPARISON_OPTIONS)
    const first = shown[0]
    const preparedAt = nowIso()
    const comparison = loanComparison({
      scenarioId: first.id,
      purpose: loan.purpose,
      scenarioName: data.properties.find((p) => p.id === first.propertyId)?.addressLine ?? first.name,
      hasProperty: !!first.propertyId,
      purchasePrice: first.purchasePrice,
      propertyValue: first.propertyValue ?? first.purchasePrice,
      loanAmount: fig(first).totalLoanAmount,
      product: [estimateProgramName(first), first.termMonths ? `${first.termMonths / 12}-year` : null].filter(Boolean).join(' · '),
      options: shown.map((e) => {
        const f = fig(e)
        return {
          programName: estimateProgramName(e) ?? e.name,
          quote: { id: e.id, optionId: e.programOptionId ?? '', pricingScenarioId: e.id, rate: f.ratePct ?? 0, lockDays: e.lockDays, pointsPct: e.pointsPct, lenderCredit: f.lenderCredit, closingCosts: f.closingCosts, closingCostsFromFeeSheet: false, monthlyMi: f.mi, quoteDate: e.quoteDate ?? preparedAt.slice(0, 10), notes: null },
          figures: { ...quoteFiguresOf(e.id, f, years), totalPayment: f.pitia },
          closingCosts: f.closingCosts,
        }
      }),
      borrowerNames,
      preparedAt,
      horizonYears: years,
    })
    return pdf.save({
      render: (lib, brand) => lib.loanComparisonPdf(comparison, brand),
      tooLong: 'Compare fewer estimates.',
      fileName: worksheetFileName('Loan Options', joinNames(borrowerNames), preparedAt),
      kind: 'loan_comparison',
      propertyId: first.propertyId,
      pricingScenarioId: first.id,
      templateVersion: LOAN_COMPARISON_TEMPLATE,
    })
  }

  const best = (metric: CompareMetric, e: Estimate) => winners[metric] === e.id
  const cell = (on: boolean, strong?: boolean) => cn('px-4 py-2 text-right tabular-nums', strong && 'font-semibold', on && 'text-nurture')
  const mark = (on: boolean, text: string, money?: boolean) => <span className={cn(on && 'rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-nurture', !on && money && 'text-money')}>{text}</span>
  const breakEvenText = (b: BreakEven, id: string) =>
    b.kind === 'same' ? 'same' : b.kind === 'never' ? (b.better === id ? 'never (lower cost)' : 'never (higher cost)') : `${Math.round(b.months)} months`
  const tint = (e: Estimate) => e.id === selectedId && 'bg-emerald-50/40'

  return (
    <div className="space-y-4">
      <SendSavedPdf loan={loan} docId={pdf.sendingId} onClose={pdf.closeSend} />
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto">
          <h3 className="text-lg font-bold">Compare estimates</h3>
          <p className="text-sm text-muted-foreground">{cols.length} estimates · best value in each row highlighted{readOnly ? '' : ' · edit rate or down payment in place'}</p>
        </div>
        <select aria-label="Horizon" className="h-7 rounded-md border bg-card px-2 text-sm" value={years} onChange={(e) => setYears(Number(e.target.value))}>
          {[3, 5, 7, 10].map((y) => (
            <option key={y} value={y}>
              Horizon: {y} yrs
            </option>
          ))}
        </select>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={onChangeForAll}>
            Change for all
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={savePdf} disabled={pdf.saving || !pdf.ready || cols.length === 0}>
          <FileTextIcon />
          {pdf.saving ? 'Making PDF…' : 'Download comparison PDF'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <XIcon />
          Close
        </Button>
      </div>
      {cols.length > MAX_COMPARISON_OPTIONS && <p className="text-xs text-muted-foreground">The PDF shows the first {MAX_COMPARISON_OPTIONS}. Check fewer in the saved list to choose which.</p>}
      <Card contentClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b">
                <th className="w-48" />
                {cols.map((e) => (
                  <th key={e.id} className={cn('px-4 py-3 text-right align-top font-normal', tint(e))}>
                    <span className="flex items-center justify-end gap-2">
                      <span className="font-semibold">{e.name}</span>
                      <StatusBadge status={estimateStatus(e, selectedId)} />
                    </span>
                    <span className="block text-xs text-muted-foreground">{[estimateProgramName(e), estimateLender(e)].filter(Boolean).join(' · ')}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              <Section span={cols.length + 1} label="Pricing" />
              <Row label="Rate">
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(best('rate', e)), tint(e))}>
                    {readOnly || e.id === selectedId ? (
                      mark(best('rate', e), formatPercent(fig(e).ratePct))
                    ) : (
                      <InlineNumber label={`${e.name} rate`} value={edits[e.id]?.noteRate ?? e.noteRate} suffix="%" onChange={(v) => setEdits((x) => ({ ...x, [e.id]: { ...x[e.id], noteRate: v } }))} onDone={() => saveEdit(e)} best={best('rate', e)} />
                    )}
                  </td>
                ))}
              </Row>
              <Row label="Points / credit">
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(false), tint(e))}>
                    {e.pointsPct > 0 ? `${e.pointsPct.toFixed(3)} pt · ${formatCurrency(round((fig(e).totalLoanAmount * e.pointsPct) / 100))}` : e.pointsPct < 0 ? `${e.pointsPct.toFixed(3)}%` : '—'}
                    {fig(e).lenderCredit > 0 && ` · ${formatCurrency(fig(e).lenderCredit)} credit`}
                  </td>
                ))}
              </Row>
              {isPurchase && (
                <Row label="Down payment">
                  {cols.map((e) => {
                    const f = fig(e)
                    const price = e.purchasePrice ?? 0
                    return (
                      <td key={e.id} className={cn(cell(false), tint(e))}>
                        {readOnly || e.id === selectedId || !price ? (
                          `${formatPercent(price ? (f.downPayment / price) * 100 : null, 2)} · ${formatCurrency(f.downPayment)}`
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <InlineNumber
                              label={`${e.name} down payment percent`}
                              value={round((f.downPayment / price) * 100, 3)}
                              suffix="%"
                              onChange={(v) => setEdits((x) => ({ ...x, [e.id]: { ...x[e.id], loanAmount: v == null ? e.loanAmount : round(price * (1 - v / 100), 0) } }))}
                              onDone={() => saveEdit(e)}
                            />
                            <span className="text-xs text-muted-foreground">{formatCurrency(f.downPayment)}</span>
                          </span>
                        )}
                      </td>
                    )
                  })}
                </Row>
              )}
              <Row label="Total loan amount">
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(false), tint(e))}>
                    {formatCurrency(fig(e).totalLoanAmount)}
                  </td>
                ))}
              </Row>
              <Section span={cols.length + 1} label="Monthly" />
              <Row label="Principal & interest">
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(false), tint(e))}>
                    {formatCurrency(fig(e).principalAndInterest)}
                  </td>
                ))}
              </Row>
              <Row label="Mortgage insurance">
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(false), tint(e))}>
                    {mark(best('mi', e), formatCurrency(fig(e).mi))}
                  </td>
                ))}
              </Row>
              <Row label="Taxes + insurance">
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(false), tint(e))}>
                    {formatCurrency(round(fig(e).taxes + fig(e).hoi))}
                  </td>
                ))}
              </Row>
              <Row label="Total payment" strong>
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(false, true), tint(e))}>
                    {mark(best('pitia', e), formatCurrency(fig(e).pitia), true)}
                  </td>
                ))}
              </Row>
              <Section span={cols.length + 1} label="At closing" />
              <Row label="Closing costs">
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(false), tint(e))}>
                    {mark(best('closingCosts', e), formatCurrency(fig(e).closingCosts))}
                  </td>
                ))}
              </Row>
              <Row label="Cash to close" strong>
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(false, true), tint(e))}>
                    {mark(best('cashToClose', e), fig(e).cashToClose < 0 ? `${formatCurrency(-fig(e).cashToClose)} back` : formatCurrency(fig(e).cashToClose), true)}
                  </td>
                ))}
              </Row>
              <Row label="Funds left after closing">
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(false), tint(e))}>
                    {mark(best('fundsLeft', e), `${formatCurrency(fig(e).fundsLeft)}${fig(e).reservesMonths != null ? ` · ${fig(e).reservesMonths} mo` : ''}`)}
                  </td>
                ))}
              </Row>
              <Row label="DTI (front / back)">
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(false), tint(e))}>
                    {mark(best('dtiBack', e), fig(e).dtiFront != null ? `${formatPercent(fig(e).dtiFront, 1)} / ${formatPercent(fig(e).dtiBack, 1)}` : '—')}
                  </td>
                ))}
              </Row>
              <Section span={cols.length + 1} label={`Over ${years} years`} />
              <Row label={`${years}-year cost`}>
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(false), tint(e))} title="Cash to close + P&I and MI over the horizon">
                    {mark(best('horizonCost', e), formatCurrency(Math.round(horizonCost(fig(e), years))))}
                  </td>
                ))}
              </Row>
              <Row label={`Break-even vs ${base && base.id === selectedId ? 'selected' : 'lowest cost'}`}>
                {cols.map((e) => (
                  <td key={e.id} className={cn(cell(false), tint(e))}>
                    {!base || e.id === base.id ? '—' : breakEvenText(breakEvenAgainst(e.id, fig(e), base.id, fig(base), years), e.id)}
                  </td>
                ))}
              </Row>
              <tr>
                <td />
                {cols.map((e) => (
                  <td key={e.id} className={cn('px-4 py-3 text-right whitespace-nowrap', tint(e))}>
                    <Button size="sm" variant="outline" onClick={() => onOpen(e.id)}>
                      Open
                    </Button>{' '}
                    {!readOnly && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => onDuplicate(e)}>
                          Duplicate
                        </Button>{' '}
                        {e.id === selectedId ? (
                          <span className="inline-flex h-7 items-center rounded-md border border-emerald-300 bg-emerald-50 px-2.5 text-[0.8rem] font-medium text-emerald-700">✓ Selected</span>
                        ) : (
                          <Button size="sm" className="bg-nurture text-white hover:bg-nurture/90" onClick={() => onSelect(e)}>
                            Select for this file
                          </Button>
                        )}
                      </>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground italic">Estimate. Final figures come from the lender's Loan Estimate.</p>
      </Card>
    </div>
  )
}

function Section({ label, span }: { label: string; span: number }) {
  return (
    <tr className="bg-muted/40">
      <td colSpan={span} className="px-4 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </td>
    </tr>
  )
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <tr>
      <td className={cn('px-4 py-2 text-muted-foreground', strong && 'font-semibold text-foreground')}>{label}</td>
      {children}
    </tr>
  )
}

function InlineNumber({ label, value, suffix, best, onChange, onDone }: { label: string; value: number | null; suffix: string; best?: boolean; onChange: (v: number | null) => void; onDone: () => void }) {
  const [text, setText] = useState<string | null>(null)
  return (
    <span className="relative inline-block">
      <input
        aria-label={label}
        inputMode="decimal"
        value={text ?? (value == null ? '' : value.toFixed(3))}
        onFocus={(e) => (setText(value == null ? '' : String(value)), e.currentTarget.select())}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value.trim() === '' ? null : parseNumber(e.target.value))
        }}
        onBlur={() => (setText(null), onDone())}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className={cn('h-8 w-24 rounded-md border-2 border-primary/60 bg-card pr-6 pl-2 text-right tabular-nums focus:border-primary focus:outline-none', best && 'text-nurture')}
      />
      <span className="pointer-events-none absolute top-1.5 right-2 text-xs text-muted-foreground">{suffix}</span>
    </span>
  )
}
