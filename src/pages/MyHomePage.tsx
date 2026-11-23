// /myhome: MyHome with MPS, the borrower's lifelong account (Stage 1,
// docs/plans/myhome.md). Loaded by PublicApp, so a borrower's phone never
// loads the staff app. No password: the borrower signs in with their email and
// permanent 6-digit MyHome code; their personal link (?invite=…, never expires)
// opens "Create your account" and still asks for both (Connor, 2026-11-20).
// The code and link reach them only in Connor's GHL email.
// It runs on MyHome's own Supabase client and stays signed in on this device.
// Signed in, it shows every file the person is on as chips (open, getting
// ready, closed) with their loan officer. An open file (Stage 2) shows what
// the borrower portal shows: where the loan stands, their documents with
// uploads, published letters and estimates, and Request numbers. A closed file
// (closed view Step A) shows the home and loan: Connor's value or a way to ask
// for one, Zillow and the county appraisal district, payment and key dates, and
// the documents he published. The getting-ready view comes later.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CheckIcon, ExternalLinkIcon, FileTextIcon, HomeIcon, Loader2Icon, LockIcon, LogOutIcon } from 'lucide-react'
import { mortgageToday } from '@/lib/calc/amortization'
import { homeValue } from '@/lib/calc/homeValue'
import { todayIso } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { askLo, closedDocumentUrl, fetchClosed, fetchFile, fetchMe, fileCall, hasSession, putMyHomeUpload, signIn, signOut, type MyHomeFileView } from '@/lib/myhome/api'
import { isSupabaseConfigured } from '@/lib/supabase'
import { CODE_LENGTH, INVITE_TOKEN, cleanCode, emailLooksValid, type MyHomeClosed, type MyHomeMe } from '../../supabase/functions/myhome/rules'
import { Items, LoCard } from './PublicUploadPage'
import { LettersAndHomes, PortalHeader } from './PublicPortal'

type Screen = { kind: 'loading' } | { kind: 'signed_out'; note?: string } | { kind: 'off'; message: string } | { kind: 'home'; me: MyHomeMe }

const field =
  'mt-1 h-12 w-full rounded-lg border border-input bg-white px-3.5 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 aria-invalid:border-destructive'
const primaryButton = 'h-12 w-full rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60'

export function MyHomePage() {
  const [screen, setScreen] = useState<Screen>(isSupabaseConfigured ? { kind: 'loading' } : { kind: 'signed_out', note: 'MyHome is not set up yet.' })

  const load = async (fresh: boolean) => {
    const r = await fetchMe(fresh)
    if (r.status === 200 && r.body.files) return setScreen({ kind: 'home', me: { firstName: r.body.firstName ?? '', files: r.body.files, lo: r.body.lo ?? null } })
    if (r.status === 403) {
      await signOut()
      return setScreen({ kind: 'off', message: r.body.error ?? 'This account is turned off.' })
    }
    if (r.status === 401) await signOut()
    setScreen({ kind: 'signed_out', note: r.status === 401 ? undefined : r.body.error })
  }

  useEffect(() => {
    document.title = 'MyHome · MPS Mortgage'
    if (!isSupabaseConfigured) return
    void hasSession().then((yes) => {
      if (!yes) return setScreen({ kind: 'signed_out' })
      // Already signed in on this phone: the link's token isn't needed in the address bar.
      if (window.location.search.includes('invite=')) window.history.replaceState(null, '', '/myhome')
      void load(false)
    })
    // Runs once.
  }, [])

  if (screen.kind === 'loading')
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-[#F4F7FB] text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" /> Loading…
      </div>
    )
  if (screen.kind === 'home')
    return (
      <Home
        me={screen.me}
        onSignOut={() => {
          void signOut().then(() => setScreen({ kind: 'signed_out' }))
        }}
        onReload={() => void load(false)}
      />
    )
  return <SignIn note={screen.kind === 'off' ? screen.message : screen.note} onSignedIn={() => void load(true)} />
}

function Brand({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`flex shrink-0 items-center justify-center rounded-xl bg-primary text-white ${small ? 'size-9' : 'size-12'}`}>
        <HomeIcon className={small ? 'size-5' : 'size-6'} />
      </span>
      <div className="leading-tight">
        <p className={`font-bold text-white ${small ? 'text-lg' : 'text-2xl'}`}>MyHome</p>
        {!small && <p className="text-sm text-white/70">with MPS Mortgage</p>}
      </div>
    </div>
  )
}

