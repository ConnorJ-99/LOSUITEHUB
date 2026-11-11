// /e/{token}: shared estimates for a borrower, no sign-in (build plan Phase 7).
// Loaded on its own (outside the app shell) so it stays light on a phone.
// The page opens once the typed email matches a borrower on the file; it
// stays open on this device for 24 hours. Options sit side by side on a
// computer and swipe on a phone. Everything shown is the frozen copy made
// when the link was sent.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { ChevronDownIcon, DownloadIcon, Loader2Icon, MailIcon, MessageSquareIcon } from 'lucide-react'
import logo from '@/assets/mps-logo.png'
import { callEstimateView, saveSession, savedSession } from '@/lib/api/estimateView'
import { formatCurrency, formatPercent } from '@/lib/format'
import { formatPhone } from '@/lib/pipeline/helpers'
import { isSupabaseConfigured } from '@/lib/supabase'
import { disclaimer, type ShareLo, type ShareOption, type ShareSnapshot } from '../../supabase/functions/estimate-view/rules'

type Screen =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'expired'; lo: ShareLo | null; message: string }
  | { kind: 'ask_email'; lo: ShareLo | null }
  | { kind: 'open'; lo: ShareLo | null; snapshot: ShareSnapshot; picked: string | null }

const TOKEN = /^[0-9a-f]{32,128}$/i

