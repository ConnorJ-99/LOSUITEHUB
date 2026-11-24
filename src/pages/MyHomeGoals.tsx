// MyHome for a Nurture loan: My goals (Nurture goals Phase 1, Connor's spec
// 2026-11-24). One card per goal the loan officer set: a progress bar, the
// plain-language line ("You're $1,200 away from your savings goal."), an
// Update button that takes a few taps (a new balance or a contribution, a new
// score, a payment or a new balance), "I reached this goal", and the history.
// A completed check shows only after the loan officer verifies. Self-reported
// numbers are for tracking; qualifying needs verified figures and a mortgage
// credit report. Math in src/lib/calc/goals.ts.
// Phase 2: My assets shows here too, and a savings goal can follow the
// accounts the borrower ticks (its balance is their total, kept up to date
// whenever one of them gets a new balance).
import { useEffect, useState } from 'react'
import { CheckCircle2Icon, Loader2Icon, PauseIcon } from 'lucide-react'
import { fetchNurture, followAssets, sendGoalUpdate } from '@/lib/myhome/api'
import { goalLine, goalProgress, savingsPace } from '@/lib/calc/goals'
import { todayIso } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import type { GoalUpdateKind, MyHomeAsset, MyHomeGoal, MyHomeNurture } from '../../supabase/functions/myhome/rules'
import { MyAssets, assetsTotal, useMyAssets } from './MyHomeAssets'
import { LoCard } from './PublicUploadPage'

const card = 'rounded-xl border bg-white p-5 shadow-soft'
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const show = (g: Pick<MyHomeGoal, 'kind'>, v: number | null) => (v == null ? '—' : g.kind === 'credit' ? String(Math.round(v)) : formatCurrency(Math.round(v)))
const dollars = (s: string) => {
  const n = Number(s.replace(/[^0-9.]/g, ''))
  return s.trim() !== '' && Number.isFinite(n) ? n : null
}

type Screen = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'open'; view: MyHomeNurture }

export function NurtureFile({ loanId, onGone, onSignedOut }: { loanId: string; onGone: () => void; onSignedOut: () => void }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' })
  const mine = useMyAssets()
  const load = async (opened: boolean) => {
    const r = await fetchNurture(loanId, opened)
    if (r.status === 200 && r.body.goals && r.body.lo) return setScreen({ kind: 'open', view: r.body as MyHomeNurture })
    if (r.status === 401) return onSignedOut()
    if (r.status === 403 || r.status === 404 || r.status === 409) return onGone()
    setScreen({ kind: 'error', message: r.body.error ?? 'Your goals could not load. Try again.' })
  }
  useEffect(() => {
    void load(true)
    // Once per loan (the parent remounts this for another loan).
  }, [])

  if (screen.kind === 'loading')
    return (
      <p className="flex items-center justify-center gap-2 rounded-xl border bg-white py-12 text-sm text-muted-foreground shadow-soft">
        <Loader2Icon className="size-4 animate-spin" /> Loading your goals…
      </p>
    )
  if (screen.kind === 'error')
    return (
      <section className={`${card} text-center`}>
        <p className="text-sm text-muted-foreground">{screen.message}</p>
        <button type="button" onClick={() => void load(false)} className="mt-3 h-10 rounded-lg border px-4 text-sm font-medium">
          Try again
        </button>
      </section>
    )
  const { goals, lo } = screen.view
  const loFirst = lo.name.split(/\s+/)[0] || 'your loan officer'
  const assets = mine.state.kind === 'open' ? mine.state.assets : []
  // The combined total leads only when there's a savings goal to measure it against.
  const showTotal = assets.length > 0 && goals.some((g) => g.kind === 'savings')
  const changed = () => {
    void mine.reload()
    void load(false)
  }
  return (
    <>
      <section className={card} aria-labelledby="myhome-goals">
        <h2 id="myhome-goals" className="text-lg font-bold tracking-tight">
          My goals
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {goals.length ? `What you and ${loFirst} are working toward. Update them any time; ${loFirst} sees each update.` : `${loFirst} will add your goals here: savings, credit or paying down a debt.`}
        </p>
        {showTotal && (
          <p className="mt-3 flex items-baseline justify-between rounded-lg bg-[#F4F7FB] px-3 py-2.5">
            <span className="text-sm text-muted-foreground">In your accounts</span>
            <span className="text-xl font-extrabold tabular-nums">{formatCurrency(assetsTotal(assets))}</span>
          </p>
        )}
      </section>
      {goals.map((g) => (
        <GoalCard key={g.id} loanId={loanId} goal={g} assets={assets} loFirst={loFirst} onChanged={() => void load(false)} onGone={onGone} />
      ))}
      <MyAssets state={mine.state} onChanged={changed} loFirst={loFirst} />
      <LoCard lo={lo} />
    </>
  )
}

