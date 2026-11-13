import { useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { CurrencyInput, FormGrid, PercentInput, Select, ToggleChip } from '@/components/shared'
import { MORTGAGE_TYPE_OPTIONS, TERM_OPTIONS } from '@/components/profile/options'
import { formatCurrency, formatPercent } from '@/lib/format'
import type { Catalog } from '@/lib/products/types'
import { BADGE_LABEL, downAmount, downPct, optionTitle, rateLooksRight, type OptionFigures, type QuoteBadge, type QuoteOption, type QuoteScenario } from '@/lib/quickquote/quote'
import { defaultTermMonths, MORTGAGE_TYPE_FOR } from '@/lib/quickquote/suggest'

const BADGE_CLASS: Record<QuoteBadge, string> = {
  recommended: 'bg-primary/10 text-primary',
  lowest_payment: 'bg-primary/10 text-primary',
  least_cash: 'bg-emerald-50 text-emerald-800',
}

const whole = (n: number | null | undefined) => (n == null ? '—' : formatCurrency(Math.round(n)))

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-3 text-sm', strong ? 'font-semibold' : 'text-muted-foreground')}>
      <span>{label}</span>
      <span className={cn('tabular-nums', strong ? 'text-base text-foreground' : 'text-foreground')}>{value}</span>
    </div>
  )
}

export interface OptionCardProps {
  option: QuoteOption
  figures: OptionFigures | null
  /** Its letter among the options on the quote (the PDF's letters); null when it's off the quote. */
  letter: string | null
  badges: QuoteBadge[]
  scenario: QuoteScenario
  catalog: Catalog | undefined
  onChange: (o: QuoteOption) => void
  onRecommend: (on: boolean) => void
  onRemove: () => void
}

