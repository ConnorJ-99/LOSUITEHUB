// MyHome closed view, Step C (Connor 2026-11-24): "Options for my home".
// - Equity: what they could borrow against the home (up to 80% of its value
//   less what they owe; src/lib/calc/homeValue.ts cashOutRoom) and "Ask {LO}
//   about my equity options".
// - Refinance: "You may be able to save about $X/mo" when the myhome function
//   found it against the latest Refi Watch pricing (no rate is ever sent), else
//   a plain line, and "Ask {LO} to check my refinance options".
// - Start something new: Buy another home / Refinance this home / Borrow
//   against my equity opens the online application, already started with
//   their name, email and phone for this loan officer.
// Each card shows only when Settings → MyHome has it on.
import { useState } from 'react'
import { CheckIcon } from 'lucide-react'
import { amortization, loggedExtras, mortgageToday } from '@/lib/calc/amortization'
import { cashOutRoom, homeValue } from '@/lib/calc/homeValue'
import { todayIso } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { askLo, startNew } from '@/lib/myhome/api'
import type { AskKind, MyHomeClosed, StartGoal } from '../../supabase/functions/myhome/rules'

const card = 'rounded-xl border bg-white p-5 shadow-soft'
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
/** Where /apply keeps the resume code on this device (ApplicationWizard's RESUME_KEY). */
const RESUME_KEY = 'mps-application-resume'

/** The value MyHome shows and the balance today (counting logged extra payments), as the home value card does. */
function valueAndBalance(view: MyHomeClosed): { value: number | null; balance: number | null } {
  const ix = view.index
  const value = homeValue(view.value, ix ? { base: ix.base, baseIndex: ix.baseIndex, latestIndex: ix.latestIndex, loadedOn: ix.loadedOn } : null)
  if (!view.balance) return { value: value?.amount ?? null, balance: null }
  const extras = view.extraPaid?.length ? loggedExtras(view.balance.firstPaymentDate ?? amortization(view.balance)?.firstPaymentDate ?? todayIso(), view.extraPaid) : undefined
  const today = mortgageToday(view.balance, todayIso(), value?.amount ?? null, extras)
  return { value: value?.amount ?? null, balance: today?.balance ?? null }
}

export function HomeOptions({ loanId, view, loFirst, onAsked, onGone }: { loanId: string; view: MyHomeClosed; loFirst: string; onAsked: (kind: AskKind, at: string) => void; onGone: () => void }) {
  const o = view.options
  if (!o || (!o.refiCard && !o.equityCard && !o.startNew)) return null
  const { value, balance } = valueAndBalance(view)
  const room = value != null && balance != null ? cashOutRoom(value, balance) : null
  return (
    <section className={card} aria-labelledby="myhome-options">
      <h2 id="myhome-options" className="text-lg font-bold tracking-tight">
        Options for my home
      </h2>
      {o.equityCard && (
        <div className="mt-3 rounded-lg bg-[#F4F7FB] p-4">
          <h3 className="font-semibold">My equity</h3>
          {room != null && room > 0 ? (
            <p className="mt-1 text-sm">
              You may be able to borrow about <strong className="text-emerald-700">{formatCurrency(room)}</strong> against your home (up to 80% of its value, less what you owe).
            </p>
          ) : room === 0 ? (
            <p className="mt-1 text-sm">Your equity is still building. {loFirst} can tell you when borrowing against it could make sense.</p>
          ) : (
            <p className="mt-1 text-sm">{loFirst} can look at how much you could borrow against your home.</p>
          )}
          <AskButton loanId={loanId} kind="equity_check" asked={view.asked.equity_check ?? null} label={`Ask ${loFirst} about my equity options`} loFirst={loFirst} onAsked={onAsked} onGone={onGone} />
        </div>
      )}
      {o.refiCard && (
        <div className="mt-3 rounded-lg bg-[#F4F7FB] p-4">
          <h3 className="font-semibold">Refinancing</h3>
          {o.refiMonthly ? (
            <p className="mt-1 text-sm">
              You may be able to save about <strong className="text-emerald-700">{formatCurrency(o.refiMonthly)}/mo</strong> by refinancing.
            </p>
          ) : (
            <p className="mt-1 text-sm">Rates change. {loFirst} can check whether refinancing could lower your payment.</p>
          )}
          <AskButton loanId={loanId} kind="refi_check" asked={view.asked.refi_check ?? null} label={`Ask ${loFirst} to check my refinance options`} loFirst={loFirst} onAsked={onAsked} onGone={onGone} />
          {o.refiMonthly != null && <p className="mt-2 text-xs text-muted-foreground">An estimate from recent market pricing for loans like yours, before closing costs. Not a quote, a rate lock or an offer to lend.</p>}
        </div>
      )}
      {o.startNew && <StartSomethingNew loanId={loanId} onGone={onGone} />}
    </section>
  )
}

function AskButton({ loanId, kind, asked, label, loFirst, onAsked, onGone }: { loanId: string; kind: AskKind; asked: string | null; label: string; loFirst: string; onAsked: (kind: AskKind, at: string) => void; onGone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (asked)
    return (
      <p className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
        <CheckIcon className="size-4 shrink-0" />
        Asked {shortDate(asked)}. {loFirst} will get back to you.
      </p>
    )
  const ask = async () => {
    setBusy(true)
    setError(null)
    const r = await askLo(loanId, kind)
    setBusy(false)
    if (r.status === 200 && r.body.askedAt) return onAsked(kind, r.body.askedAt)
    if (r.status === 401 || r.status === 404 || r.status === 409) return onGone()
    setError(r.body.error ?? 'That did not go through. Try again.')
  }
  return (
    <>
      <button type="button" onClick={() => void ask()} disabled={busy} className="mt-3 h-12 w-full rounded-lg border-2 border-primary bg-white text-base font-semibold text-primary disabled:opacity-60">
        {busy ? 'Sending…' : label}
      </button>
      {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
    </>
  )
}

const STARTS: { goal: StartGoal; label: string }[] = [
  { goal: 'purchase', label: 'Buy another home' },
  { goal: 'refinance', label: 'Refinance this home' },
  { goal: 'equity', label: 'Borrow against my equity' },
]

function StartSomethingNew({ loanId, onGone }: { loanId: string; onGone: () => void }) {
  const [busy, setBusy] = useState<StartGoal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const start = async (goal: StartGoal) => {
    setBusy(goal)
    setError(null)
    const r = await startNew(loanId, goal)
    if (r.status === 200 && r.body.resume) {
      // /apply picks up the started application from this device.
      try {
        localStorage.setItem(RESUME_KEY, r.body.resume)
      } catch {
        setBusy(null)
        return setError('Your browser blocked saving your place. Turn off private browsing and try again.')
      }
      window.location.assign('/apply')
      return
    }
    setBusy(null)
    if (r.status === 401 || r.status === 404 || r.status === 409) return onGone()
    setError(r.body.error ?? 'That did not go through. Try again.')
  }
  return (
    <div className="mt-3">
      <h3 className="font-semibold">Start something new</h3>
      <p className="mt-1 text-sm text-muted-foreground">Your application starts with what we already know about you.</p>
      <div className="mt-2 grid gap-2">
        {STARTS.map((s) => (
          <button key={s.goal} type="button" disabled={busy != null} onClick={() => void start(s.goal)} className="h-12 w-full rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
            {busy === s.goal ? 'Starting…' : s.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
    </div>
  )
}
