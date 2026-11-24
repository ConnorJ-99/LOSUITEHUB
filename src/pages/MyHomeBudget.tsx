// MyHome: My budget (nurture goals Phase 3, Connor's spec 2026-11-24).
// Optional for the borrower and on the person, like My assets: what comes in
// and goes out and when (every week, every two weeks, twice a month, every
// month, once a year, every few days, once, or "it varies"), the next 7 / 30 /
// 90 days, this month, "Did these happen?" to confirm what really came in or
// went out, something unplanned, and the savings plan tied to their savings
// goal ("About 6 months at $650 a month."). Projected money is never counted
// as saved; cash now is the starting cash plus what they confirmed. The loan
// officer sees all of it (decision 4). Math in src/lib/calc/budget.ts.
import { useEffect, useState } from 'react'
import { Loader2Icon, PlusIcon } from 'lucide-react'
import { BUDGET_SCHEDULES, forecast, monthSummary, monthlyNet, savingsPlan, toConfirm, type BudgetSchedule } from '@/lib/calc/budget'
import { todayIso } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { fetchBudget, removeBudgetEntry, removeBudgetItem, saveBudgetEntry, saveBudgetItem, saveBudgetSettings } from '@/lib/myhome/api'
import type { BudgetKind, MyHomeBudget, MyHomeBudgetItem } from '../../supabase/functions/myhome/rules'

const card = 'rounded-xl border bg-white p-5 shadow-soft'
const input = 'mt-1 h-12 w-full rounded-lg border border-input bg-white px-3 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20'
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const dollars = (s: string) => {
  const n = Number(s.replace(/[^0-9.]/g, ''))
  return s.trim() !== '' && Number.isFinite(n) ? n : null
}
const money = (n: number) => formatCurrency(Math.round(n))
const scheduleLabel = (i: Pick<MyHomeBudgetItem, 'schedule' | 'everyDays'>) =>
  i.schedule === 'every_n_days' ? `Every ${i.everyDays} days` : (BUDGET_SCHEDULES.find((s) => s.value === i.schedule)?.label ?? i.schedule).replace(' (about this much a month)', '')

type Screen = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'open'; budget: MyHomeBudget }

/** The savings goal the plan measures against (a Nurture file's savings goal), if any. */
export interface BudgetSavingsGoal {
  label: string
  remaining: number
}

export function MyBudget({ savingsGoal, loFirst }: { savingsGoal?: BudgetSavingsGoal | null; loFirst?: string }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' })
  const [started, setStarted] = useState(false)
  const load = async () => {
    const r = await fetchBudget()
    if (r.status === 200 && r.body.items && r.body.entries) return setScreen({ kind: 'open', budget: r.body as MyHomeBudget })
    setScreen({ kind: 'error', message: r.body.error ?? 'Your budget could not load.' })
  }
  useEffect(() => {
    void load()
  }, [])
  const reload = () => void load()

  if (screen.kind === 'loading')
    return (
      <p className="flex items-center justify-center gap-2 rounded-xl border bg-white py-8 text-sm text-muted-foreground shadow-soft">
        <Loader2Icon className="size-4 animate-spin" /> Loading your budget…
      </p>
    )
  if (screen.kind === 'error')
    return (
      <section className={`${card} text-center`}>
        <p className="text-sm text-muted-foreground">{screen.message}</p>
        <button type="button" onClick={reload} className="mt-3 h-10 rounded-lg border px-4 text-sm font-medium">
          Try again
        </button>
      </section>
    )
  const b = screen.budget
  const empty = b.items.length === 0 && b.startingCash == null && b.monthlySavings == null && b.entries.length === 0
  if (empty && !started)
    return (
      <section className={card} aria-labelledby="myhome-budget">
        <h2 id="myhome-budget" className="text-lg font-bold tracking-tight">
          My budget <span className="text-sm font-normal text-muted-foreground">(optional)</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Add your paychecks and bills to see what the next few weeks look like and how long your savings goal could take.</p>
        <button type="button" onClick={() => setStarted(true)} className="mt-3 h-12 w-full rounded-lg bg-primary text-base font-semibold text-white">
          Start my budget
        </button>
      </section>
    )
  return <Budget budget={b} savingsGoal={savingsGoal ?? null} loFirst={loFirst} onChanged={reload} />
}