function GoalCard({ loanId, goal: g, assets, loFirst, onChanged, onGone }: { loanId: string; goal: MyHomeGoal; assets: MyHomeAsset[]; loFirst: string; onChanged: () => void; onGone: () => void }) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const followed = assets.filter((a) => g.followsAssets.includes(a.id))
  const [history, setHistory] = useState(false)
  const p = goalProgress({ kind: g.kind, start: g.start, target: g.target, current: g.current })
  const done = g.status === 'verified_complete'
  const pace = g.kind === 'savings' && !done ? savingsPace(p.remaining, g.targetDate, todayIso()) : null
  const title = g.kind === 'savings' ? 'Savings goal' : g.kind === 'credit' ? 'Credit score goal' : 'Pay-down goal'
  return (
    <section className={card} aria-label={g.label}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
          <h3 className="text-lg font-bold tracking-tight">{g.label}</h3>
        </div>
        {done && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2Icon className="size-4" />
            Complete
          </span>
        )}
        {!done && g.status === 'reported_complete' && <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">Waiting for {loFirst}</span>}
        {g.paused && !done && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            <PauseIcon className="size-3.5" />
            Paused
          </span>
        )}
      </div>

      <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.label}: ${p.pct}%`}>
        <div className={`h-full rounded-full ${done ? 'bg-emerald-600' : 'bg-primary'}`} style={{ width: `${p.pct}%` }} />
      </div>
      <p className="mt-2 font-semibold">{goalLine(g.kind, g.label, p)}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">{g.kind === 'credit' ? 'Started at' : g.kind === 'debt' ? 'Started at' : 'Started with'}</dt>
          <dd className="font-bold tabular-nums">{show(g, g.start)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Now</dt>
          <dd className="font-bold tabular-nums">{show(g, g.current)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{g.kind === 'debt' ? 'Target balance' : 'Target'}</dt>
          <dd className="font-bold tabular-nums">{show(g, g.target)}</dd>
        </div>
      </dl>
      {g.currentAt && <p className="mt-1 text-xs text-muted-foreground">Last updated {shortDate(g.currentAt)}</p>}
      {pace && (
        <p className="mt-3 rounded-lg bg-[#F4F7FB] px-3 py-2.5 text-sm">
          To reach it by <strong>{shortDate(g.targetDate!)}</strong>: about <strong>{formatCurrency(Math.ceil(pace.perWeek))}</strong> a week, {formatCurrency(Math.ceil(pace.perTwoWeeks))} every two weeks, or {formatCurrency(Math.ceil(pace.perMonth))} a month.
        </p>
      )}
      {g.kind === 'savings' && !done && !g.paused && (
        <div className="mt-3 rounded-lg border px-3 py-2.5 text-sm">
          {picking ? (
            <FollowPicker loanId={loanId} goal={g} assets={assets} onDone={() => (setPicking(false), onChanged())} onCancel={() => setPicking(false)} onGone={onGone} />
          ) : followed.length ? (
            <p>
              Counting <strong>{followed.map((a) => a.nickname).join(', ')}</strong>. A new balance in My assets updates this goal.{' '}
              <button type="button" onClick={() => setPicking(true)} className="font-medium text-primary">
                Change
              </button>
            </p>
          ) : assets.length ? (
            <p>
              Let this goal follow your accounts in My assets.{' '}
              <button type="button" onClick={() => setPicking(true)} className="font-medium text-primary">
                Pick accounts
              </button>
            </p>
          ) : (
            <p className="text-muted-foreground">Add your accounts in My assets below and this goal can follow them.</p>
          )}
        </div>
      )}
      {g.kind === 'credit' && <p className="mt-2 text-xs text-muted-foreground">Scores you report help track your progress. To qualify, {loFirst} uses a mortgage credit report.</p>}

      {open ? (
        <UpdateForm loanId={loanId} goal={g} following={followed.length > 0} onDone={() => (setOpen(false), onChanged())} onCancel={() => setOpen(false)} onGone={onGone} />
      ) : (
        !done &&
        !g.paused && (
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setOpen(true)} className="h-12 flex-1 rounded-lg bg-primary text-base font-semibold text-white">
              {g.kind === 'credit' ? 'Update my score' : g.kind === 'debt' ? 'Update my balance' : 'Update my savings'}
            </button>
          </div>
        )
      )}
      {g.paused && !done && <p className="mt-3 text-sm text-muted-foreground">{loFirst} paused this goal for now.</p>}

      {g.history.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setHistory((h) => !h)} className="text-sm font-medium text-primary">
            {history ? 'Hide history' : 'See history'}
          </button>
          {history && (
            <ul className="mt-2 divide-y rounded-lg border text-sm">
              {g.history.map((h, i) => (
                <li key={i} className="flex gap-2 px-3 py-2">
                  <span className="w-24 shrink-0 text-muted-foreground">{shortDate(h.on)}</span>
                  <span className="min-w-0 flex-1">{historyLine(g, h, loFirst)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function historyLine(g: MyHomeGoal, h: MyHomeGoal['history'][number], loFirst: string): string {
  const v = (n: number | null) => show(g, n)
  switch (h.kind) {
    case 'contribution':
      return `You added ${v(h.amount)} (now ${v(h.after)})`
    case 'payment':
      return `You paid ${v(h.amount)} (now ${v(h.after)})`
    case 'reported_complete':
      return 'You said you reached this goal'
    case 'note':
      return `Note: ${h.note ?? ''}`
    case 'verified':
      return `${loFirst} checked it${h.after != null ? `: ${v(h.after)}` : ''}${h.note ? ` · ${h.note.toLowerCase()}` : ''}`
    case 'target_changed':
      return `${loFirst} changed the target to ${v(h.after)}`
    default:
      return `${h.byBorrower ? 'You' : loFirst} updated it to ${v(h.after)}${h.note ? ` · ${h.note}` : ''}`
  }
}

/** A few taps: pick what happened, type the number, Save. */
function UpdateForm({ loanId, goal: g, following, onDone, onCancel, onGone }: { loanId: string; goal: MyHomeGoal; following: boolean; onDone: () => void; onCancel: () => void; onGone: () => void }) {
  // A goal that follows accounts gets its balance from My assets; here only a note.
  const choices: { kind: GoalUpdateKind; label: string }[] = following
    ? [{ kind: 'note', label: 'Add a note' }]
    : g.kind === 'savings'
      ? [
          { kind: 'balance', label: 'My savings now' },
          { kind: 'contribution', label: 'I added money' },
        ]
      : g.kind === 'debt'
        ? [
            { kind: 'payment', label: 'I made a payment' },
            { kind: 'balance', label: 'My balance now' },
          ]
        : [{ kind: 'score', label: 'My new score' }]
  const [kind, setKind] = useState<GoalUpdateKind>(choices[0].kind)
  const [amountText, setAmountText] = useState('')
  const [on, setOn] = useState(todayIso())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amount = dollars(amountText)
  const isScore = kind === 'score'
  const isNote = kind === 'note'
  const input = 'mt-1 h-12 w-full rounded-lg border border-input bg-white px-3 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20'
  const send = async (k: GoalUpdateKind, value: number | null) => {
    setBusy(true)
    setError(null)
    const r = await sendGoalUpdate(loanId, { goalId: g.id, kind: k, amount: value, on, note: note.trim() || null })
    setBusy(false)
    if (r.status === 200) return onDone()
    if (r.status === 401 || r.status === 409) return onGone()
    setError(r.body.error ?? 'That did not save. Try again.')
  }
  return (
    <div className="mt-4 space-y-3 rounded-xl bg-[#F4F7FB] p-4">
      {choices.length > 1 && (
        <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="What happened">
          {choices.map((c) => (
            <button key={c.kind} type="button" role="tab" aria-selected={kind === c.kind} onClick={() => setKind(c.kind)} className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${kind === c.kind ? 'bg-white shadow-sm' : 'text-muted-foreground'}`}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {isNote ? (
        <p className="text-sm text-muted-foreground">This goal follows your accounts: update a balance in My assets and it moves here.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            {choices.find((c) => c.kind === kind)!.label}
            <span className="relative block">
              {!isScore && <span className="absolute top-1/2 left-3 mt-0.5 -translate-y-1/2 text-muted-foreground">$</span>}
              <input className={`${input} ${isScore ? '' : 'pl-7'}`} inputMode="decimal" placeholder={isScore ? 'e.g. 612' : '0'} value={amountText} onChange={(e) => setAmountText(e.target.value)} />
            </span>
          </label>
          <label className="block text-sm font-medium">
            Date
            <input type="date" className={input} max={todayIso()} value={on} onChange={(e) => setOn(e.target.value)} />
          </label>
        </div>
      )}
      <label className="block text-sm font-medium">
        {isScore ? 'What helped? (optional)' : isNote ? 'Note' : 'Note (optional)'}
        <textarea className={`${input} h-auto min-h-16 py-2`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={isScore ? 'e.g. Paid my store card under 30%' : ''} />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-12 flex-1 rounded-lg border bg-white text-base font-medium">
          Cancel
        </button>
        <button type="button" disabled={busy || (isNote ? !note.trim() : amount == null)} onClick={() => void send(kind, isNote ? null : amount)} className="h-12 flex-[2] rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {g.status !== 'reported_complete' && (
        <button type="button" disabled={busy} onClick={() => void send('reported_complete', null)} className="h-11 w-full rounded-lg border-2 border-emerald-600 text-sm font-semibold text-emerald-700 disabled:opacity-60">
          I reached this goal
        </button>
      )}
    </div>
  )
}