const Footer = () => <p className="px-4 py-6 text-center text-xs text-muted-foreground">MPS Mortgage LLC · NMLS #2501110 · Equal Housing Opportunity</p>

// ---------------------------------------------------------------------------
// Sign in: email + MyHome code, or the personal link + email
// ---------------------------------------------------------------------------

function SignIn({ note, onSignedIn }: { note?: string; onSignedIn: () => void }) {
  const [params, setParams] = useSearchParams()
  const typed = (params.get('invite') ?? '').toLowerCase()
  const invite = INVITE_TOKEN.test(typed) ? typed : null
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!emailLooksValid(email)) return setError('Type your email address.')
    const c = cleanCode(code)
    if (!c) return setError(`Type the ${CODE_LENGTH}-digit MyHome code from your email.`)
    setBusy(true)
    setError(null)
    const problem = await signIn(invite ? { email: email.trim(), code: c, invite } : { email: email.trim(), code: c })
    setBusy(false)
    if (problem) return setError(problem)
    // The link's token leaves the address bar once it has done its job.
    if (invite) setParams({}, { replace: true })
    onSignedIn()
  }

  return (
    <div className="min-h-screen bg-[#F4F7FB] text-foreground">
      <header className="bg-navy px-6 pt-10 pb-16">
        <div className="mx-auto max-w-md">
          <Brand />
          <h1 className="mt-8 text-4xl leading-tight font-extrabold tracking-tight text-white">Your home loan, in one place. For good.</h1>
          <p className="mt-3 text-base text-white/75">Track your loan, send documents, and after closing keep an eye on your home's value and equity.</p>
        </div>
      </header>
      <main className="mx-auto -mt-8 max-w-md rounded-t-3xl bg-[#F4F7FB] px-4 pt-6 sm:px-6">
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{invite ? 'Create your account' : 'Sign in to MyHome'}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {invite ? `No password. Type your email and the ${CODE_LENGTH}-digit MyHome code from the same email.` : `No password. Use your email and the ${CODE_LENGTH}-digit MyHome code MPS Mortgage emailed you.`}
            </p>
          </div>
          {note && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}
          <div>
            <label className="block text-sm font-semibold" htmlFor="myhome-email">
              Email
            </label>
            <input id="myhome-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} className={field} />
          </div>
          <div>
            <label className="block text-sm font-semibold" htmlFor="myhome-code">
              MyHome code
            </label>
            <input
              id="myhome-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH + 2}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={!!error}
              className={`${field} font-mono text-xl tracking-[0.4em]`}
            />
            <p className="mt-1.5 text-sm text-muted-foreground">Can't find it? Ask your loan officer to send it again.</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={busy || !email.trim() || !code.trim()} className={primaryButton}>
            {busy ? 'One moment…' : invite ? 'Create my MyHome account' : 'Sign in'}
          </button>
          <div className="flex gap-3 rounded-xl border bg-white p-4 text-sm text-muted-foreground">
            <LockIcon className="mt-0.5 size-5 shrink-0 text-primary" />
            <p>One account for every loan you have with us: this one, and any refi or next home later. You'll stay signed in on this phone.</p>
          </div>
        </form>
      </main>
      <Footer />
    </div>
  )
}

// ---------------------------------------------------------------------------
// An open file (Stage 2): the borrower portal's sections
// ---------------------------------------------------------------------------

type FileScreen = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'open'; view: MyHomeFileView }

/**
 * Where the loan stands, their documents (uploads go straight to the file),
 * published letters and estimates, Request numbers, and this loan's officer.
 * A file that is no longer open, or no longer theirs, sends them back to their
 * list of loans; a lost session signs them out.
 */