export function PublicEstimatePage() {
  const { token = '' } = useParams()
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' })
  const [session, setSession] = useState<string | null>(() => savedSession(token))

  const expired = (lo: ShareLo | null, message?: string) =>
    setScreen({ kind: 'expired', lo, message: message ?? `These rates have expired. Contact ${lo?.name ?? 'your loan officer'} for updated numbers.` })

  /** Opens the options with the session; back to the email box when it's gone. */
  const view = async (s: string, lo: ShareLo | null) => {
    const r = await callEstimateView({ action: 'view', token, session: s })
    if (r.status === 200 && r.body.snapshot) return setScreen({ kind: 'open', lo: r.body.lo ?? lo, snapshot: r.body.snapshot, picked: r.body.picked ?? null })
    if (r.status === 410) return expired(lo)
    saveSession(token, null)
    setSession(null)
    setScreen({ kind: 'ask_email', lo })
  }

  useEffect(() => {
    document.title = 'Your loan options · MPS Mortgage'
    if (!isSupabaseConfigured || !TOKEN.test(token)) return setScreen({ kind: 'missing' })
    let gone = false
    void callEstimateView({ action: 'open', token }).then(async (r) => {
      if (gone) return
      if (r.status !== 200) return setScreen({ kind: 'missing' })
      const lo = r.body.lo ?? null
      if (r.body.state === 'expired') return expired(lo, r.body.message)
      const s = savedSession(token)
      setSession(s)
      if (s) await view(s, lo)
      else setScreen({ kind: 'ask_email', lo })
    })
    return () => {
      gone = true
    }
    // Runs once per link.
  }, [token])

  const lo = screen.kind === 'loading' || screen.kind === 'missing' ? null : screen.lo

  return (
    <div className="min-h-screen bg-[#F4F7FB] text-foreground">
      <header className="bg-navy px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-2.5">
          <img src={logo} alt="" className="size-8 rounded-md bg-white object-contain p-0.5" />
          <span className="text-[15px] font-bold text-white">MPS Mortgage</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        {screen.kind === 'loading' && (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Loading…
          </p>
        )}
        {screen.kind === 'missing' && <Notice title="This link is not available" text="Check the link you were sent, or contact your loan officer." />}
        {screen.kind === 'expired' && <Notice title="These rates have expired" text={screen.message} />}
        {screen.kind === 'ask_email' && (
          <EmailBox
            token={token}
            onOpen={(s) => {
              saveSession(token, s)
              setSession(s)
              void view(s, screen.lo)
            }}
            onExpired={() => expired(screen.lo)}
          />
        )}
        {screen.kind === 'open' && session && <Options token={token} session={session} snapshot={screen.snapshot} picked={screen.picked} onPicked={(picked) => setScreen({ ...screen, picked })} onExpired={() => expired(screen.lo)} />}
        {lo && <LoCard lo={lo} />}
        {screen.kind === 'open' && <p className="text-xs leading-relaxed text-muted-foreground">{disclaimer(screen.snapshot.asOf)}</p>}
      </main>
    </div>
  )
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border bg-white p-6 text-center shadow-soft">
      <h1 className="text-lg font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

function EmailBox({ token, onOpen, onExpired }: { token: string; onOpen: (session: string) => void; onExpired: () => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    setError(null)
    const r = await callEstimateView({ action: 'email', token, email: email.trim() })
    setBusy(false)
    if (r.status === 200 && r.body.session) return onOpen(r.body.session)
    if (r.status === 410) return onExpired()
    setError(r.body.error ?? "We couldn't verify that email.")
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="mx-auto max-w-md rounded-xl border bg-white p-6 shadow-soft">
      <h1 className="text-lg font-bold tracking-tight">Your loan options</h1>
      <p className="mt-1 text-sm text-muted-foreground">To keep them private, type the email address your loan officer has for you.</p>
      <label className="mt-4 block text-sm font-medium" htmlFor="share-email">
        Email
      </label>
      <input
        id="share-email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={!!error}
        className="mt-1 h-12 w-full rounded-lg border border-input bg-white px-3.5 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 aria-invalid:border-destructive"
      />
      {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
      <button type="submit" disabled={busy || !email.trim()} className="mt-4 h-12 w-full rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
        {busy ? 'Checking…' : 'View my options'}
      </button>
    </form>
  )
}

function Options({ token, session, snapshot, picked, onPicked, onExpired }: { token: string; session: string; snapshot: ShareSnapshot; picked: string | null; onPicked: (id: string) => void; onExpired: () => void }) {
  const n = snapshot.options.length
  return (
    <section>
      <h1 className="text-xl font-bold tracking-tight">Your loan options</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {n === 1 ? 'The option' : `${n} options`} we went over. Estimates only; rates change daily.{n > 1 && <span className="md:hidden"> Swipe to see each one.</span>}
      </p>
      <div
        className="-mx-4 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:overflow-visible md:px-0"
        style={{ gridTemplateColumns: `repeat(${Math.min(n, 3)}, minmax(0, 1fr))` }}
      >
        {snapshot.options.map((o) => (
          <OptionCard key={o.estimateId} token={token} session={session} option={o} picked={picked === o.estimateId} anyPicked={!!picked} onPicked={onPicked} onExpired={onExpired} />
        ))}
      </div>
    </section>
  )
}

function OptionCard({ token, session, option: o, picked, anyPicked, onPicked, onExpired }: { token: string; session: string; option: ShareOption; picked: boolean; anyPicked: boolean; onPicked: (id: string) => void; onExpired: () => void }) {
  const [busy, setBusy] = useState<'pdf' | 'pick' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const call = async (action: 'pdf' | 'pick') => {
    setBusy(action)
    setError(null)
    const r = await callEstimateView({ action, token, session, estimateId: o.estimateId })
    setBusy(null)
    if (r.status === 410 || r.status === 401) return onExpired()
    if (r.status !== 200) return setError(r.body.error ?? 'Something went wrong. Try again.')
    if (action === 'pdf' && r.body.url) window.location.assign(r.body.url)
    if (action === 'pick') onPicked(o.estimateId)
  }
  const costs = o.pointsPct > 0 ? `${formatPercent(o.pointsPct)} points` : o.lenderCredit > 0 ? `${formatCurrency(o.lenderCredit)} lender credit` : 'No points'
  return (
    <article className={`flex w-[85%] shrink-0 snap-center flex-col rounded-xl border-2 bg-white p-4 shadow-soft md:w-auto ${picked ? 'border-nurture' : 'border-transparent ring-1 ring-border'}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">{o.name}</p>
      <h2 className="text-base font-bold">{o.program}</h2>
      <p className="mt-2 text-3xl font-bold tabular-nums">{o.ratePct == null ? '—' : formatPercent(o.ratePct)}</p>
      <p className="text-xs text-muted-foreground">
        rate{o.aprPct != null ? ` · ${formatPercent(o.aprPct)} APR` : ''} · {costs}
      </p>
      <dl className="mt-3 space-y-1 text-sm tabular-nums">
        <Row label="Loan amount" value={formatCurrency(o.loanAmount)} />
        {o.downPayment > 0 && <Row label="Down payment" value={formatCurrency(o.downPayment)} />}
      </dl>
      <Expand title="Monthly payment" total={formatCurrency(o.payment.total)}>
        {o.payment.lines.map((l) => (
          <Row key={l.label} label={l.label} value={formatCurrency(l.amount)} />
        ))}
      </Expand>
      <Expand title={o.cash.title.replace(/^Estimated /, '').replace(/^./, (c) => c.toUpperCase())} total={formatCurrency(o.cash.total)}>
        {o.cash.lines.map((l) => (
          <Row key={l.label} label={l.label} value={`${l.minus ? '−' : ''}${formatCurrency(l.amount)}`} />
        ))}
      </Expand>
      <Expand title="Fee breakdown" total={null}>
        {o.sections.map((s) => (
          <div key={s.letter} className="pt-1">
            <Row label={`${s.letter}. ${s.title}`} value={formatCurrency(s.total)} strong />
            {s.rows.map((r) => (
              <Row key={r.label} label={r.label} value={formatCurrency(r.amount)} indent />
            ))}
          </div>
        ))}
      </Expand>
      <div className="mt-auto space-y-2 pt-4">
        {picked ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-center text-sm font-medium text-emerald-700">You're interested in this one. Your loan officer will be in touch.</p>
        ) : (
          <button type="button" onClick={() => void call('pick')} disabled={!!busy} className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-60">
            {busy === 'pick' ? 'Saving…' : anyPicked ? 'I prefer this one' : "I'm interested in this one"}
          </button>
        )}
        {o.pdfDocumentId && (
          <button type="button" onClick={() => void call('pdf')} disabled={!!busy} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border text-sm font-medium disabled:opacity-60">
            <DownloadIcon className="size-4" />
            {busy === 'pdf' ? 'Opening…' : 'Download PDF'}
          </button>
        )}
        {error && <p className="text-center text-xs text-destructive">{error}</p>}
      </div>
    </article>
  )
}

function Row({ label, value, strong, indent }: { label: string; value: string; strong?: boolean; indent?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 text-sm tabular-nums ${strong ? 'font-medium' : ''} ${indent ? 'pl-3 text-muted-foreground' : ''}`}>
      <dt>{label}</dt>
      <dd className="shrink-0">{value}</dd>
    </div>
  )
}

function Expand({ title, total, children }: { title: string; total: string | null; children: React.ReactNode }) {
  return (
    <details className="group mt-3 border-t pt-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold">
        <span className="flex items-center gap-1">
          <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
          {title}
        </span>
        {total && <span className="tabular-nums">{total}</span>}
      </summary>
      <dl className="mt-1.5 space-y-0.5">{children}</dl>
    </details>
  )
}

function LoCard({ lo }: { lo: ShareLo }) {
  const digits = lo.phone?.replace(/\D/g, '') ?? ''
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-white p-4 shadow-soft">
      {lo.photoUrl && <img src={lo.photoUrl} alt={lo.name} className="size-16 shrink-0 rounded-full object-cover" />}
      <div className="min-w-[12rem] flex-1">
        <p className="font-bold">{lo.name}</p>
        <p className="text-sm text-muted-foreground">
          MPS Mortgage{lo.nmls ? ` · NMLS #${lo.nmls}` : ''}
          {lo.phone ? ` · ${formatPhone(lo.phone)}` : ''}
        </p>
      </div>
      <div className="flex gap-2">
        {digits && (
          <a href={`sms:${digits}`} className="flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium">
            <MessageSquareIcon className="size-4" />
            Text me
          </a>
        )}
        {lo.email && (
          <a href={`mailto:${lo.email}`} className="flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium">
            <MailIcon className="size-4" />
            Email me
          </a>
        )}
      </div>
    </div>
  )
}