/** One loan option: a summary of the figures, or (Edit option) its inputs. */
export function OptionCard({ option: o, figures: f, letter, badges, scenario, catalog, onChange, onRecommend, onRemove }: OptionCardProps) {
  const [editing, setEditing] = useState(o.ratePct == null)
  const set = (changes: Partial<QuoteOption>) => onChange({ ...o, ...changes })
  const purchase = scenario.purpose === 'purchase'
  const lenders = new Map(catalog?.lenders.map((l) => [l.id, l.name]) ?? [])
  const programOptions = (catalog?.programs ?? [])
    .filter((p) => p.active && p.lien === 'first')
    .map((p) => ({ value: p.id, label: `${lenders.get(p.lenderId) ?? 'Lender'} · ${p.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const pickProgram = (id: string) => {
    const p = catalog?.programs.find((x) => x.id === id)
    if (!p) return
    set({ programId: p.id, programName: p.name, lenderId: p.lenderId, lenderName: lenders.get(p.lenderId) ?? null, mortgageType: MORTGAGE_TYPE_FOR[p.family], termMonths: defaultTermMonths(p) })
  }
  const ownDown = o.downPayment ?? scenario.downPayment
  const lenderLine = [o.lenderName, o.programName].filter(Boolean).join(' · ')

  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-soft', o.recommended && 'border-2 border-primary', !o.onQuote && 'opacity-70')}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn('text-xs font-semibold tracking-wide uppercase', o.recommended ? 'text-primary' : 'text-muted-foreground')}>
          {letter ? `Option ${letter}` : 'Not on quote'}
          {o.recommended && ' · Recommended'}
        </p>
        <ToggleChip label="On quote" pressed={o.onQuote} onChange={(onQuote) => set({ onQuote })} className="shrink-0" />
      </div>

      <div>
        <p className="text-base font-semibold">{optionTitle(o)}</p>
        {badges.some((b) => b !== 'recommended') && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {badges
              .filter((b) => b !== 'recommended')
              .map((b) => (
                <span key={b} className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', BADGE_CLASS[b])}>
                  {BADGE_LABEL[b]}
                </span>
              ))}
          </div>
        )}
        <p className="mt-1 text-sm text-muted-foreground">{lenderLine || 'No lender picked'}</p>
      </div>

      {o.ratePct != null && (
        <p className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums">{formatPercent(o.ratePct, 3)}</span>
          <span className="text-xs text-muted-foreground">
            {o.pointsPct.toFixed(3)} pts{f && f.pointsAmount > 0 ? ` · ${whole(f.pointsAmount)}` : ''}
          </span>
        </p>
      )}
      {o.ratePct != null && !rateLooksRight(o.ratePct) && <p className="-mt-2 text-xs font-medium text-destructive">Check the rate: {formatPercent(o.ratePct, 3)} looks like a typo.</p>}

      {editing ? (
        <div className="space-y-3 rounded-lg bg-muted/50 p-3">
          <Select label="Lender & program" value={o.programId} options={programOptions} placeholder={catalog ? 'Pick from your lenders' : 'Loading lenders…'} onChange={pickProgram} onClear={() => set({ programId: null, programName: null, lenderId: null, lenderName: null })} />
          <FormGrid className="lg:grid-cols-2">
            <Select label="Loan type" value={o.mortgageType} options={MORTGAGE_TYPE_OPTIONS} onChange={(mortgageType) => set({ mortgageType })} />
            <Select label="Term" value={String(o.termMonths)} options={TERM_OPTIONS} onChange={(v) => set({ termMonths: Number(v) })} />
            <PercentInput label="Rate" value={o.ratePct} onChange={(ratePct) => set({ ratePct })} required error={o.ratePct != null && !rateLooksRight(o.ratePct) ? 'Check the rate' : undefined} />
            <PercentInput label="Points" value={o.pointsPct} onChange={(v) => set({ pointsPct: v ?? 0 })} />
            {purchase && (
              <>
                <CurrencyInput label="Down payment" value={ownDown} onChange={(downPayment) => set({ downPayment })} hint={o.downPayment == null ? 'Same as the scenario' : undefined} />
                <PercentInput label="Down %" value={downPct(scenario.purchasePrice, ownDown)} onChange={(v) => set({ downPayment: v == null ? null : downAmount(scenario.purchasePrice, v) })} />
              </>
            )}
            <CurrencyInput
              label="Closing costs"
              value={o.closingCostsOverride ?? f?.closingCostsEngine ?? null}
              onChange={(closingCostsOverride) => set({ closingCostsOverride })}
              hint={o.closingCostsOverride == null ? 'From your fee list, with points, prepaids and escrows' : `Typed over (fee list: ${whole(f?.closingCostsEngine)})`}
              span={2}
            />
          </FormGrid>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleChip label="Recommended" pressed={o.recommended} onChange={onRecommend} />
            <div className="flex gap-1.5">
              <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onRemove}>
                <Trash2Icon />
                Remove
              </Button>
              <Button type="button" size="sm" onClick={() => setEditing(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {f ? (
        <div className="space-y-1.5">
          <Line label={f.financedFee > 0 ? `Loan amount (with ${o.mortgageType === 'va' ? 'funding fee' : o.mortgageType === 'fha' ? 'UFMIP' : 'guarantee fee'})` : 'Loan amount'} value={whole(f.loanAmount)} />
          <Line label="Principal & interest" value={whole(f.principalAndInterest)} />
          <Line label="Mortgage insurance" value={f.mortgageInsurance > 0 ? whole(f.mortgageInsurance) : 'None'} />
          <Line label="Taxes & insurance" value={whole(f.taxesInsurance)} />
          <div className="mt-2 space-y-1.5 border-t pt-2">
            <Line label="Est. monthly" value={whole(f.totalMonthly)} strong />
            <Line label={`Est. ${f.cashLabel.toLowerCase()}${f.closingCostsEstimated ? '' : ' (typed costs)'}`} value={whole(f.cashAmount)} />
            <Line label="Est. APR" value={formatPercent(f.aprPct, 3)} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{o.ratePct == null ? 'Enter the rate and points to see the payment.' : purchase ? 'Add the price and down payment to see the payment.' : 'Add the value and loan balance to see the payment.'}</p>
      )}

      {!editing && (
        <Button type="button" variant="outline" className="mt-auto w-full" onClick={() => setEditing(true)}>
          Edit option
        </Button>
      )}
    </div>
  )
}
