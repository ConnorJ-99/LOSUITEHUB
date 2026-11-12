import { TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, confirmAction, CurrencyInput, FormGrid, NumberInput, PercentInput, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { SubHeading } from '@/components/urla/parts'
import { CalcLines } from '@/components/income/CalcLines'
import { useUpdateLoanDetails } from '@/lib/api/loans'
import type { LoanProfile } from '@/lib/api/types'
import { APPROVAL_LIMIT_LABELS, APPROVAL_LOAN_TYPES, approvalTypeFor, mortgageTypeFor, type ApprovalLoanType, type ConcessionOccupancy, type IncomeLine, type MaxApprovalResult } from '@/lib/calc'
import { formatCurrency, formatPercent } from '@/lib/format'
import { changeLoanType, type PrequalLoan } from '@/lib/prequal/draft'
import { approvalDefaults, type ApprovalFacts, type ApprovalForm } from '@/lib/prequal/maxApproval'
import { TERMS } from './options'

const OCCUPANCIES: { value: ConcessionOccupancy; label: string }[] = [
  { value: 'primary', label: 'Primary home' },
  { value: 'second_home', label: 'Second home' },
  { value: 'investment', label: 'Investment' },
]

const fromFile = (value: number | null, label = 'From the 1003') => (value === null ? label : 'Clear to use the 1003 figure')

/** The calculator's inputs: loan type, rate and term (saved with Save), everything else a what-if. */
export function MaxApprovalInputs({
  loan,
  onLoanChange,
  form,
  onChange,
  facts,
}: {
  loan: PrequalLoan
  onLoanChange: (next: PrequalLoan) => void
  form: ApprovalForm
  onChange: (next: ApprovalForm) => void
  facts: ApprovalFacts
}) {
  const type = approvalTypeFor(loan.mortgageType)
  const def = approvalDefaults(type, form, facts)
  const set = <K extends keyof ApprovalForm>(key: K) => (value: ApprovalForm[K]) => onChange({ ...form, [key]: value })
  const ph = (n: number | null, decimals = 0) => (n === null ? undefined : n.toLocaleString('en-US', { maximumFractionDigits: decimals }))
  const limitHint =
    type === 'va' ? 'VA with full entitlement: no county limit' : type === 'non_qm' ? 'Non-QM: no county limit' : form.loanLimit !== null ? 'This file only; clear to use Settings' : def.loanLimit === null ? 'Not set in Settings → Company' : 'From Settings → Company'
  return (
    <Card title="Max approval" description="The highest price where DTI, payment, cash to close and the loan limit all pass. Blank fields use the 1003 or the loan type's default.">
      <div className="space-y-4">
        <ToggleChipGroup>
          {APPROVAL_LOAN_TYPES.map((t) => (
            <ToggleChip key={t.value} label={t.label} pressed={type === t.value} onChange={() => onLoanChange(changeLoanType(loan, mortgageTypeFor(t.value)))} />
          ))}
        </ToggleChipGroup>
        <ToggleChipGroup>
          {OCCUPANCIES.map((o) => (
            <ToggleChip key={o.value} label={o.label} pressed={form.occupancy === o.value} onChange={() => onChange({ ...form, occupancy: o.value })} />
          ))}
        </ToggleChipGroup>
        <FormGrid>
          <PercentInput label="Interest rate" value={loan.noteRate} onChange={(noteRate) => onLoanChange({ ...loan, noteRate })} maxDecimals={3} span={2} />
          <PercentInput label="Down payment" value={form.downPaymentPct} onChange={set('downPaymentPct')} maxDecimals={2} placeholder={ph(def.downPaymentPct, 2)} hint={form.downPaymentPct === null ? 'Usual minimum' : undefined} span={2} />
          <PercentInput label="Max DTI" value={form.maxDtiPct} onChange={set('maxDtiPct')} maxDecimals={2} placeholder={ph(def.maxDtiPct, 2)} hint={form.maxDtiPct === null ? `${APPROVAL_LOAN_TYPES.find((t) => t.value === type)!.label} default` : undefined} span={2} />
        </FormGrid>
        <ToggleChipGroup>
          {TERMS.map((t) => (
            <ToggleChip key={t.months} label={t.label} pressed={loan.termMonths === t.months} onChange={() => onLoanChange({ ...loan, termMonths: t.months })} />
          ))}
        </ToggleChipGroup>

        <SubHeading>Income, debts and funds</SubHeading>
        <FormGrid>
          <CurrencyInput label="Monthly income" value={form.monthlyIncome} onChange={set('monthlyIncome')} placeholder={ph(def.monthlyIncome)} hint={fromFile(form.monthlyIncome)} span={2} />
          <CurrencyInput label="Monthly debts" value={form.monthlyDebts} onChange={set('monthlyDebts')} placeholder={ph(def.monthlyDebts)} hint={fromFile(form.monthlyDebts)} span={2} />
          <CurrencyInput label="Max monthly payment" value={form.maxMonthlyPayment} onChange={set('maxMonthlyPayment')} hint="Optional: what they want to stay under" span={2} />
          <CurrencyInput label="Verified assets" value={form.assets} onChange={set('assets')} placeholder={ph(def.assets)} hint={fromFile(form.assets, 'From the 1003 (gifts not included)')} span={2} />
          <CurrencyInput label="Gift funds" value={form.giftAmount} onChange={set('giftAmount')} placeholder={ph(def.giftAmount)} hint={fromFile(form.giftAmount, "From the 1003's gifts")} span={2} />
          <NumberInput label="Reserves (months)" value={form.reserveMonths} onChange={set('reserveMonths')} maxDecimals={1} placeholder={ph(def.reserveMonths)} hint={form.reserveMonths === null ? 'Default for the occupancy' : undefined} span={2} />
        </FormGrid>
        {type === 'non_qm' && <ToggleChip label="Lender allows gift funds" pressed={form.nonQmAllowsGift} onChange={set('nonQmAllowsGift')} />}

        <SubHeading>Taxes, insurance, HOA and MI</SubHeading>
        <FormGrid>
          <PercentInput label="Property tax / year" value={form.taxRatePct} onChange={set('taxRatePct')} maxDecimals={3} placeholder={ph(def.taxRatePct, 3)} hint="Percent of the price" span={2} />
          <PercentInput label="Insurance / year" value={form.insuranceRatePct} onChange={set('insuranceRatePct')} maxDecimals={3} placeholder={ph(def.insuranceRatePct, 3)} hint="Percent of the price" span={2} />
          <CurrencyInput label="HOA / month" value={form.monthlyHoa} onChange={set('monthlyHoa')} span={2} />
          {type === 'fha' ? (
            <PercentInput label="MIP / year" value={null} readOnly placeholder="By HUD's schedule" hint="0.55% (0.50% at 5%+ down) + 1.75% financed" span={2} />
          ) : type === 'va' ? (
            <PercentInput label="VA funding fee" value={loan.upfrontFeePct} onChange={(upfrontFeePct) => onLoanChange({ ...loan, upfrontFeePct })} maxDecimals={3} placeholder="By the VA chart" hint={loan.upfrontFeePct === null ? 'Financed; no monthly MI' : 'Clear to use the VA chart'} span={2} />
          ) : (
            <PercentInput label="MI rate / year" value={form.miRatePct} onChange={set('miRatePct')} maxDecimals={3} placeholder={type === 'conventional' ? '0.5' : '0'} hint={type === 'conventional' ? 'Blank: 0.5% over 80% LTV' : 'Blank: none'} span={2} />
          )}
        </FormGrid>
        {type === 'va' && <ToggleChip label="Exempt from the funding fee (disability)" pressed={loan.upfrontFeePct === 0} onChange={(on) => onLoanChange({ ...loan, upfrontFeePct: on ? 0 : null })} />}

        <SubHeading>Seller concessions and loan limit</SubHeading>
        <FormGrid>
          <PercentInput label="Seller concessions" value={form.sellerConcessionPct} onChange={set('sellerConcessionPct')} maxDecimals={2} placeholder="0" hint="Percent of the price" span={2} />
          {type === 'non_qm' && <PercentInput label="Lender's concession cap" value={form.nonQmConcessionCapPct} onChange={set('nonQmConcessionCapPct')} maxDecimals={2} placeholder={ph(def.nonQmConcessionCapPct)} span={2} />}
          <CurrencyInput label="County loan limit" value={form.loanLimit} onChange={set('loanLimit')} placeholder={ph(def.loanLimit)} readOnly={type === 'va' || type === 'non_qm'} hint={limitHint} span={2} />
        </FormGrid>
      </div>
    </Card>
  )
}

/** The answer: max price and loan, what limited it, the payment, DTI, cash, and Save as Approval Limits. */
export function MaxApprovalResults({ loan, loanType, result, className }: { loan: LoanProfile; loanType: ApprovalLoanType; result: MaxApprovalResult; className?: string }) {
  const update = useUpdateLoanDetails(loan.id)
  const m = result.max
  const saved = { price: loan.details.preapprovalMaxPrice, loanAmount: loan.details.preapprovalMaxLoanAmount }
  const alreadySaved = !!m && saved.price === m.price && saved.loanAmount === m.loanAmount

  const onSave = async () => {
    if (!m) return
    if (saved.price != null && !(await confirmAction(`Replace the Approval Limits (${formatCurrency(saved.price)} price, ${formatCurrency(saved.loanAmount)} loan) with ${formatCurrency(m.price)} and ${formatCurrency(m.loanAmount)}? Letters already issued don't change.`, { confirmLabel: 'Replace' }))) return
    update.mutate(
      { preapprovalMaxPrice: m.price, preapprovalMaxLoanAmount: m.loanAmount },
      { onSuccess: () => toast.success('Saved as Approval Limits for the letters'), onError: (e) => toast.error(e.message) },
    )
  }

  if (!m) {
    return (
      <Card className={className}>
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Max approval</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {result.missing ?? `No price passes: ${result.limitedBy ? APPROVAL_LIMIT_LABELS[result.limitedBy] : 'a limit'} fails even at the lowest price.`}
        </p>
      </Card>
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
    <Card className={className}>
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Max approval</p>
          <p className="text-3xl font-semibold tabular-nums">{formatCurrency(m.price)}</p>
          <p className="text-sm tabular-nums">
            Max loan <span className="font-medium">{formatCurrency(m.loanAmount)}</span>
            <span className="text-muted-foreground">
              {' '}
              · {formatCurrency(m.downPayment)} down{m.ltv !== null && ` · ${formatPercent(m.ltv, 2)} LTV`}
            </span>
          </p>
          {m.mi.financedFee > 0 && <p className="text-xs text-muted-foreground">Plus {formatCurrency(m.mi.financedFee)} financed fee = {formatCurrency(m.mi.totalLoanAmount)}</p>}
          <p className="pt-1">
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs font-medium text-primary">
              Limited by: {result.limitedBy ? APPROVAL_LIMIT_LABELS[result.limitedBy] : 'nothing up to $20M'}
            </span>
          </p>
        </div>

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

        <div className="space-y-1.5 rounded-lg border p-3 text-sm">
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
            <Button className="w-full" onClick={onSave} disabled={update.isPending || alreadySaved}>
              {update.isPending ? 'Saving…' : alreadySaved ? 'Saved as Approval Limits' : 'Save as Approval Limits'}
            </Button>
            <p className="text-xs text-muted-foreground">
              {saved.price != null ? `On file: ${formatCurrency(saved.price)} price, ${formatCurrency(saved.loanAmount)} loan. ` : ''}Used by the Letters tab.
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}