function Budget({ budget: b, savingsGoal, loFirst, onChanged }: { budget: MyHomeBudget; savingsGoal: BudgetSavingsGoal | null; loFirst?: string; onChanged: () => void }) {
  const today = todayIso()
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adding, setAdding] = useState<BudgetKind | 'unplanned' | null>(null)
  const f = forecast({ items: b.items, entries: b.entries, startingCash: b.startingCash, startingOn: b.startingOn, today, days })
  const month = monthSummary(b.items, b.entries, today.slice(0, 7))
  const avg = monthlyNet(b.items)
  const perMonth = b.monthlySavings ?? (avg.net > 0 ? avg.net : 0)
  const plan = savingsGoal ? savingsPlan(savingsGoal.remaining, perMonth) : null
  const pending = toConfirm(b.items, b.entries, today).slice(0, 6)
  const incomes = b.items.filter((i) => i.kind === 'income')
  const bills = b.items.filter((i) => i.kind === 'expense')
  const recent = b.entries.slice(0, 8)
  const monthName = new Date(`${today.slice(0, 7)}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long' })

  return (
    <section className={card} aria-labelledby="myhome-budget">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="myhome-budget" className="text-lg font-bold tracking-tight">
            My budget
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Planned numbers are estimates. Only what you confirm counts as real.</p>
        </div>
        {f.cashNow != null && (
          <div className="shrink-0 text-right">
            <p className="text-xs text-muted-foreground">Cash now</p>
            <p className="text-xl font-extrabold tabular-nums">{money(f.cashNow)}</p>
          </div>
        )}
      </div>

      {/* The next 7 / 30 / 90 days */}
      <div className="mt-4 flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="How far ahead">
        {([7, 30, 90] as const).map((d) => (
          <button key={d} type="button" role="tab" aria-selected={days === d} onClick={() => setDays(d)} className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${days === d ? 'bg-white shadow-sm' : 'text-muted-foreground'}`}>
            Next {d} days
          </button>
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Coming in</dt>
          <dd className="font-bold text-emerald-700 tabular-nums">{money(f.income)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Going out</dt>
          <dd className="font-bold tabular-nums">{money(f.expenses)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Left over</dt>
          <dd className={`font-bold tabular-nums ${f.net < 0 ? 'text-destructive' : ''}`}>{money(f.net)}</dd>
        </div>
      </dl>
      {f.endCash != null && (
        <p className="mt-2 text-sm">
          If it all goes as planned, about <strong>{money(f.endCash)}</strong> on {shortDate(f.to)}.
        </p>
      )}
      {f.low && f.low.amount < 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Heads up: your balance could dip to {money(f.low.amount)} around {shortDate(f.low.on)}.
        </p>
      )}
      {f.lines.length > 0 && (
        <ul className="mt-3 divide-y rounded-lg border text-sm">
          {f.lines.slice(0, days === 7 ? 20 : 40).map((l, i) => (
            <li key={i} className="flex items-center gap-2 px-3 py-2">
              <span className="w-14 shrink-0 text-muted-foreground">{l.status === 'estimate' ? 'Varies' : shortDate(l.on)}</span>
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              <span className={`tabular-nums ${l.kind === 'income' ? 'text-emerald-700' : ''}`}>
                {l.kind === 'income' ? '+' : '−'}
                {money(l.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <div className="mt-5">
          <h3 className="font-semibold">Did these happen?</h3>
          <p className="text-sm text-muted-foreground">Confirm what really came in or went out. It replaces the plan for that date.</p>
          <ul className="mt-2 space-y-2">
            {pending.map((p) => (
              <ConfirmRow key={`${p.itemId}:${p.on}`} pending={p} onChanged={onChanged} />
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 rounded-lg bg-[#F4F7FB] p-3 text-sm">
        <h3 className="font-semibold">{monthName}</h3>
        <dl className="mt-1 grid grid-cols-3 gap-2">
          <div>
            <dt className="text-muted-foreground">In</dt>
            <dd className="font-bold tabular-nums">{money(month.expectedIncome)}</dd>
            <dd className="text-xs text-muted-foreground">{money(month.confirmedIncome)} confirmed</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Out</dt>
            <dd className="font-bold tabular-nums">{money(month.expectedExpenses)}</dd>
            <dd className="text-xs text-muted-foreground">{money(month.confirmedExpenses)} confirmed</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Left over</dt>
            <dd className={`font-bold tabular-nums ${month.expectedNet < 0 ? 'text-destructive' : ''}`}>{money(month.expectedNet)}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-5">
        <h3 className="font-semibold">Saving</h3>
        <p className="mt-1 text-sm">
          {b.monthlySavings != null ? (
            <>
              You plan to save <strong>{money(b.monthlySavings)}</strong> a month.
            </>
          ) : avg.net > 0 ? (
            <>
              Your plan leaves about <strong>{money(avg.net)}</strong> a month.
            </>
          ) : (
            'Add your income and bills to see what you could save each month.'
          )}
        </p>
        {savingsGoal && plan && (
          <p className="mt-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {savingsGoal.label}: {money(savingsGoal.remaining)} to go. {plan.line}
          </p>
        )}
        {savingsGoal && !plan && savingsGoal.remaining > 0 && <p className="mt-1 text-sm text-muted-foreground">Set a monthly savings amount to see how long {savingsGoal.label.toLowerCase()} could take.</p>}
        <p className="mt-1 text-xs text-muted-foreground">Planned savings aren't counted as saved{loFirst ? ` for ${loFirst}` : ''} until the money is in your account.</p>
        {settingsOpen ? (
          <SettingsForm budget={b} onDone={() => (setSettingsOpen(false), onChanged())} onCancel={() => setSettingsOpen(false)} />
        ) : (
          <button type="button" onClick={() => setSettingsOpen(true)} className="mt-2 text-sm font-medium text-primary">
            {b.startingCash == null ? 'Set my cash on hand and savings amount' : 'Change cash on hand or savings amount'}
          </button>
        )}
      </div>

      <ItemList title="Income" items={incomes} onChanged={onChanged} />
      <ItemList title="Bills and spending" items={bills} onChanged={onChanged} />
      {adding && adding !== 'unplanned' && <ItemForm kind={adding} onDone={() => (setAdding(null), onChanged())} onCancel={() => setAdding(null)} />}
      {adding === 'unplanned' && <UnplannedForm onDone={() => (setAdding(null), onChanged())} onCancel={() => setAdding(null)} />}
      {!adding && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setAdding('income')} className="flex h-11 items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm font-semibold text-primary">
            <PlusIcon className="size-4" /> Income
          </button>
          <button type="button" onClick={() => setAdding('expense')} className="flex h-11 items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm font-semibold text-primary">
            <PlusIcon className="size-4" /> Bill or spending
          </button>
          <button type="button" onClick={() => setAdding('unplanned')} className="col-span-2 h-11 rounded-lg border text-sm font-medium">
            Something unplanned came in or went out
          </button>
        </div>
      )}

      {recent.length > 0 && <RecentEntries entries={recent} onChanged={onChanged} />}
    </section>
  )
}

function ConfirmRow({ pending: p, onChanged }: { pending: ReturnType<typeof toConfirm>[number]; onChanged: () => void }) {
  const [other, setOther] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = async (amount: number) => {
    setBusy(true)
    setError(null)
    const r = await saveBudgetEntry({ itemId: p.itemId, plannedOn: p.on, kind: p.kind, name: null, amount, on: p.on })
    setBusy(false)
    if (r.status === 200) return onChanged()
    setError(r.body.error ?? 'That did not save. Try again.')
  }
  return (
    <li className="rounded-lg border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-muted-foreground">{shortDate(p.on)}</span>
        <span className="min-w-0 flex-1 truncate">{p.name}</span>
        <span className="tabular-nums">{money(p.amount)}</span>
      </div>
      {other ? (
        <div className="mt-2 flex gap-2">
          <span className="relative flex-1">
            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">$</span>
            <input className="h-10 w-full rounded-lg border px-3 pl-7" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="Actual amount" aria-label="Actual amount" />
          </span>
          <button type="button" disabled={busy || dollars(text) == null} onClick={() => void confirm(dollars(text)!)} className="h-10 rounded-lg bg-primary px-4 font-semibold text-white disabled:opacity-60">
            Save
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void confirm(p.amount)} className="h-9 rounded-lg bg-primary px-3 font-semibold text-white disabled:opacity-60">
            Yes, {money(p.amount)}
          </button>
          <button type="button" disabled={busy} onClick={() => setOther(true)} className="h-9 rounded-lg border px-3 font-medium">
            Different amount
          </button>
          <button type="button" disabled={busy} onClick={() => void confirm(0)} className="h-9 rounded-lg border px-3 font-medium text-muted-foreground">
            Didn't happen
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-destructive">{error}</p>}
    </li>
  )
}

function ItemList({ title, items, onChanged }: { title: string; items: MyHomeBudgetItem[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  if (!items.length) return null
  return (
    <div className="mt-5">
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-1 divide-y">
        {items.map((i) =>
          editing === i.id ? (
            <li key={i.id}>
              <ItemForm kind={i.kind} item={i} onDone={() => (setEditing(null), onChanged())} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={i.id} className={`flex items-center gap-2 py-2 text-sm ${i.paused ? 'opacity-60' : ''}`}>
              <button type="button" onClick={() => setEditing(i.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-medium">{i.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {scheduleLabel(i)}
                  {i.nextOn && i.schedule !== 'one_time' && ` · next ${shortDate(i.nextOn)}`}
                  {i.schedule === 'one_time' && i.nextOn && ` · ${shortDate(i.nextOn)}`}
                  {i.paused && ' · paused'}
                </span>
              </button>
              <span className="tabular-nums">{money(i.amount)}</span>
            </li>
          ),
        )}
      </ul>
      <p className="text-xs text-muted-foreground">Tap one to change, pause or remove it.</p>
    </div>
  )
}

function ItemForm({ kind, item, onDone, onCancel }: { kind: BudgetKind; item?: MyHomeBudgetItem; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [amountText, setAmountText] = useState(item ? String(item.amount) : '')
  const [schedule, setSchedule] = useState<BudgetSchedule>(item?.schedule ?? (kind === 'income' ? 'biweekly' : 'monthly'))
  const [everyDays, setEveryDays] = useState(item?.everyDays ? String(item.everyDays) : '')
  const [nextOn, setNextOn] = useState(item?.nextOn ?? todayIso())
  const [paused, setPaused] = useState(item?.paused ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const amount = dollars(amountText)
  const save = async () => {
    setBusy(true)
    setError(null)
    const r = await saveBudgetItem({
      itemId: item?.id ?? null,
      kind,
      name,
      amount: amount ?? 0,
      schedule,
      everyDays: schedule === 'every_n_days' ? Number(everyDays) || null : null,
      nextOn: schedule === 'irregular' ? null : nextOn,
      category: item?.category ?? null,
      notes: item?.notes ?? null,
      paused,
    })
    setBusy(false)
    if (r.status === 200) return onDone()
    setError(r.body.error ?? 'That did not save. Try again.')
  }
  const remove = async () => {
    setBusy(true)
    const r = await removeBudgetItem(item!.id)
    setBusy(false)
    if (r.status === 200) return onDone()
    setError(r.body.error ?? 'That did not save. Try again.')
  }
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-[#F4F7FB] p-4">
      <p className="font-semibold">{item ? `Change ${item.name}` : kind === 'income' ? 'Add income' : 'Add a bill or spending'}</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">
          Name
          <input className={input} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'income' ? 'e.g. Paycheck' : 'e.g. Rent'} />
        </label>
        <label className="block text-sm font-medium">
          {schedule === 'irregular' ? 'About a month' : 'Amount'}
          <span className="relative block">
            <span className="absolute top-1/2 left-3 mt-0.5 -translate-y-1/2 text-muted-foreground">$</span>
            <input className={`${input} pl-7`} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0" />
          </span>
        </label>
      </div>
      <label className="block text-sm font-medium">
        How often
        <select className={input} value={schedule} onChange={(e) => setSchedule(e.target.value as BudgetSchedule)}>
          {BUDGET_SCHEDULES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {schedule !== 'irregular' && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            {schedule === 'one_time' ? 'Date' : 'Next date'}
            <input type="date" className={input} value={nextOn} onChange={(e) => setNextOn(e.target.value)} />
          </label>
          {schedule === 'every_n_days' && (
            <label className="block text-sm font-medium">
              Days apart
              <input className={input} inputMode="numeric" value={everyDays} onChange={(e) => setEveryDays(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 10" />
            </label>
          )}
        </div>
      )}
      {item && (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-5" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          Pause it for now (it leaves the forecast)
        </label>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {removing ? (
        <div className="rounded-lg bg-white p-3 text-sm">
          <p>Remove {item!.name}? What you already confirmed stays.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setRemoving(false)} className="h-10 flex-1 rounded-lg border font-medium">
              Keep it
            </button>
            <button type="button" disabled={busy} onClick={() => void remove()} className="h-10 flex-1 rounded-lg bg-destructive font-semibold text-white disabled:opacity-60">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="h-12 flex-1 rounded-lg border bg-white text-base font-medium">
            Cancel
          </button>
          <button type="button" disabled={busy || amount == null || !name.trim()} onClick={() => void save()} className="h-12 flex-[2] rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {item && !removing && (
        <button type="button" onClick={() => setRemoving(true)} className="text-sm font-medium text-muted-foreground">
          Remove it
        </button>
      )}
    </div>
  )
}

function UnplannedForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<BudgetKind>('expense')
  const [name, setName] = useState('')
  const [amountText, setAmountText] = useState('')
  const [on, setOn] = useState(todayIso())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amount = dollars(amountText)
  const save = async () => {
    setBusy(true)
    setError(null)
    const r = await saveBudgetEntry({ itemId: null, plannedOn: null, kind, name, amount: amount ?? 0, on })
    setBusy(false)
    if (r.status === 200) return onDone()
    setError(r.body.error ?? 'That did not save. Try again.')
  }
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-[#F4F7FB] p-4">
      <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="In or out">
        {(['expense', 'income'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${kind === k ? 'bg-white shadow-sm' : 'text-muted-foreground'}`}>
            {k === 'expense' ? 'Went out' : 'Came in'}
          </button>
        ))}
      </div>
      <label className="block text-sm font-medium">
        What was it?
        <input className={input} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'expense' ? 'e.g. Car repair' : 'e.g. Tax refund'} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">
          Amount
          <span className="relative block">
            <span className="absolute top-1/2 left-3 mt-0.5 -translate-y-1/2 text-muted-foreground">$</span>
            <input className={`${input} pl-7`} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0" />
          </span>
        </label>
        <label className="block text-sm font-medium">
          Date
          <input type="date" className={input} max={todayIso()} value={on} onChange={(e) => setOn(e.target.value)} />
        </label>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-12 flex-1 rounded-lg border bg-white text-base font-medium">
          Cancel
        </button>
        <button type="button" disabled={busy || !amount || !name.trim()} onClick={() => void save()} className="h-12 flex-[2] rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function SettingsForm({ budget: b, onDone, onCancel }: { budget: MyHomeBudget; onDone: () => void; onCancel: () => void }) {
  const [cashText, setCashText] = useState(b.startingCash == null ? '' : String(b.startingCash))
  const [on, setOn] = useState(b.startingOn ?? todayIso())
  const [saveText, setSaveText] = useState(b.monthlySavings == null ? '' : String(b.monthlySavings))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true)
    setError(null)
    const cash = dollars(cashText)
    const r = await saveBudgetSettings({ startingCash: cash, startingOn: cash == null ? null : on, monthlySavings: dollars(saveText) })
    setBusy(false)
    if (r.status === 200) return onDone()
    setError(r.body.error ?? 'That did not save. Try again.')
  }
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-[#F4F7FB] p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">
          Cash on hand
          <span className="relative block">
            <span className="absolute top-1/2 left-3 mt-0.5 -translate-y-1/2 text-muted-foreground">$</span>
            <input className={`${input} pl-7`} inputMode="decimal" value={cashText} onChange={(e) => setCashText(e.target.value)} placeholder="Optional" />
          </span>
        </label>
        <label className="block text-sm font-medium">
          As of
          <input type="date" className={input} max={todayIso()} value={on} onChange={(e) => setOn(e.target.value)} />
        </label>
      </div>
      <label className="block text-sm font-medium">
        I want to save each month
        <span className="relative block">
          <span className="absolute top-1/2 left-3 mt-0.5 -translate-y-1/2 text-muted-foreground">$</span>
          <input className={`${input} pl-7`} inputMode="decimal" value={saveText} onChange={(e) => setSaveText(e.target.value)} placeholder="Optional" />
        </span>
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-12 flex-1 rounded-lg border bg-white text-base font-medium">
          Cancel
        </button>
        <button type="button" disabled={busy} onClick={() => void save()} className="h-12 flex-[2] rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function RecentEntries({ entries, onChanged }: { entries: MyHomeBudget['entries']; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const remove = async (id: string) => {
    const r = await removeBudgetEntry(id)
    if (r.status === 200) return onChanged()
    setError(r.body.error ?? 'That did not save. Try again.')
  }
  return (
    <div className="mt-5">
      <h3 className="font-semibold">Confirmed lately</h3>
      <ul className="mt-1 divide-y text-sm">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center gap-2 py-2">
            <span className="w-14 shrink-0 text-muted-foreground">{shortDate(e.on)}</span>
            <span className="min-w-0 flex-1 truncate">
              {e.name}
              {e.plannedOn == null && <span className="text-xs text-muted-foreground"> · unplanned</span>}
            </span>
            <span className={`tabular-nums ${e.kind === 'income' ? 'text-emerald-700' : ''}`}>{e.amount === 0 ? "didn't happen" : `${e.kind === 'income' ? '+' : '−'}${money(e.amount)}`}</span>
            <button type="button" onClick={() => void remove(e.id)} className="text-xs font-medium text-muted-foreground" aria-label={`Undo ${e.name} on ${shortDate(e.on)}`}>
              Undo
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
