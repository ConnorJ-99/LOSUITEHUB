import type { ReactNode } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { confirmAction, CurrencyInput, NumberInput, PercentInput, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { CalcLines } from '@/components/income/CalcLines'
import { useUpdateLoanDetails } from '@/lib/api/loans'
import type { LoanProfile } from '@/lib/api/types'
import { APPROVAL_LIMIT_LABELS, APPROVAL_LOAN_TYPES, approvalTypeFor, mortgageTypeFor, type ApprovalLoanType, type ConcessionOccupancy, type IncomeLine, type MaxApprovalResult } from '@/lib/calc'
import { formatCurrency, formatPercent } from '@/lib/format'
import { changeLoanType, type PrequalLoan } from '@/lib/prequal/draft'
import { approvalDefaults, type ApprovalFacts, type ApprovalForm } from '@/lib/prequal/maxApproval'
import { CollapsibleCard, Fold } from './Fold'
import { TERMS } from './options'

const OCCUPANCIES: { value: ConcessionOccupancy; label: string }[] = [
  { value: 'primary', label: 'Primary home' },
  { value: 'second_home', label: 'Second home' },
  { value: 'investment', label: 'Investment' },
]

/**
 * Max approval as one compact card for the 1003's side column (Connor,
 * 2026-11-19 layout): loan type, the six main inputs, the rest in rows that
 * open, the answer, and Save to 1003 / Send prequal results. The inputs and
 * math are unchanged: loan type, rate and term save with Save to 1003;
 * everything else is a what-if (blank = the 1003 or the loan type's default).
 */
export function MaxApprovalCard({
  loan,
  draftLoan,
  onLoanChange,
  form,
  onChange,
  facts,
  result,
  saveButton,
  sendResults,
}: {
  loan: LoanProfile
  draftLoan: PrequalLoan
  onLoanChange: (next: PrequalLoan) => void
  form: ApprovalForm
  onChange: (next: ApprovalForm) => void
  facts: ApprovalFacts
  result: MaxApprovalResult
  saveButton: ReactNode
  sendResults: ReactNode
}) {
  const type = approvalTypeFor(draftLoan.mortgageType)
  const def = approvalDefaults(type, form, facts)
  const set = <K extends keyof ApprovalForm>(key: K) => (value: ApprovalForm[K]) => onChange({ ...form, [key]: value })
  const ph = (n: number | null, decimals = 0) => (n === null ? undefined : n.toLocaleString('en-US', { maximumFractionDigits: decimals }))
  const limitHint =
    type === 'va' ? 'VA with full entitlement: no county limit' : type === 'non_qm' ? 'Non-QM: no county limit' : form.loanLimit !== null ? 'This file only; clear to use Settings' : def.loanLimit === null ? 'Not set in Settings → Company' : 'From Settings → Company'
  const m = result.max

  return (
    <CollapsibleCard title="Max approval" summary={m ? `${formatCurrency(m.price)} · limited by ${result.limitedBy ? APPROVAL_LIMIT_LABELS[result.limitedBy].toLowerCase() : 'nothing'}` : 'DTI, payment, cash & limit'}>
      <ToggleChipGroup>
        {APPROVAL_LOAN_TYPES.map((t) => (
          <ToggleChip key={t.value} label={t.label} pressed={type === t.value} onChange={() => onLoanChange(changeLoanType(draftLoan, mortgageTypeFor(t.value)))} />
        ))}
      </ToggleChipGroup>

      {/* The six inputs used most; blank ones use the 1003 or the loan type's default (shown as the placeholder). */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <PercentInput label="Rate" value={draftLoan.noteRate} onChange={(noteRate) => onLoanChange({ ...draftLoan, noteRate })} maxDecimals={3} />
        <PercentInput label="Down" value={form.downPaymentPct} onChange={set('downPaymentPct')} maxDecimals={2} placeholder={ph(def.downPaymentPct, 2)} />
        <PercentInput label="Max DTI" value={form.maxDtiPct} onChange={set('maxDtiPct')} maxDecimals={2} placeholder={ph(def.maxDtiPct, 2)} />
        <CurrencyInput label="Income" value={form.monthlyIncome} onChange={set('monthlyIncome')} placeholder={ph(def.monthlyIncome)} />
        <CurrencyInput label="Debts" value={form.monthlyDebts} onChange={set('monthlyDebts')} placeholder={ph(def.monthlyDebts)} />
        <CurrencyInput label="Assets" value={form.assets} onChange={set('assets')} placeholder={ph(def.assets)} />
      </div>
      <p className="mt-1 text-[0.7rem] text-muted-foreground">Monthly income and debts and verified assets come from the 1003 when blank.</p>

      <div className="mt-2 border-t">
        <Fold title="Loan settings">
          <ToggleChipGroup>
            {OCCUPANCIES.map((o) => (
              <ToggleChip key={o.value} label={o.label} pressed={form.occupancy === o.value} onChange={() => onChange({ ...form, occupancy: o.value })} />
            ))}
          </ToggleChipGroup>
          <ToggleChipGroup>
            {TERMS.map((t) => (
              <ToggleChip key={t.months} label={t.label} pressed={draftLoan.termMonths === t.months} onChange={() => onLoanChange({ ...draftLoan, termMonths: t.months })} />
            ))}
          </ToggleChipGroup>
          <div className="grid grid-cols-2 gap-2">
            <CurrencyInput label="Max payment" value={form.maxMonthlyPayment} onChange={set('maxMonthlyPayment')} hint="Optional: what they want to stay under" />
            <CurrencyInput label="Gift funds" value={form.giftAmount} onChange={set('giftAmount')} placeholder={ph(def.giftAmount)} hint="Blank: the 1003's gifts" />
            <NumberInput label="Reserves (months)" value={form.reserveMonths} onChange={set('reserveMonths')} maxDecimals={1} placeholder={ph(def.reserveMonths)} hint={form.reserveMonths === null ? 'Default for the occupancy' : undefined} />
          </div>
          {type === 'non_qm' && <ToggleChip label="Lender allows gift funds" pressed={form.nonQmAllowsGift} onChange={set('nonQmAllowsGift')} />}
        </Fold>
        <Fold title="Taxes, insurance, HOA & MI">
          <div className="grid grid-cols-2 gap-2">
            <PercentInput label="Property tax / year" value={form.taxRatePct} onChange={set('taxRatePct')} maxDecimals={3} placeholder={ph(def.taxRatePct, 3)} hint="Percent of the price" />
            <PercentInput label="Insurance / year" value={form.insuranceRatePct} onChange={set('insuranceRatePct')} maxDecimals={3} placeholder={ph(def.insuranceRatePct, 3)} hint="Percent of the price" />
            <CurrencyInput label="HOA / month" value={form.monthlyHoa} onChange={set('monthlyHoa')} />
            {type === 'fha' ? (
              <PercentInput label="MIP / year" value={null} readOnly placeholder="By HUD's schedule" hint="0.55% (0.50% at 5%+ down) + 1.75% financed" />
            ) : type === 'va' ? (
              <PercentInput label="VA funding fee" value={draftLoan.upfrontFeePct} onChange={(upfrontFeePct) => onLoanChange({ ...draftLoan, upfrontFeePct })} maxDecimals={3} placeholder="By the VA chart" hint={draftLoan.upfrontFeePct === null ? 'Financed; no monthly MI' : 'Clear to use the VA chart'} />
            ) : (
              <PercentInput label="MI rate / year" value={form.miRatePct} onChange={set('miRatePct')} maxDecimals={3} placeholder={type === 'conventional' ? '0.5' : '0'} hint={type === 'conventional' ? 'Blank: 0.5% over 80% LTV' : 'Blank: none'} />
            )}
          </div>
          {type === 'va' && <ToggleChip label="Exempt from the funding fee (disability)" pressed={draftLoan.upfrontFeePct === 0} onChange={(on) => onLoanChange({ ...draftLoan, upfrontFeePct: on ? 0 : null })} />}
        </Fold>
        <Fold title="Seller concessions & loan limit">
          <div className="grid grid-cols-2 gap-2">
            <PercentInput label="Seller concessions" value={form.sellerConcessionPct} onChange={set('sellerConcessionPct')} maxDecimals={2} placeholder="0" hint="Percent of the price" />
            {type === 'non_qm' && <PercentInput label="Lender's concession cap" value={form.nonQmConcessionCapPct} onChange={set('nonQmConcessionCapPct')} maxDecimals={2} placeholder={ph(def.nonQmConcessionCapPct)} />}
            <CurrencyInput label="County loan limit" value={form.loanLimit} onChange={set('loanLimit')} placeholder={ph(def.loanLimit)} readOnly={type === 'va' || type === 'non_qm'} hint={limitHint} />
          </div>
        </Fold>
      </div>

      {/* The answer. */}
      <div className="mt-3 rounded-lg bg-muted/60 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.65rem] font-bold tracking-widest text-muted-foreground uppercase">Max price</p>
            <p className="text-xl font-semibold tabular-nums">{m ? formatCurrency(m.price) : '—'}</p>
            {m && (
              <p className="text-xs text-muted-foreground tabular-nums">
                Loan {formatCurrency(m.loanAmount)} · {formatCurrency(m.downPayment)} down{m.ltv !== null && ` · ${formatPercent(m.ltv, 2)} LTV`}
              </p>
            )}
          </div>
          <p className="max-w-40 text-right text-xs text-muted-foreground">
            {m
              ? <>Limited by <span className="font-medium text-foreground">{result.limitedBy ? APPROVAL_LIMIT_LABELS[result.limitedBy] : 'nothing up to $20M'}</span></>
              : result.missing ?? `No price passes: ${result.limitedBy ? APPROVAL_LIMIT_LABELS[result.limitedBy] : 'a limit'} fails even at the lowest price.`}
          </p>
        </div>
        {m && (
          <div className="mt-2 border-t">
            <Fold title={<span className="text-xs text-muted-foreground">Payment, cash and concessions</span>}>
              <ResultDetails loan={loan} loanType={type} result={result} />
            </Fold>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {saveButton}
        {sendResults}
      </div>
    </CollapsibleCard>
  )
}

/** The breakdown under the answer: payment, DTI, cash, concessions, gifts, and Save as Approval Limits. */
function ResultDetails({ loan, loanType, result }: { loan: LoanProfile; loanType: ApprovalLoanType; result: MaxApprovalResult }) {
  const update = useUpdateLoanDetails(loan.id)
  const m = result.max!
  const saved = { price: loan.details.preapprovalMaxPrice, loanAmount: loan.details.preapprovalMaxLoanAmount }
  const alreadySaved = saved.price === m.price && saved.loanAmount === m.loanAmount

  const onSave = async () => {
    if (saved.price != null && !(await confirmAction(`Replace the Approval Limits (${formatCurrency(saved.price)} price, ${formatCurrency(saved.loanAmount)} loan) with ${formatCurrency(m.price)} and ${formatCurrency(m.loanAmount)}? Letters already issued don't change.`, { confirmLabel: 'Replace' }))) return
    update.mutate(
      { preapprovalMaxPrice: m.price, preapprovalMaxLoanAmount: m.loanAmount },
      { onSuccess: () => toast.success('Saved as Approval Limits for the letters'), onError: (e) => toast.error(e.message) },
    )
  }

  const p = m.payment
  const paymentLines: IncomeLine[] = [
    { label: 'Principal and interest', amount: p.principalAndInterest },
    { label: 'Taxes', amount: p.taxes, kind: 'add' },
    { label: 'Insurance', amount: p.insurance, kind: 'add' },
    ...(p.mortgageInsurance ? [{ label: 'Mortgage insurance', amount: p.mortgageInsurance, kind: 'add' as const }] : []),
    ...(p.hoa ? [{ label: 'HOA', amount: p.hoa, kind: 'add' as const }] : []),
    { label: 'Total payment', amount: p.total, kind: 'result' },
  ]
  const c = m.concessions
  const cashLines: IncomeLine[] = [
    { label: 'Down payment', amount: m.downPayment },
    { label: 'Closing costs and prepaids (est.)', amount: m.costs, kind: 'add' },
    ...(m.payoffs ? [{ label: 'Debts paid off', amount: m.payoffs, kind: 'add' as const }] : []),
    ...(c.applied ? [{ label: 'Seller concessions', amount: c.applied, kind: 'subtract' as const }] : []),
    { label: 'Cash to close', amount: m.cashToClose, kind: 'subtotal' },
    ...(m.reservesRequired ? [{ label: 'Reserves required', amount: m.reservesRequired, kind: 'add' as const }] : []),
    { label: 'Funds available', amount: m.funds, kind: 'result' },
  ]
  return (
    <div className="space-y-3">
      {m.mi.financedFee > 0 && <p className="text-xs text-muted-foreground">Plus {formatCurrency(m.mi.financedFee)} financed fee = {formatCurrency(m.mi.totalLoanAmount)}</p>}
      <CalcLines lines={paymentLines} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">DTI (housing / total)</dt>
        <dd className="text-right font-medium tabular-nums">
          {formatPercent(m.dti.front, 1)} / {formatPercent(m.dti.back, 1)}
        </dd>
      </dl>
      <CalcLines lines={cashLines} />
      <p className={cn('text-sm tabular-nums', m.cashLeft < 0 ? 'text-destructive' : 'text-emerald-700')}>
        {m.cashLeft < 0 ? `Short ${formatCurrency(-m.cashLeft)}` : `${formatCurrency(m.cashLeft)} left after closing`}
        {m.gift.counted > 0 && <span className="text-muted-foreground"> · includes {formatCurrency(m.gift.counted)} gift</span>}
      </p>
      <div className="space-y-1.5 rounded-lg border bg-card p-3 text-sm">
        <p className="font-medium">Seller concessions</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
          <dt className="text-muted-foreground">Entered</dt>
          <dd className="text-right">{formatCurrency(c.entered)}</dd>
          <dt className="text-muted-foreground">Max allowed</dt>
          <dd className="text-right">
            {formatCurrency(c.maxAllowed)} <span className="text-muted-foreground">({formatPercent(c.maxAllowedPct)}{loanType === 'va' ? ' + costs' : ''})</span>
          </dd>
          <dt className="text-muted-foreground">Max usable</dt>
          <dd className="text-right">{formatCurrency(c.maxUsable)}</dd>
        </dl>
        {(c.overAllowed || c.overUsable) && (
          <p className="flex gap-1.5 text-xs text-amber-700">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {c.overAllowed ? `Over the ${formatPercent(c.maxAllowedPct)} limit for this loan` : 'More than the closing costs and prepaids'}
            {c.overAllowed && c.overUsable ? ' and more than the costs' : ''}; only {formatCurrency(c.applied)} counts.
          </p>
        )}
      </div>
      {!m.gift.allowed && m.gift.entered > 0 && (
        <p className="flex gap-1.5 text-xs text-amber-700">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          Gift funds aren't allowed here, so the {formatCurrency(m.gift.entered)} gift isn't counted.
        </p>
      )}
      {loan.purpose === 'purchase' && (
        <div className="space-y-1.5">
          <Button variant="outline" className="w-full" onClick={onSave} disabled={update.isPending || alreadySaved}>
            {update.isPending ? 'Saving…' : alreadySaved ? 'Saved as Approval Limits' : 'Save as Approval Limits'}
          </Button>
          <p className="text-xs text-muted-foreground">
            {saved.price != null ? `On file: ${formatCurrency(saved.price)} price, ${formatCurrency(saved.loanAmount)} loan. ` : ''}Used by the Letters tab.
          </p>
        </div>
      )}
    </div>
  )
}