function OpenFile({ loanId, onGone, onSignedOut }: { loanId: string; onGone: () => void; onSignedOut: () => void }) {
  const [screen, setScreen] = useState<FileScreen>({ kind: 'loading' })
  const call = fileCall(loanId)

  const load = async (opened: boolean) => {
    const r = await fetchFile(loanId, opened)
    if (r.status === 200 && r.body.items && r.body.portal && r.body.lo) return setScreen({ kind: 'open', view: { items: r.body.items, portal: r.body.portal, lo: r.body.lo } })
    if (r.status === 401) return onSignedOut()
    if (r.status === 403 || r.status === 404 || r.status === 409) return onGone()
    setScreen({ kind: 'error', message: r.body.error ?? 'Your loan could not load. Try again.' })
  }

  useEffect(() => {
    void load(true)
    // Once per loan (the parent remounts this for another loan).
  }, [])

  const gone = () => {
    // Signed out → sign in again; anything else (the loan closed or moved) → reload the list.
    void fetchFile(loanId, false).then((r) => (r.status === 401 ? onSignedOut() : onGone()))
  }

  if (screen.kind === 'loading')
    return (
      <p className="flex items-center justify-center gap-2 rounded-xl border bg-white py-12 text-sm text-muted-foreground shadow-soft">
        <Loader2Icon className="size-4 animate-spin" /> Loading your loan…
      </p>
    )
  if (screen.kind === 'error')
    return (
      <section className="rounded-xl border bg-white p-5 text-center shadow-soft">
        <p className="text-sm text-muted-foreground">{screen.message}</p>
        <button type="button" onClick={() => void load(false)} className="mt-3 h-10 rounded-lg border px-4 text-sm font-medium">
          Try again
        </button>
      </section>
    )
  const { view } = screen
  return (
    <>
      <PortalHeader view={view.portal} />
      <Items call={call} put={putMyHomeUpload} items={view.items} portal onChanged={() => void load(false)} onExpired={gone} />
      <LettersAndHomes view={view.portal} call={call} onChanged={() => void load(false)} onExpired={gone} />
      <LoCard lo={view.lo} />
    </>
  )
}

// ---------------------------------------------------------------------------
// A closed file (closed view, Step A)
// ---------------------------------------------------------------------------

type ClosedScreen = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'open'; view: MyHomeClosed }

const card = 'rounded-xl border bg-white p-5 shadow-soft'
const shortDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const monthDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/**
 * Their home and loan after closing: the value Connor has on file (or a way to
 * ask for one), Zillow and the county appraisal district, the loan's payment
 * and key dates, the documents he published, and that loan's officer. The
 * automatic index estimate (Step B) and the equity card (Step C) come next.
 */
