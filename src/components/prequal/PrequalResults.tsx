import { CheckCircle2Icon, CircleHelpIcon, TriangleAlertIcon, XCircleIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/shared'
import { CalcLines } from '@/components/income/CalcLines'
import type { CheckStatus, IncomeLine } from '@/lib/calc'
import { formatCurrency, formatPercent } from '@/lib/format'
import type { PrequalLoan, PrequalSummary } from '@/lib/prequal/draft'

const STATUS: Record<CheckStatus, { icon: typeof CheckCircle2Icon; className: string }> = {
  pass: { icon: CheckCircle2Icon, className: 'text-emerald-600' },
  warn: { icon: TriangleAlertIcon, className: 'text-amber-600' },
  fail: { icon: XCircleIcon, className: 'text-destructive' },
  unknown: { icon: CircleHelpIcon, className: 'text-muted-foreground' },
}

/** Why there's no max price yet, in words. */
function missingForMax(loan: PrequalLoan, s: PrequalSummary): string {
  if (loan.noteRate === null) return 'Enter an interest rate to see the max price.'
  if (!loan.termMonths) return 'Pick a term to see the max price.'
  if (s.totalIncome <= 0) return 'Enter income to see the max price.'
  return `Debts already use up the ${formatPercent(loan.maxDtiPct)} DTI limit.`
}

/** The live answer for the call: max price, payment, DTI, cash and quick checks. */
export function PrequalResults({
  isPurchase,
  loan,
  summary: s,
  onUsePrice,
  canMarkPrequalified,
  onMarkPrequalified,
}: {
  isPurchase: boolean
  loan: PrequalLoan
  summary: PrequalSummary
  onUsePrice: (price: number) => void
  canMarkPrequalified: boolean
  onMarkPrequalified: () => void
}) {
  const p = s.scenario.payment
  const paymentLines: IncomeLine[] = p
    ? [
        { label: 'Principal and interest', amount: p.principalAndInterest },
        { label: 'Taxes', amount: p.taxes, kind: 'add' },
        { label: 'Insurance', amount: p.insurance, kind: 'add' },
        ...(p.hoa ? [{ label: 'HOA', amount: p.hoa, kind: 'add' as const }] : []),
        ...(p.mortgageInsurance ? [{ label: 'Mortgage insurance', amount: p.mortgageInsurance, kind: 'add' as const }] : []),
        { label: 'Total payment', amount: p.total, kind: 'result' },
      ]
    : []
  const overDti = s.dti.back !== null && s.dti.back > loan.maxDtiPct
  return (
    <div className="space-y-4">
      {isPurchase && (
        <Card>
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Max purchase price</p>
            {s.max ? (
              <>
                <p className="text-3xl font-semibold tabular-nums">{formatCurrency(s.max.price)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(s.max.payment.total)}/mo payment at {formatPercent(loan.maxDtiPct)} DTI, {formatCurrency(s.max.downPayment)} down
                </p>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {s.buyingPower.map((b) => (
                    <div key={b.dtiPct} className={cn('rounded-md border px-2 py-1.5 text-center', b.dtiPct === loan.maxDtiPct && 'border-primary bg-primary/5')}>
                      <p className="text-[0.7rem] text-muted-foreground">{b.dtiPct}% DTI</p>
                      <p className="text-sm font-medium tabular-nums">{b.price === null ? '—' : formatCurrency(b.price)}</p>
                    </div>
                  ))}
                </div>
                {loan.purchasePrice !== s.max.price && (
                  <Button size="sm" variant="outline" onClick={() => onUsePrice(s.max!.price)}>
                    Use this price
                  </Button>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{missingForMax(loan, s)}</p>
            )}
          </div>
        </Card>
      )}

      <Card title={isPurchase && loan.purchasePrice ? `At ${formatCurrency(loan.purchasePrice)}` : 'Payment'}>
        <div className="space-y-3">
          {p ? <CalcLines lines={paymentLines} /> : <p className="text-sm text-muted-foreground">Enter a {isPurchase ? 'price' : 'loan amount'} and rate to see the payment.</p>}
          {s.scenario.mi && s.scenario.mi.financedFee > 0 && (
            <p className="text-xs text-muted-foreground">
              Loan {formatCurrency(s.loanAmount)} + {formatCurrency(s.scenario.mi.financedFee)} financed fee = {formatCurrency(s.scenario.mi.totalLoanAmount)}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Income / mo</dt>
            <dd className="text-right tabular-nums">{formatCurrency(s.totalIncome)}</dd>
            {(s.rentalIncome > 0 || s.depletionIncome > 0) && (
              <dd className="col-span-2 -mt-1 text-xs text-muted-foreground">
                {[s.rentalIncome > 0 && `${formatCurrency(s.rentalIncome)} rental`, s.depletionIncome > 0 && `${formatCurrency(s.depletionIncome)} asset depletion`].filter(Boolean).join(' + ')} included
              </dd>
            )}
            <dt className="text-muted-foreground">Debts / mo</dt>
            <dd className="text-right tabular-nums">{formatCurrency(s.otherDebts)}</dd>
            <dt className="text-muted-foreground">DTI (housing / total)</dt>
            <dd className={cn('text-right font-medium tabular-nums', overDti && 'text-destructive')}>
              {s.dti.front === null ? '—' : `${formatPercent(s.dti.front, 1)} / ${formatPercent(s.dti.back, 1)}`}
            </dd>
            {s.cash && (
              <>
                <dt className="text-muted-foreground">Cash to close</dt>
                <dd className="text-right tabular-nums">{formatCurrency(s.cashNeeded ?? s.cash.total)}</dd>
                <dd className="col-span-2 -mt-1 text-xs text-muted-foreground">
                  {formatCurrency(s.cash.downPayment)} down + {formatCurrency(s.cash.closingCosts)} closing costs{s.cash.closingCostsEstimated ? ' (est. 3%)' : ''}
                  {s.payoffs > 0 && ` + ${formatCurrency(s.payoffs)} payoffs`}
                </dd>
              </>
            )}
            {s.funds !== null && (
              <>
                <dt className="text-muted-foreground">Funds for closing</dt>
                <dd className="text-right tabular-nums">{formatCurrency(s.funds)}</dd>
                {s.saleProceeds > 0 && <dd className="col-span-2 -mt-1 text-xs text-muted-foreground">Includes {formatCurrency(s.saleProceeds)} sale proceeds</dd>}
              </>
            )}
            {s.reserves && (
              <>
                <dt className="text-muted-foreground">Reserves after closing</dt>
                <dd className="text-right tabular-nums">
                  {formatCurrency(s.reserves.amount)}
                  {s.reserves.months !== null && <span className="text-muted-foreground"> · {s.reserves.months} mo</span>}
                </dd>
              </>
            )}
          </dl>
        </div>
      </Card>

      <Card title="Quick checks" description="Typical guidelines; Product Search and the AUS make the call.">
        <ul className="space-y-2 text-sm">
          {s.checks.map((c) => {
            const { icon: Icon, className } = STATUS[c.status]
            return (
              <li key={c.label} className="flex gap-2">
                <Icon className={cn('mt-0.5 size-4 shrink-0', className)} />
                <span>
                  <span className="font-medium">{c.label}:</span> {c.detail}
                </span>
              </li>
            )
          })}
        </ul>
        {canMarkPrequalified && (
          <Button className="mt-4 w-full" variant="outline" onClick={onMarkPrequalified}>
            Mark Pre-Qualified
          </Button>
        )}
      </Card>
    </div>
  )
}
