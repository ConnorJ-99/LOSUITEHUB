// /myhome: MyHome with MPS, the borrower's lifelong account (Stage 1,
// docs/plans/myhome.md). Loaded by PublicApp, so a borrower's phone never
// loads the staff app. No password: the borrower signs in with their email and
// permanent 6-digit MyHome code, or opens their personal link (?invite=…, never
// expires) and types their email; both reach them only in Connor's GHL email.
// It runs on MyHome's own Supabase client and stays signed in on this device.
// Signed in, it shows every file the person is on as chips (open, getting
// ready, closed) with their loan officer. Each file's own view comes later.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { HomeIcon, Loader2Icon, LockIcon, LogOutIcon } from 'lucide-react'
import { fetchMe, hasSession, signIn, signOut } from '@/lib/myhome/api'
import { isSupabaseConfigured } from '@/lib/supabase'
import { CODE_LENGTH, INVITE_TOKEN, cleanCode, emailLooksValid, type MyHomeMe } from '../../supabase/functions/myhome/rules'
import { LoCard } from './PublicUploadPage'

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
    if (!invite && !c) return setError(`Type the ${CODE_LENGTH}-digit MyHome code from your email.`)
    setBusy(true)
    setError(null)
    const problem = await signIn(invite ? { email: email.trim(), invite } : { email: email.trim(), code: c! })
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
              {invite ? 'No password. Type your email to finish.' : `No password. Use your email and the ${CODE_LENGTH}-digit MyHome code MPS Mortgage emailed you.`}
            </p>
          </div>
          {note && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}
          <div>
            <label className="block text-sm font-semibold" htmlFor="myhome-email">
              Email
            </label>
            <input id="myhome-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} className={field} />
          </div>
          {!invite && (
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
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={busy || !email.trim() || (!invite && !code.trim())} className={primaryButton}>
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
// Signed in
// ---------------------------------------------------------------------------

const HEADLINE = { active: "Here's where your loan stands.", nurture: "You're getting ready.", closed: 'Welcome home.' } as const

function Home({ me, onSignOut }: { me: MyHomeMe; onSignOut: () => void }) {
  const [picked, setPicked] = useState(me.files[0]?.loanId ?? null)
  const file = me.files.find((f) => f.loanId === picked) ?? me.files[0] ?? null
  const initials = me.firstName.slice(0, 1).toUpperCase() || 'M'
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
          <p className="mt-6 text-white/75">{me.firstName ? `Hi ${me.firstName},` : 'Hi,'}</p>
          <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-white">{file ? HEADLINE[file.view] : 'Welcome to MyHome.'}</h1>
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
        <section className="rounded-xl border bg-white p-5 shadow-soft">
          {file ? (
            <>
              <h2 className="text-lg font-bold tracking-tight">{file.label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {file.view === 'active'
                  ? 'Your loan status, documents, and letters and estimates will show here. Until then, use the portal link your loan officer sent you.'
                  : file.view === 'nurture'
                    ? 'Your numbers and your readiness plan will show here.'
                    : "Your home's estimated value and equity will show here."}
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold tracking-tight">No loans to show yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">When your loan officer has a loan for you, it shows here.</p>
            </>
          )}
        </section>
        {me.lo && <LoCard lo={me.lo} />}
      </main>
      <Footer />
    </div>
  )
}