function ClosedFile({ loanId, onGone, onSignedOut }: { loanId: string; onGone: () => void; onSignedOut: () => void }) {
  const [screen, setScreen] = useState<ClosedScreen>({ kind: 'loading' })

  const load = async (opened: boolean) => {
    const r = await fetchClosed(loanId, opened)
    if (r.status === 200 && r.body.lo && r.body.links) return setScreen({ kind: 'open', view: r.body as MyHomeClosed })
    if (r.status === 401) return onSignedOut()
    if (r.status === 403 || r.status === 404 || r.status === 409) return onGone()
    setScreen({ kind: 'error', message: r.body.error ?? 'Your home could not load. Try again.' })
  }

  useEffect(() => {
    void load(true)
    // Once per loan (the parent remounts this for another loan).
  }, [])

  if (screen.kind === 'loading')
    return (
      <p className="flex items-center justify-center gap-2 rounded-xl border bg-white py-12 text-sm text-muted-foreground shadow-soft">
        <Loader2Icon className="size-4 animate-spin" /> Loading your home…
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
  const v = screen.view
  const loFirst = v.lo.name.split(/\s+/)[0] || 'your loan officer'
  return (
    <>
      <HomeValue loanId={loanId} view={v} loFirst={loFirst} onAsked={(at) => setScreen({ kind: 'open', view: { ...v, asked: { ...v.asked, value_check: at } } })} onGone={onGone} />
      <MyLoan loanId={loanId} view={v} onGone={onGone} />
      <LoCard lo={v.lo} />
    </>
  )
}

function HomeValue({ loanId, view, loFirst, onAsked, onGone }: { loanId: string; view: MyHomeClosed; loFirst: string; onAsked: (at: string) => void; onGone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const asked = view.asked.value_check ?? null
  const askNow = async () => {
    setBusy(true)
    setError(null)
    const r = await askLo(loanId, 'value_check')
    setBusy(false)
    if (r.status === 200 && r.body.askedAt) return onAsked(r.body.askedAt)
    if (r.status === 401 || r.status === 404 || r.status === 409) return onGone()
    setError(r.body.error ?? 'That did not go through. Try again.')
  }
  // The value: Connor's figure when it's as new as the index, else the FHFA estimate (src/lib/calc/homeValue.ts).
  const ix = view.index
  const value = homeValue(view.value, ix ? { base: ix.base, baseIndex: ix.baseIndex, latestIndex: ix.latestIndex, loadedOn: ix.loadedOn } : null)
  // The estimated balance today from the loan's own terms, and the equity (src/lib/calc/amortization.ts).
  const today = view.balance ? mortgageToday(view.balance, todayIso(), value?.amount ?? null) : null
  const balance = today?.balance ?? null
  const equity = today?.equity ?? null
  const since = ix?.baseKind === 'appraised' ? 'since your appraisal' : 'since you bought'
  return (
    <section className={card} aria-labelledby="myhome-value">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="myhome-value" className="text-lg font-bold tracking-tight">
          My home's value
        </h2>
        {value?.by === 'index' && <span className="text-sm text-muted-foreground">Updated {ix!.latestQuarter}</span>}
      </div>
      {value ? (
        <>
          <p className="mt-2 text-4xl font-extrabold tracking-tight">{formatCurrency(value.amount)}</p>
          {value.by === 'index' ? (
            <p className={`mt-1 text-sm font-semibold ${value.gain > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>
              Estimated{value.gain !== 0 ? ` · ${value.gain > 0 ? '+' : '−'}${formatCurrency(Math.abs(value.gain))} ${since}` : ''}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {loFirst}'s estimate{value.on ? ` · ${monthYear(value.on)}` : ''}
            </p>
          )}
          {balance != null && equity != null && (
            <div className="mt-4">
              <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Loan balance about ${formatCurrency(balance)}, equity about ${formatCurrency(equity)}`}>
                <div className="bg-slate-400" style={{ width: `${Math.min(100, Math.max(0, (balance / value.amount) * 100))}%` }} />
                <div className="flex-1 bg-emerald-600" />
              </div>
              <div className="mt-1.5 flex justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  Loan balance ≈ <strong className="text-foreground">{formatCurrency(Math.round(balance / 100) * 100)}</strong>
                </span>
                <span className="text-muted-foreground">
                  Equity ≈ <strong className={equity > 0 ? 'text-emerald-700' : 'text-foreground'}>{formatCurrency(Math.round(equity / 100) * 100)}</strong>
                </span>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Want to know what your home is worth today? {loFirst} can take a look for you.</p>
      )}
      {view.links.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {view.links.map((l) => (
            <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center gap-1 rounded-lg border px-3 text-sm font-semibold text-primary">
              {l.label}
              <ExternalLinkIcon className="size-3.5" />
            </a>
          ))}
        </div>
      )}
      {asked ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <CheckIcon className="size-4 shrink-0" />
          Asked {shortDate(asked)}. {loFirst} will get back to you.
        </p>
      ) : (
        <button type="button" onClick={() => void askNow()} disabled={busy} className="mt-4 h-12 w-full rounded-lg border-2 border-primary text-base font-semibold text-primary disabled:opacity-60">
          {busy ? 'Sending…' : `Ask ${loFirst} to check my value`}
        </button>
      )}
      {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
      <p className="mt-3 text-xs text-muted-foreground">
        {value?.by === 'index'
          ? `Estimate from the FHFA ${ix!.area} home price index${ix!.nearest ? ' (the nearest area index for your county)' : ''}, updated quarterly. The loan balance assumes on-time payments. Not an appraisal.`
          : 'Estimates only. Not an appraisal.'}
      </p>
    </section>
  )
}

function MyLoan({ loanId, view, onGone }: { loanId: string; view: MyHomeClosed; onGone: () => void }) {
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const open = async (id: string) => {
    setOpening(id)
    setError(null)
    // Open the tab first (phones block pop-ups that open after a wait), then point it at the file.
    const tab = window.open('', '_blank')
    const r = await closedDocumentUrl(loanId, id)
    setOpening(null)
    if (r.status !== 200 || !r.body.url) {
      tab?.close()
      if (r.status === 401 || r.status === 409) return onGone()
      return setError(r.body.error ?? 'The document could not open. Try again.')
    }
    if (tab) tab.location.href = r.body.url
    else window.location.href = r.body.url
  }
  const facts: [string, string][] = [
    ['Monthly payment', view.monthlyPayment != null ? formatCurrency(view.monthlyPayment) : '—'],
    ['Insurance renews', view.insuranceRenewsOn ? shortDate(view.insuranceRenewsOn) : '—'],
    ['Homestead filed', view.homesteadFiled == null ? '—' : view.homesteadFiled ? 'Yes' : 'Not yet'],
    ['Home anniversary', view.closedOn ? monthDay(view.closedOn) : '—'],
  ]
  return (
    <section className={card} aria-labelledby="myhome-loan">
      <h2 id="myhome-loan" className="text-lg font-bold tracking-tight">
        My loan
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className={`text-lg font-bold ${value === 'Yes' ? 'text-emerald-700' : ''}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {view.documents.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <h3 className="text-sm font-semibold">My closing documents</h3>
          <ul className="mt-1 divide-y">
            {view.documents.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => void open(d.id)} disabled={opening != null} className="flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-60">
                  {opening === d.id ? <Loader2Icon className="size-5 shrink-0 animate-spin text-primary" /> : <FileTextIcon className="size-5 shrink-0 text-primary" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{d.name}</span>
                    <span className="block text-xs text-muted-foreground">Shared {shortDate(d.publishedAt)}</span>
                  </span>
                  <span className="text-sm font-medium text-primary">Open</span>
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Signed in
// ---------------------------------------------------------------------------

const HEADLINE = { active: "Here's where your loan stands.", nurture: "You're getting ready.", closed: 'Welcome home.' } as const

/** "connor" → "Connor" (names are sometimes typed in lower case). */
const firstNameOf = (name: string) => (name ? name.charAt(0).toUpperCase() + name.slice(1) : '')

/** "March 2021" from "2021-03-19". */
const monthYear = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null)

function Home({ me, onSignOut, onReload }: { me: MyHomeMe; onSignOut: () => void; onReload: () => void }) {
  const [picked, setPicked] = useState(me.files[0]?.loanId ?? null)
  const file = me.files.find((f) => f.loanId === picked) ?? me.files[0] ?? null
  const first = firstNameOf(me.firstName)
  const initials = first.slice(0, 1) || 'M'
  // A closed home: "Welcome home, Jordan" over its address and "Closed March 2021 · Conventional 30-year".
  const closedHome = file?.view === 'closed' && file.address ? [file.address, file.city].filter(Boolean).join(', ') : null
  const closedLine = file?.view === 'closed' ? [monthYear(file.closingDate) && `Closed ${monthYear(file.closingDate)}`, file.loanLine].filter(Boolean).join(' · ') : ''
  return (
    <div className="min-h-screen bg-[#F4F7FB] text-foreground">
      <header className="bg-navy px-4 pt-5 pb-14">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between">
            <Brand small />
            <button type="button" onClick={onSignOut} className="flex h-9 items-center gap-1.5 rounded-full border border-white/25 px-3 text-sm font-medium text-white" title="Sign out on this device">
              <span className="flex size-6 items-center justify-center rounded-full bg-white/15 text-xs font-bold">{initials}</span>
              <LogOutIcon className="size-4" />
              <span className="sr-only">Sign out</span>
            </button>
          </div>
          {closedHome ? (
            <>
              <p className="mt-6 text-white/75">{first ? `Welcome home, ${first}` : 'Welcome home'}</p>
              <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-white">{closedHome}</h1>
              {closedLine && <p className="mt-1 text-white/75">{closedLine}</p>}
            </>
          ) : (
            <>
              <p className="mt-6 text-white/75">{first ? `Hi ${first},` : 'Hi,'}</p>
              <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-white">{file ? HEADLINE[file.view] : 'Welcome to MyHome.'}</h1>
              {file?.view === 'closed' && closedLine && <p className="mt-1 text-white/75">{closedLine}</p>}
            </>
          )}
          {me.files.length > 1 && (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Your loans">
              {me.files.map((f) => (
                <button
                  key={f.loanId}
                  type="button"
                  role="tab"
                  aria-selected={f.loanId === file?.loanId}
                  onClick={() => setPicked(f.loanId)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap ${f.loanId === file?.loanId ? 'bg-white text-navy' : 'border border-white/30 text-white'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto -mt-8 max-w-2xl space-y-4 px-4">
        {file?.view === 'active' ? (
          // key: picking another loan starts its view fresh.
          <OpenFile key={file.loanId} loanId={file.loanId} onGone={onReload} onSignedOut={onSignOut} />
        ) : file?.view === 'closed' ? (
          <ClosedFile key={file.loanId} loanId={file.loanId} onGone={onReload} onSignedOut={onSignOut} />
        ) : (
          <>
            <section className="rounded-xl border bg-white p-5 shadow-soft">
              {file ? (
                <>
                  <h2 className="text-lg font-bold tracking-tight">{file.label}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Your numbers and your readiness plan will show here.</p>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-bold tracking-tight">No loans to show yet</h2>
                  <p className="mt-1 text-sm text-muted-foreground">When your loan officer has a loan for you, it shows here.</p>
                </>
              )}
            </section>
            {me.lo && <LoCard lo={me.lo} />}
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
