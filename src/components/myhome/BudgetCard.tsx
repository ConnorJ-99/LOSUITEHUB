// A borrower's budget on a file's MyHome tab (nurture goals Phase 3; Connor's
// decision 4, 2026-11-24: the loan officer sees everything). Read only, per
// borrower who has one: what's left each month on average, cash now (their
// starting cash plus what they confirmed; projections never count), this
// month, the next 30 days with any dip below zero, their income and bills,
// and what they confirmed lately. Math in src/lib/calc/budget.ts.
import { Card } from '@/components/shared'
import { useBudgets, type PersonBudget } from '@/lib/api/budget'
import { useApplication } from '@/lib/api/urla'
import type { LoanProfile } from '@/lib/api/types'
import { BUDGET_SCHEDULES, forecast, monthSummary, monthlyEquivalent, monthlyNet } from '@/lib/calc/budget'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'

export function BudgetCard({ loan }: { loan: LoanProfile }) {
  const app = useApplication(loan.id)
  const borrowers = app.data?.borrowers ?? []
  const budgets = useBudgets(borrowers.map((b) => b.contactId))
  if (budgets.data === null)
    return (
      <Card title="Budget">
        <p className="text-sm text-muted-foreground">Run the budget planner script (20270305000000_budget_planner.sql) to see budgets borrowers keep in MyHome.</p>
      </Card>
    )
  const list = budgets.data ?? []
  return (
    <Card title="Budget" description="What they keep in MyHome's budget (optional for them). Their numbers, not verified; planned money isn't counted as saved.">
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No budget in MyHome yet.</p>
      ) : (
        <div className="space-y-6">
          {list.map((b) => (
            <PersonBudgetView key={b.contactId} budget={b} name={borrowers.length > 1 ? (borrowers.find((x) => x.contactId === b.contactId)?.person.firstName ?? '') : null} />
          ))}
        </div>
      )}
    </Card>
  )
}

const label = (i: PersonBudget['items'][number]) => (i.schedule === 'every_n_days' ? `Every ${i.everyDays} days` : (BUDGET_SCHEDULES.find((s) => s.value === i.schedule)?.label ?? i.schedule).replace(' (about this much a month)', ''))

function PersonBudgetView({ budget: b, name }: { budget: PersonBudget; name: string | null }) {
  const today = todayIso()
  const avg = monthlyNet(b.items)
  const f = forecast({ items: b.items, entries: b.entries, startingCash: b.startingCash, startingOn: b.startingOn, today, days: 30 })
  const m = monthSummary(b.items, b.entries, today.slice(0, 7))
  const stat = (t: string, v: string, note?: string, warn?: boolean) => (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{t}</p>
      <p className={`text-lg font-bold tabular-nums ${warn ? 'text-destructive' : ''}`}>{v}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
  return (
    <div>
      {name && <p className="mb-2 font-semibold">{name}</p>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {stat('Left each month (average)', formatCurrency(avg.net), `${formatCurrency(avg.income)} in · ${formatCurrency(avg.expenses)} out`, avg.net < 0)}
        {stat('Plans to save a month', b.monthlySavings == null ? '—' : formatCurrency(b.monthlySavings))}
        {stat('Cash now', f.cashNow == null ? '—' : formatCurrency(f.cashNow), b.startingOn ? `from ${formatCurrency(b.startingCash ?? 0)} on ${formatIsoDate(b.startingOn)} + confirmed` : 'No starting cash entered')}
        {stat('Next 30 days', formatCurrency(f.net), f.low && f.low.amount < 0 ? `Could dip to ${formatCurrency(f.low.amount)} around ${formatIsoDate(f.low.on)}` : `${formatCurrency(f.income)} in · ${formatCurrency(f.expenses)} out`, f.net < 0 || (f.low?.amount ?? 0) < 0)}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        This month: {formatCurrency(m.expectedIncome)} in ({formatCurrency(m.confirmedIncome)} confirmed) · {formatCurrency(m.expectedExpenses)} out ({formatCurrency(m.confirmedExpenses)} confirmed) · {formatCurrency(m.expectedNet)} left
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Income and bills</p>
          <ul className="mt-1 divide-y text-sm">
            {b.items.map((i) => (
              <li key={i.id} className={`flex justify-between gap-2 py-1.5 ${i.paused ? 'opacity-60' : ''}`}>
                <span className="min-w-0">
                  {i.name}
                  <span className="block text-xs text-muted-foreground">
                    {i.kind === 'income' ? 'Income' : 'Expense'} · {label(i)}
                    {i.nextOn && ` · next ${formatIsoDate(i.nextOn)}`}
                    {i.paused && ' · paused'}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  {formatCurrency(i.amount)}
                  <span className="block text-xs text-muted-foreground">{formatCurrency(monthlyEquivalent(i))}/mo</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Confirmed lately</p>
          {b.entries.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Nothing confirmed yet.</p>
          ) : (
            <ul className="mt-1 divide-y text-sm">
              {b.entries.slice(0, 10).map((e) => (
                <li key={e.id} className="flex justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    {e.name}
                    <span className="block text-xs text-muted-foreground">
                      {formatIsoDate(e.on)}
                      {e.plannedOn == null ? ' · unplanned' : e.amount === 0 ? " · didn't happen" : ''}
                    </span>
                  </span>
                  <span className={`shrink-0 tabular-nums ${e.kind === 'income' ? 'text-emerald-700' : ''}`}>
                    {e.kind === 'income' ? '+' : '−'}
                    {formatCurrency(e.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
