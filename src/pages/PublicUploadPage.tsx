// /u/{token}: a borrower's document upload page, no sign-in (UI pass Part 3).
// Loaded on its own (outside the app shell) so it stays light on a phone.
// The page opens once the typed email matches a borrower on the file (24
// hours on this device). It shows only the requested items with the loan
// officer's instructions; each takes PDFs or photos (several per item, the
// phone camera works) and shows Received or what needs attention.
// A portal link (the borrower portal) adds where the loan stands, a progress
// bar, published letters and estimates by home, and home requests
// (PublicPortal.tsx); its items are every request for that borrower.
import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { AlertCircleIcon, CameraIcon, ClipboardListIcon, CheckCircle2Icon, Loader2Icon, MailIcon, MessageSquareIcon } from 'lucide-react'
import logo from '@/assets/mps-logo.png'
import { callDocumentUpload, putSignedUpload, saveUploadSession, savedUploadSession } from '@/lib/api/documentUpload'
import { formatPhone } from '@/lib/pipeline/helpers'
import { isSupabaseConfigured } from '@/lib/supabase'
import { borrowerDocStatus, type PortalView } from '../../supabase/functions/document-upload/portal'
import { ALLOWED_TYPES, fileProblem, stillNeeded, type UploadItem, type UploadLo } from '../../supabase/functions/document-upload/rules'
import { ApplicationWizard } from './ApplicationWizard'
import { DocProgress, LettersAndHomes, PortalHeader } from './PublicPortal'

type Screen =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'expired'; lo: UploadLo | null; message: string }
  | { kind: 'ask_email'; lo: UploadLo | null; portal: boolean }
  | { kind: 'open'; lo: UploadLo | null; items: UploadItem[]; portal: PortalView | null }

const TOKEN = /^[0-9a-f]{64}$/i

export function PublicUploadPage() {
  const { token = '' } = useParams()
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' })
  const [session, setSession] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const applying = params.get('apply') === '1'
  const setApplying = (on: boolean) => {
    setParams(on ? { apply: '1' } : {}, { replace: true })
    window.scrollTo({ top: 0 })
  }

  const expired = (lo: UploadLo | null, message?: string) => setScreen({ kind: 'expired', lo, message: message ?? `This link has expired. Contact ${lo?.name ?? 'your loan officer'} for a new one.` })

  const view = async (s: string, lo: UploadLo | null, portal: boolean) => {
    const r = await callDocumentUpload({ action: 'view', token, session: s })
    if (r.status === 200 && r.body.items) return setScreen({ kind: 'open', lo: r.body.lo ?? lo, items: r.body.items, portal: r.body.portal ?? null })
    if (r.status === 410) return expired(lo)
    saveUploadSession(token, null)
    setSession(null)
    setScreen({ kind: 'ask_email', lo, portal })
  }

  useEffect(() => {
    document.title = 'Upload your documents · MPS Mortgage'
    if (!isSupabaseConfigured || !TOKEN.test(token)) return setScreen({ kind: 'missing' })
    let gone = false
    void callDocumentUpload({ action: 'open', token }).then(async (r) => {
      if (gone) return
      if (r.status !== 200) return setScreen({ kind: 'missing' })
      const lo = r.body.lo ?? null
      const portal = r.body.kind === 'portal'
      if (portal) document.title = 'Your loan · MPS Mortgage'
      if (r.body.state === 'expired') return expired(lo, r.body.message)
      const s = savedUploadSession(token)
      setSession(s)
      if (s) await view(s, lo, portal)
      else setScreen({ kind: 'ask_email', lo, portal })
    })
    return () => {
      gone = true
    }
    // Runs once per link.
  }, [token])

  const lo = screen.kind === 'loading' || screen.kind === 'missing' ? null : screen.lo
  const refresh = () => session && screen.kind === 'open' && void view(session, screen.lo, !!screen.portal)

  return (
    <div className="min-h-screen bg-[#F4F7FB] text-foreground">
      <header className="bg-navy px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-2.5">
          <img src={logo} alt="" className="size-8 rounded-md bg-white object-contain p-0.5" />
          <span className="text-[15px] font-bold text-white">MPS Mortgage</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        {screen.kind === 'loading' && (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Loading…
          </p>
        )}
        {screen.kind === 'missing' && <Notice title="This link is not available" text="Check the link you were sent, or contact your loan officer." />}
        {screen.kind === 'expired' && <Notice title="This link has expired" text={screen.message} />}
        {screen.kind === 'ask_email' && (
          <EmailBox
            token={token}
            portal={screen.portal}
            onOpen={(s) => {
              saveUploadSession(token, s)
              setSession(s)
              void view(s, screen.lo, screen.portal)
            }}
            onExpired={() => expired(screen.lo)}
          />
        )}
        {screen.kind === 'open' && session && screen.portal && applying && (
          <>
            <button type="button" onClick={() => setApplying(false)} className="text-sm font-medium text-primary">
              ← Back to your loan
            </button>
            <ApplicationWizard mode={{ kind: 'portal', token, session }} onExpired={() => void view(session, screen.lo, true)} />
          </>
        )}
        {screen.kind === 'open' && session && screen.portal && !applying && <PortalHeader view={screen.portal} />}
        {screen.kind === 'open' && session && screen.portal && !applying && <ApplicationEntry onOpen={() => setApplying(true)} />}
        {screen.kind === 'open' && session && !(screen.portal && applying) && <Items token={token} session={session} items={screen.items} portal={!!screen.portal} onChanged={refresh} onExpired={() => expired(screen.lo)} />}
        {screen.kind === 'open' && session && screen.portal && !applying && <LettersAndHomes view={screen.portal} token={token} session={session} onChanged={refresh} onExpired={() => expired(screen.lo)} />}
        {lo && <LoCard lo={lo} />}
      </main>
    </div>
  )
}

