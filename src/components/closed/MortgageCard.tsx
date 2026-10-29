import { useState } from 'react'
import { cn } from 'cn'
import { Card } from '@/components/shared'
import type { ClosedLoan } from '@/lib/api/closed'
import { mortgageToday } from '@/lib/calc'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'

/** The mortgage today (estimated balance and equity) and an assumed amortization by year. */
export function MortgageCard({ closed: c }: { closed: ClosedLoan }) {
  const [showAll, setShowAll] = useState(false)
  const today = todayIso()
  const now = mortgageToday({ loanAmount: c.loanAmount, ratePct: c.rate, termMonths: c.termMonths, firstPaymentDate: c.firstPaymentDate, closingDate: c.closingDate }, today, c.home?.estimatedValue ?? c.purchasePrice)

  if (!now) {
    return (
      <Card title="Mortgage today">
        <p className="text-sm text-muted-foreground">Add the loan amount, rate, term and closing date to see the estimated balance and amortization.</p>
      </Card>
    )
  }

  const { schedule, paymentsMade: made, balance, equity } = now
  const thisYear = Number(today.slice(0, 4))
  const rows = showAll ? schedule.years : schedule.years.filter((y) => y.year >= thisYear - 1).slice(0, 6)

  return (
    <Card
      title="Mortgage today"
      description={`Estimated from the note, paid on time with no extra principal${schedule.firstPaymentAssumed ? `, first payment assumed ${formatIsoDate(schedule.firstPaymentDate)}` : ''}.`}
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Fact label="Balance today" value={formatCurrency(balance)} />
          <Fact label={c.home?.estimatedValue != null ? 'Equity (estimated value)' : 'Equity (purchase price)'} value={equity === null ? '—' : formatCurrency(equity)} />
          <Fact label="Principal & interest" value={`${formatCurrency(schedule.monthlyPayment)}/mo`} />
          <Fact label="Payments made · paid off" value={`${made} of ${c.termMonths} · ${formatIsoDate(schedule.payoffDate)}`} />
        </dl>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b text-[11px] tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Year</th>
                <th className="px-3 py-2 text-right font-medium">Payments</th>
                <th className="px-3 py-2 text-right font-medium">Principal</th>
                <th className="px-3 py-2 text-right font-medium">Interest</th>
                <th className="px-3 py-2 text-right font-medium">Balance at year end</th>
              </tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              {rows.map((y) => (
                <tr key={y.year} className={cn(y.year === thisYear && 'bg-primary/5 font-medium')}>
                  <td className="px-3 py-1.5">{y.year}</td>
                  <td className="px-3 py-1.5 text-right">{y.payments}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrency(y.principal)}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrency(y.interest)}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrency(y.endingBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            Total interest over the loan: {formatCurrency(schedule.totalInterest)} ·{' '}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show fewer years' : `Show all ${schedule.years.length} years`}
            </button>
          </p>
        </div>
      </div>
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