/** Tick the accounts a savings goal counts; none = type the balance by hand again. */
function FollowPicker({ loanId, goal: g, assets, onDone, onCancel, onGone }: { loanId: string; goal: MyHomeGoal; assets: MyHomeAsset[]; onDone: () => void; onCancel: () => void; onGone: () => void }) {
  const [picked, setPicked] = useState<string[]>(g.followsAssets.filter((id) => assets.some((a) => a.id === id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const total = assets.filter((a) => picked.includes(a.id)).reduce((sum, a) => sum + a.balance, 0)
  const save = async () => {
    setBusy(true)
    setError(null)
    const r = await followAssets(loanId, g.id, picked)
    setBusy(false)
    if (r.status === 200) return onDone()
    if (r.status === 401 || r.status === 409) return onGone()
    setError(r.body.error ?? 'That did not save. Try again.')
  }
  return (
    <div className="space-y-2">
      <p className="font-medium">Which accounts count toward {g.label}?</p>
      {assets.map((a) => (
        <label key={a.id} className="flex min-h-11 items-center gap-3 rounded-lg border bg-white px-3">
          <input type="checkbox" className="size-5" checked={picked.includes(a.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))} />
          <span className="min-w-0 flex-1">{a.nickname}</span>
          <span className="tabular-nums">{formatCurrency(a.balance)}</span>
        </label>
      ))}
      <p className="text-muted-foreground">{picked.length ? `This goal will show ${formatCurrency(total)}.` : 'None ticked: you type your savings yourself.'}</p>
      {error && <p className="text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-11 flex-1 rounded-lg border bg-white font-medium">
          Cancel
        </button>
        <button type="button" disabled={busy} onClick={() => void save()} className="h-11 flex-[2] rounded-lg bg-primary font-semibold text-white disabled:opacity-60">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