// The portal's way into the full application (Stage 5). The wizard itself says
// when it was already sent.
function ApplicationEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="flex items-center gap-3 rounded-xl border bg-white p-4 shadow-soft">
      <ClipboardListIcon className="size-6 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Your mortgage application</p>
        <p className="text-sm text-muted-foreground">About 10 minutes. It saves as you go.</p>
      </div>
      <button type="button" onClick={onOpen} className="h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-white">
        Open
      </button>
    </section>
  )
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border bg-white p-6 text-center shadow-soft">
      <h1 className="text-lg font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

function EmailBox({ token, portal, onOpen, onExpired }: { token: string; portal: boolean; onOpen: (session: string) => void; onExpired: () => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    setError(null)
    const r = await callDocumentUpload({ action: 'email', token, email: email.trim() })
    setBusy(false)
    if (r.status === 200 && r.body.session) return onOpen(r.body.session)
    if (r.status === 410) return onExpired()
    setError(r.body.error ?? "We couldn't verify that email.")
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="rounded-xl border bg-white p-6 shadow-soft">
      <h1 className="text-lg font-bold tracking-tight">{portal ? 'Your loan portal' : 'Upload your documents'}</h1>
      <p className="mt-1 text-sm text-muted-foreground">To keep your information private, type the email address your loan officer has for you.</p>
      <label className="mt-4 block text-sm font-medium" htmlFor="upload-email">
        Email
      </label>
      <input
        id="upload-email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={!!error}
        className="mt-1 h-12 w-full rounded-lg border border-input bg-white px-3.5 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 aria-invalid:border-destructive"
      />
      {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
      <button type="submit" disabled={busy || !email.trim()} className="mt-4 h-12 w-full rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
        {busy ? 'Checking…' : portal ? 'Open my portal' : 'Open my document list'}
      </button>
    </form>
  )
}

function Items({ token, session, items, portal, onChanged, onExpired }: { token: string; session: string; items: UploadItem[]; portal: boolean; onChanged: () => void; onExpired: () => void }) {
  const left = items.filter((i) => stillNeeded(i.status)).length
  const Title = portal ? 'h2' : 'h1'
  return (
    <section className="space-y-3">
      <div>
        <Title className={`${portal ? 'text-lg' : 'text-xl'} font-bold tracking-tight`}>{portal ? 'My documents' : 'Upload your documents'}</Title>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {portal && items.length === 0 ? 'Nothing is needed from you right now.' : left ? `${left} item${left === 1 ? '' : 's'} still needed.` : "That's everything for now. Thank you!"} {items.length > 0 && 'PDFs or photos, up to 10 MB each. You can add more than one file per item.'}
        </p>
      </div>
      {portal && <DocProgress items={items} />}
      {items.map((i) => (
        <ItemCard key={i.id} token={token} session={session} item={i} onChanged={onChanged} onExpired={onExpired} />
      ))}
    </section>
  )
}

function ItemCard({ token, session, item, onChanged, onExpired }: { token: string; session: string; item: UploadItem; onChanged: () => void; onExpired: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const done = item.status === 'reviewed'
  const received = item.status === 'received'
  const attention = item.status === 'rejected'

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setError(null)
    for (const file of Array.from(files)) {
      const problem = fileProblem({ size: file.size, type: file.type })
      if (problem) {
        setError(`${file.name}: ${problem}`)
        continue
      }
      setBusy(`Uploading ${file.name}…`)
      const meta = { token, session, itemId: item.id, fileName: file.name, size: file.size, type: file.type }
      const start = await callDocumentUpload({ action: 'upload_url', ...meta })
      if (start.status === 401 || start.status === 410) return onExpired()
      if (start.status !== 200 || !start.body.path || !start.body.token) {
        setError(start.body.error ?? 'The upload could not start. Try again.')
        continue
      }
      try {
        await putSignedUpload(start.body.path, start.body.token, file)
        const fin = await callDocumentUpload({ action: 'uploaded', ...meta, path: start.body.path })
        if (fin.status !== 200) setError(fin.body.error ?? 'The upload did not finish. Try again.')
      } catch (e) {
        setError((e as Error).message)
      }
    }
    setBusy(null)
    if (input.current) input.current.value = ''
    onChanged()
  }

  return (
    <article className={`rounded-xl border-2 bg-white p-4 shadow-soft ${attention ? 'border-red-300' : done || received ? 'border-emerald-200' : 'border-transparent ring-1 ring-border'}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{item.label}</h2>
          {item.instructions && <p className="mt-0.5 text-sm text-muted-foreground">{item.instructions}</p>}
          {item.dueOn && !done && !received && <p className="mt-0.5 text-xs text-muted-foreground">Needed by {new Date(`${item.dueOn}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>}
        </div>
        {(done || received) && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <CheckCircle2Icon className="size-3.5" />
            {borrowerDocStatus(item.status)}
          </span>
        )}
        {attention && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
            <AlertCircleIcon className="size-3.5" />
            {borrowerDocStatus(item.status)}
          </span>
        )}
        {item.status === 'requested' && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{borrowerDocStatus(item.status)}</span>}
      </div>
      {attention && item.rejectReason && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{item.rejectReason}</p>}
      {item.files.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {item.files.map((f, n) => (
            <li key={`${f.name}-${n}`}>✓ {f.name}</li>
          ))}
        </ul>
      )}
      {!done && (
        <>
          <input ref={input} type="file" multiple accept={[...ALLOWED_TYPES, 'image/*'].join(',')} className="hidden" onChange={(e) => void upload(e.target.files)} aria-label={`Files for ${item.label}`} />
          <button type="button" disabled={!!busy} onClick={() => input.current?.click()} className={`mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold disabled:opacity-60 ${received ? 'border bg-white' : 'bg-primary text-white'}`}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : <CameraIcon className="size-4" />}
            {busy ?? (received ? 'Add another file' : attention ? 'Upload again' : 'Take a photo or choose a file')}
          </button>
        </>
      )}
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </article>
  )
}

function LoCard({ lo }: { lo: UploadLo }) {
  const digits = lo.phone?.replace(/\D/g, '') ?? ''
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-white p-4 shadow-soft">
      {lo.photoUrl && <img src={lo.photoUrl} alt={lo.name} className="size-14 shrink-0 rounded-full object-cover" />}
      <div className="min-w-[12rem] flex-1">
        <p className="font-bold">{lo.name}</p>
        <p className="text-sm text-muted-foreground">
          MPS Mortgage{lo.nmls ? ` · NMLS #${lo.nmls}` : ''}
          {lo.phone ? ` · ${formatPhone(lo.phone)}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">MPS Mortgage LLC, NMLS #2501110. Equal Housing Opportunity.</p>
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
