// MyHome: My assets (nurture goals Phase 2, Connor's spec 2026-11-24). The
// borrower's own accounts and balances, on the person, so the same list shows
// on every file (open, getting ready, closed) and on their next loan. A name
// ("Chase savings"), the bank, the kind of account, the balance and its date,
// and a note; never account numbers or logins. Each new balance is kept in a
// history. These are the borrower's numbers for tracking; qualifying uses the
// verified statements on the file. A savings goal can follow some of these
// accounts (MyHomeGoals.tsx); a new balance on one of them updates the goal.
import { useEffect, useState } from 'react'
import { Loader2Icon, PlusIcon } from 'lucide-react'
import { fetchAssets, removeAsset, saveAsset } from '@/lib/myhome/api'
import { todayIso } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { ASSET_CATEGORIES, assetProblem, type AssetCategory, type MyHomeAsset } from '../../supabase/functions/myhome/rules'

const card = 'rounded-xl border bg-white p-5 shadow-soft'
const input = 'mt-1 h-12 w-full rounded-lg border border-input bg-white px-3 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20'
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const dollars = (s: string) => {
  const n = Number(s.replace(/[^0-9.]/g, ''))
  return s.trim() !== '' && Number.isFinite(n) ? n : null
}
const categoryLabel = (c: AssetCategory) => ASSET_CATEGORIES.find((x) => x.value === c)?.label ?? c

/** The combined balance of their accounts. */
export const assetsTotal = (assets: MyHomeAsset[]) => Math.round(assets.reduce((s, a) => s + a.balance, 0) * 100) / 100

export type AssetsState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'open'; assets: MyHomeAsset[] }

/** Their accounts, loaded once; reload() after a change. */
export function useMyAssets(): { state: AssetsState; reload: () => Promise<void> } {
  const [state, setState] = useState<AssetsState>({ kind: 'loading' })
  const reload = async () => {
    const r = await fetchAssets()
    if (r.status === 200 && r.body.assets) return setState({ kind: 'open', assets: r.body.assets })
    setState({ kind: 'error', message: r.body.error ?? 'Your accounts could not load.' })
  }
  useEffect(() => {
    void reload()
  }, [])
  return { state, reload }
}

/** The My assets card on its own (open and closed files). */
export function MyAssetsSection() {
  const { state, reload } = useMyAssets()
  return <MyAssets state={state} onChanged={() => void reload()} />
}

/** The card: total, each account with Update / Edit / Remove, and Add an account. */
export function MyAssets({ state, onChanged, loFirst }: { state: AssetsState; onChanged: () => void; loFirst?: string }) {
  const [adding, setAdding] = useState(false)
  if (state.kind === 'loading')
    return (
      <p className="flex items-center justify-center gap-2 rounded-xl border bg-white py-8 text-sm text-muted-foreground shadow-soft">
        <Loader2Icon className="size-4 animate-spin" /> Loading your accounts…
      </p>
    )
  if (state.kind === 'error')
    return (
      <section className={`${card} text-center`}>
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <button type="button" onClick={onChanged} className="mt-3 h-10 rounded-lg border px-4 text-sm font-medium">
          Try again
        </button>
      </section>
    )
  const { assets } = state
  return (
    <section className={card} aria-labelledby="myhome-assets">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="myhome-assets" className="text-lg font-bold tracking-tight">
            My assets
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Keep track of what you have saved. Only names and balances: never account numbers or passwords.</p>
        </div>
        {assets.length > 0 && (
          <div className="shrink-0 text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-extrabold tabular-nums">{formatCurrency(assetsTotal(assets))}</p>
          </div>
        )}
      </div>
      {assets.length > 0 && (
        <ul className="mt-3 divide-y">
          {assets.map((a) => (
            <AssetRow key={a.id} asset={a} onChanged={onChanged} />
          ))}
        </ul>
      )}
      {adding ? (
        <AssetForm onDone={() => (setAdding(false), onChanged())} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="mt-3 flex h-12 w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed text-base font-semibold text-primary">
          <PlusIcon className="size-5" /> Add an account
        </button>
      )}
      <p className="mt-3 text-xs text-muted-foreground">These are your own numbers for tracking. To qualify, {loFirst ?? 'your loan officer'} uses your statements.</p>
    </section>
  )
}

