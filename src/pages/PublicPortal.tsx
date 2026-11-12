// The borrower portal's sections on /u/{token} (a portal link): where the loan
// stands, the document checklist with a progress bar, published letters and
// estimates by home, and "Request numbers" for a home. Borrowers only ever
// request: letters and estimates come from the loan officer. Phone first.
import { useState } from 'react'
import { CheckIcon, FileTextIcon, HomeIcon, Loader2Icon, PlusIcon } from 'lucide-react'
import { callDocumentUpload } from '@/lib/api/documentUpload'
import { formatCurrency } from '@/lib/format'
import { PORTAL_STEPS, PUBLISHED_KIND_LABEL, REQUEST_STATUS_LABEL, docProgress, homeRequestProblem, type HomeRequestInput, type PortalHome, type PortalView } from '../../supabase/functions/document-upload/portal'
import type { UploadItem } from '../../supabase/functions/document-upload/rules'

const card = 'rounded-xl border bg-white p-4 shadow-soft'
const field = 'mt-1 h-11 w-full rounded-lg border border-input bg-white px-3 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20'

export function PortalHeader({ view }: { view: PortalView }) {
  const at = PORTAL_STEPS.findIndex((s) => s.id === view.step)
  return (
    <section className={card} aria-labelledby="portal-status">
      <h1 id="portal-status" className="text-xl font-bold tracking-tight">
        {view.borrowerFirstName ? `Hi ${view.borrowerFirstName},` : 'Your loan'}
      </h1>
      <p className="mt-0.5 text-sm text-muted-foreground">Here's where your loan stands.</p>
      <ol className="mt-4 space-y-0">
        {PORTAL_STEPS.map((s, i) => {
          const done = i < at
          const current = i === at
          return (
            <li key={s.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? 'bg-nurture text-white' : current ? 'bg-primary text-white ring-4 ring-primary/15' : 'border bg-white text-muted-foreground'}`} aria-hidden>
                  {done ? <CheckIcon className="size-3.5" /> : i + 1}
                </span>
                {i < PORTAL_STEPS.length - 1 && <span className={`w-0.5 flex-1 ${done ? 'bg-nurture' : 'bg-border'}`} style={{ minHeight: '1rem' }} />}
              </div>
              <div className="pb-3">
                <p className={`text-sm leading-6 ${current ? 'font-semibold text-foreground' : done ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {s.label}
                  {current && <span className="sr-only"> (current step)</span>}
                </p>
                {current && <p className="text-sm text-muted-foreground">{view.stepMessage}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function DocProgress({ items }: { items: UploadItem[] }) {
  const p = docProgress(items)
  if (p.total === 0) return null
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">
          {p.done} of {p.total} documents in
        </span>
        <span className="text-muted-foreground tabular-nums">{p.pct}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Documents in">
        <div className="h-full rounded-full bg-nurture transition-all" style={{ width: `${p.pct}%` }} />
      </div>
    </div>
  )
}

export function LettersAndHomes({ view, token, session, onChanged, onExpired }: { view: PortalView; token: string; session: string; onChanged: () => void; onExpired: () => void }) {
  const [asking, setAsking] = useState(false)
  const homes = view.homes
  return (
    <>
      <section className="space-y-3" aria-labelledby="portal-letters">
        <h2 id="portal-letters" className="text-lg font-bold tracking-tight">
          My letters & estimates
        </h2>
        {homes.every((h) => h.docs.length === 0) ? (
          <p className={`${card} text-sm text-muted-foreground`}>Nothing here yet. When your loan officer shares a pre-approval letter or a payment estimate with you, it shows up here.</p>
        ) : (
          homes.filter((h) => h.docs.length > 0).map((h) => <HomeDocs key={`${h.propertyId}-${h.address}`} home={h} token={token} session={session} onExpired={onExpired} />)
        )}
      </section>

      {view.isPurchase && (
        <section className="space-y-3" aria-labelledby="portal-homes">
          <div className="flex items-center gap-2">
            <h2 id="portal-homes" className="mr-auto text-lg font-bold tracking-tight">
              My properties
            </h2>
            {!asking && (
              <button type="button" onClick={() => setAsking(true)} className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-white">
                <PlusIcon className="size-4" />
                Request numbers
              </button>
            )}
          </div>
          {asking && (
            <HomeRequestForm
              token={token}
              session={session}
              onDone={() => {
                setAsking(false)
                onChanged()
              }}
              onCancel={() => setAsking(false)}
              onExpired={onExpired}
            />
          )}
          {homes.filter((h) => h.request).length === 0 && !asking && <p className={`${card} text-sm text-muted-foreground`}>Found a home you like? Tap Request numbers and your loan officer will prepare a pre-approval letter or a payment estimate for it.</p>}
          {homes
            .filter((h) => h.request)
            .map((h) => (
              <div key={h.request!.id} className={`${card} flex items-start gap-3`}>
                <HomeIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{h.address}</p>
                  <p className="text-sm text-muted-foreground">
                    {h.price != null ? formatCurrency(h.price) : ''}
                    {h.request!.wantsLetter && ' · Pre-approval letter'}
                    {h.request!.wantsEstimate && ' · Payment estimate'}
                  </p>
                </div>
                <RequestChip status={h.request!.status} />
              </div>
            ))}
        </section>
      )}
    </>
  )
}

function RequestChip({ status }: { status: keyof typeof REQUEST_STATUS_LABEL }) {
  const tone = status === 'ready' ? 'bg-emerald-50 text-emerald-700' : status === 'in_progress' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{REQUEST_STATUS_LABEL[status]}</span>
}

function HomeDocs({ home, token, session, onExpired }: { home: PortalHome; token: string; session: string; onExpired: () => void }) {
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const open = async (id: string) => {
    setOpening(id)
    setError(null)
    // Open the tab first (phones block pop-ups that open after a wait), then point it at the PDF.
    const tab = window.open('', '_blank')
    const r = await callDocumentUpload({ action: 'pdf', token, session, documentId: id })
    setOpening(null)
    if (r.status === 401 || r.status === 410) {
      tab?.close()
      return onExpired()
    }
    if (r.status !== 200 || !r.body.url) {
      tab?.close()
      return setError(r.body.error ?? 'The PDF could not open. Try again.')
    }
    if (tab) tab.location.href = r.body.url
    else window.location.href = r.body.url
  }
  return (
    <div className={card}>
      <p className="font-semibold">{home.address}</p>
      <ul className="mt-2 divide-y">
        {home.docs.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => void open(d.id)} disabled={opening != null} className="flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-60">
              {opening === d.id ? <Loader2Icon className="size-5 shrink-0 animate-spin text-primary" /> : <FileTextIcon className="size-5 shrink-0 text-primary" />}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{PUBLISHED_KIND_LABEL[d.kind]}</span>
                <span className="block text-xs text-muted-foreground">{new Date(d.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · PDF</span>
              </span>
              <span className="text-sm font-medium text-primary">Open</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

function HomeRequestForm({ token, session, onDone, onCancel, onExpired }: { token: string; session: string; onDone: () => void; onCancel: () => void; onExpired: () => void }) {
  const [r, setR] = useState<HomeRequestInput>({ address: '', city: '', state: 'TX', zip: '', price: null, downMode: 'percent', down: null, wantsLetter: true, wantsEstimate: true, notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof HomeRequestInput>(k: K, v: HomeRequestInput[K]) => setR((x) => ({ ...x, [k]: v }))
  const num = (s: string) => {
    const n = Number(s.replace(/[^0-9.]/g, ''))
    return s.trim() === '' || !Number.isFinite(n) ? null : n
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const problem = homeRequestProblem(r)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const res = await callDocumentUpload({ action: 'home_request', token, session, request: r })
    setBusy(false)
    if (res.status === 401 || res.status === 410) return onExpired()
    if (res.status !== 200) return setError(res.body.error ?? 'That did not go through. Try again.')
    onDone()
  }
  return (
    <form onSubmit={(e) => void submit(e)} className={`${card} space-y-3`}>
      <p className="font-semibold">Request numbers for a home</p>
      <label className="block text-sm font-medium">
        Address
        <input className={field} value={r.address} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" />
      </label>
      <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
        <label className="block text-sm font-medium">
          City
          <input className={field} value={r.city} onChange={(e) => set('city', e.target.value)} autoComplete="address-level2" />
        </label>
        <label className="block text-sm font-medium">
          State
          <input className={field} value={r.state} maxLength={2} onChange={(e) => set('state', e.target.value.toUpperCase())} autoComplete="address-level1" />
        </label>
        <label className="block text-sm font-medium">
          ZIP
          <input className={field} value={r.zip} inputMode="numeric" maxLength={5} onChange={(e) => set('zip', e.target.value.replace(/\D/g, ''))} autoComplete="postal-code" />
        </label>
      </div>
      <label className="block text-sm font-medium">
        Price
        <input className={field} inputMode="decimal" placeholder="$" value={r.price == null ? '' : r.price.toLocaleString('en-US')} onChange={(e) => set('price', num(e.target.value))} />
      </label>
      <div>
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="mr-auto">Down payment you'd like</span>
          <div className="flex rounded-lg bg-muted p-0.5 text-xs">
            {(['percent', 'amount'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setR((x) => ({ ...x, downMode: m, down: null }))} className={`rounded-md px-2.5 py-1 ${r.downMode === m ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground'}`}>
                {m === 'percent' ? '%' : '$'}
              </button>
            ))}
          </div>
        </div>
        <input className={field} inputMode="decimal" aria-label={r.downMode === 'percent' ? 'Down payment percent' : 'Down payment dollars'} placeholder={r.downMode === 'percent' ? 'e.g. 5' : '$'} value={r.down == null ? '' : r.downMode === 'amount' ? r.down.toLocaleString('en-US') : String(r.down)} onChange={(e) => set('down', num(e.target.value))} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What would you like?</legend>
        {(
          [
            ['wantsLetter', 'Pre-approval letter'],
            ['wantsEstimate', 'Payment estimate'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex h-11 items-center gap-3 rounded-lg border px-3 text-sm">
            <input type="checkbox" className="size-5 accent-primary" checked={r[k]} onChange={(e) => set(k, e.target.checked)} />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="block text-sm font-medium">
        Notes (optional)
        <textarea className={`${field} h-auto min-h-20 py-2`} maxLength={1000} placeholder="e.g. Seller is offering $5,000 toward closing" value={r.notes} onChange={(e) => set('notes', e.target.value)} />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">Your loan officer prepares any letter or estimate. Requesting one doesn't change your approval.</p>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-12 flex-1 rounded-lg border text-base font-medium">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="h-12 flex-[2] rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </div>
    </form>
  )
}