function AssetRow({ asset: a, onChanged }: { asset: MyHomeAsset; onChanged: () => void }) {
  const [mode, setMode] = useState<'view' | 'balance' | 'edit' | 'remove' | 'history'>('view')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = async () => {
    setBusy(true)
    const r = await removeAsset(a.id)
    setBusy(false)
    if (r.status === 200) return onChanged()
    setError(r.body.error ?? 'That did not save. Try again.')
  }
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{a.nickname}</p>
          <p className="text-sm text-muted-foreground">{[a.institution, categoryLabel(a.category)].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-bold tabular-nums">{formatCurrency(a.balance)}</p>
          <p className="text-xs text-muted-foreground">as of {shortDate(a.balanceOn)}</p>
        </div>
      </div>
      {a.notes && mode === 'view' && <p className="mt-1 text-sm text-muted-foreground">{a.notes}</p>}
      {mode === 'view' && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-primary">
          <button type="button" onClick={() => setMode('balance')}>
            Update balance
          </button>
          <button type="button" onClick={() => setMode('edit')}>
            Edit
          </button>
          {a.history.length > 0 && (
            <button type="button" onClick={() => setMode('history')}>
              History
            </button>
          )}
          <button type="button" onClick={() => setMode('remove')} className="text-muted-foreground">
            Remove
          </button>
        </div>
      )}
      {mode === 'balance' && <AssetForm asset={a} balanceOnly onDone={() => (setMode('view'), onChanged())} onCancel={() => setMode('view')} />}
      {mode === 'edit' && <AssetForm asset={a} onDone={() => (setMode('view'), onChanged())} onCancel={() => setMode('view')} />}
      {mode === 'history' && (
        <div className="mt-2">
          <ul className="divide-y rounded-lg border text-sm">
            <li className="flex justify-between px-3 py-2 font-semibold">
              <span>{shortDate(a.balanceOn)}</span>
              <span className="tabular-nums">{formatCurrency(a.balance)}</span>
            </li>
            {a.history.map((h, i) => (
              <li key={i} className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">{shortDate(h.on)}</span>
                <span className="tabular-nums">{formatCurrency(h.balance)}</span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setMode('view')} className="mt-2 text-sm font-medium text-primary">
            Hide history
          </button>
        </div>
      )}
      {mode === 'remove' && (
        <div className="mt-2 rounded-lg bg-[#F4F7FB] p-3 text-sm">
          <p>Remove {a.nickname} from MyHome? A savings goal that counts it stops counting it.</p>
          {error && <p className="mt-1 text-destructive">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setMode('view')} className="h-10 flex-1 rounded-lg border bg-white font-medium">
              Keep it
            </button>
            <button type="button" disabled={busy} onClick={() => void remove()} className="h-10 flex-1 rounded-lg bg-destructive font-semibold text-white disabled:opacity-60">
              {busy ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Add an account, change one, or (balanceOnly) just type its new balance. */
function AssetForm({ asset, balanceOnly, onDone, onCancel }: { asset?: MyHomeAsset; balanceOnly?: boolean; onDone: () => void; onCancel: () => void }) {
  const [nickname, setNickname] = useState(asset?.nickname ?? '')
  const [institution, setInstitution] = useState(asset?.institution ?? '')
  const [category, setCategory] = useState<AssetCategory>(asset?.category ?? 'savings')
  const [balanceText, setBalanceText] = useState(asset && !balanceOnly ? String(asset.balance) : '')
  const [on, setOn] = useState(asset && !balanceOnly ? asset.balanceOn : todayIso())
  const [notes, setNotes] = useState(asset?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const balance = dollars(balanceText)
  const save = async () => {
    const v = { nickname, institution: institution.trim() || null, category, balance: balance ?? NaN, balanceOn: on || null, notes: notes.trim() || null }
    const problem = assetProblem(v, todayIso())
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const r = await saveAsset({ ...v, assetId: asset?.id ?? null })
    setBusy(false)
    if (r.status === 200) return onDone()
    setError(r.body.error ?? 'That did not save. Try again.')
  }
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-[#F4F7FB] p-4">
      {!balanceOnly && (
        <>
          <label className="block text-sm font-medium">
            Name
            <input className={input} maxLength={80} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder='e.g. "Chase savings"' />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Bank or company (optional)
              <input className={input} maxLength={80} value={institution} onChange={(e) => setInstitution(e.target.value)} />
            </label>
            <label className="block text-sm font-medium">
              Kind
              <select className={input} value={category} onChange={(e) => setCategory(e.target.value as AssetCategory)}>
                {ASSET_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">
          {balanceOnly ? `${asset!.nickname} now` : 'Balance'}
          <span className="relative block">
            <span className="absolute top-1/2 left-3 mt-0.5 -translate-y-1/2 text-muted-foreground">$</span>
            <input className={`${input} pl-7`} inputMode="decimal" placeholder="0" value={balanceText} onChange={(e) => setBalanceText(e.target.value)} />
          </span>
        </label>
        <label className="block text-sm font-medium">
          As of
          <input type="date" className={input} max={todayIso()} value={on} onChange={(e) => setOn(e.target.value)} />
        </label>
      </div>
      {!balanceOnly && (
        <label className="block text-sm font-medium">
          Note (optional)
          <textarea className={`${input} h-auto min-h-16 py-2`} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-12 flex-1 rounded-lg border bg-white text-base font-medium">
          Cancel
        </button>
        <button type="button" disabled={busy || balance == null || (!balanceOnly && !nickname.trim())} onClick={() => void save()} className="h-12 flex-[2] rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
