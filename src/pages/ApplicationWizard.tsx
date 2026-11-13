// The borrower application (Stage 5): phone-first, one short step at a time,
// saved as they go. Used at /apply (standalone: progress kept on this device
// with a resume code; submitting makes or matches the lead) and inside the
// borrower portal (their file; any device after the email check). All checks
// come from supabase/functions/apply/form.ts, the same ones the server runs.
// No Social Security number is ever asked for; date of birth is.
import { useEffect, useState } from 'react'
import { CheckCircle2Icon, ChevronLeftIcon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { db } from '@/lib/api/client'
import {
  CREDIT_AUTH_TEXT,
  DECLARATIONS,
  blankJob,
  blankOwnedHome,
  historyNote,
  jobMonthlyTotal,
  normalizeAnswers,
  normalizeJob,
  stepProblems,
  stepsFor,
  withHistorySlot,
  type Address,
  type ApplicationAnswers,
  type Asset,
  type Debt,
  type HomeMoney,
  type Job,
  type JobKind,
  type OtherIncome,
  type OwnedHome,
  type Person,
  type StepId,
} from '../../supabase/functions/apply/form'

export type WizardMode = { kind: 'standalone'; lo: string | null } | { kind: 'portal'; token: string; session: string }

const RESUME_KEY = 'mps-application-resume'
const card = 'rounded-xl border bg-white p-4 shadow-soft'
const field = 'mt-1 h-11 w-full rounded-lg border border-input bg-white px-3 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20'
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())

interface ApplyReply {
  resume?: string
  answers?: ApplicationAnswers
  step?: StepId
  status?: 'in_progress' | 'submitted'
  error?: string
  problems?: string[]
  state?: string
}

async function callApply(body: Record<string, unknown>): Promise<{ status: number; body: ApplyReply }> {
  const { data, error } = await db().functions.invoke('apply', { body })
  if (!error) return { status: 200, body: (data ?? {}) as ApplyReply }
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') return { status: ctx.status, body: ((await ctx.json().catch(() => null)) ?? {}) as ApplyReply }
  return { status: 0, body: { error: 'Could not connect. Check your connection and try again.' } }
}

const readResume = () => {
  try {
    return localStorage.getItem(RESUME_KEY)
  } catch {
    return null
  }
}
const writeResume = (v: string | null) => {
  try {
    if (v) localStorage.setItem(RESUME_KEY, v)
    else localStorage.removeItem(RESUME_KEY)
  } catch {
    // Private window: they can still finish now, just not resume later.
  }
}

export function ApplicationWizard({ mode, onExpired }: { mode: WizardMode; onExpired?: () => void }) {
  const [answers, setAnswers] = useState<ApplicationAnswers | null>(null)
  const [step, setStep] = useState<StepId>('you')
  const [status, setStatus] = useState<'loading' | 'intro' | 'in_progress' | 'submitted' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [resume, setResume] = useState<string | null>(mode.kind === 'standalone' ? readResume() : null)

  const who = (): Record<string, unknown> => (mode.kind === 'portal' ? { portalToken: mode.token, session: mode.session } : { resume })

  useEffect(() => {
    let gone = false
    void (async () => {
      if (mode.kind === 'standalone' && !resume) return setStatus('intro')
      const r = await callApply(mode.kind === 'portal' ? { action: 'start', portalToken: mode.token, session: mode.session } : { action: 'load', resume })
      if (gone) return
      if (r.status === 401 || r.status === 410) return onExpired?.()
      if (r.status !== 200 || !r.body.answers) {
        if (mode.kind === 'standalone') {
          writeResume(null)
          setResume(null)
          return setStatus('intro')
        }
        setMessage(r.body.error ?? 'The application could not open.')
        return setStatus('error')
      }
      setAnswers(normalizeAnswers(r.body.answers))
      setStep(r.body.step ?? 'you')
      setStatus(r.body.status === 'submitted' ? 'submitted' : 'in_progress')
    })()
    return () => {
      gone = true
    }
    // Opens once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const begin = async () => {
    setBusy(true)
    const r = await callApply({ action: 'start', lo: mode.kind === 'standalone' ? mode.lo : null })
    setBusy(false)
    if (r.status !== 200 || !r.body.answers || !r.body.resume) return setMessage(r.body.error ?? 'The application could not start. Try again.')
    writeResume(r.body.resume)
    setResume(r.body.resume)
    setAnswers(normalizeAnswers(r.body.answers))
    setStep('you')
    setStatus('in_progress')
  }

  if (status === 'loading') return <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Loading…</p>
  if (status === 'error') return <div className={`${card} text-center text-sm text-muted-foreground`}>{message}</div>
  if (status === 'intro')
    return (
      <div className={`${card} space-y-3`}>
        <h1 className="text-xl font-bold tracking-tight">Start your mortgage application</h1>
        <p className="text-sm text-muted-foreground">About 10 minutes, one short step at a time. Your answers save as you go on this device, so you can come back to finish. We never ask for your Social Security number here.</p>
        {message && <p className="text-sm text-destructive">{message}</p>}
        <button type="button" disabled={busy} onClick={() => void begin()} className="h-12 w-full rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
          {busy ? 'Starting…' : 'Start my application'}
        </button>
      </div>
    )
  if (status === 'submitted' || !answers)
    return (
      <div className={`${card} text-center`}>
        <CheckCircle2Icon className="mx-auto size-10 text-nurture" />
        <h1 className="mt-2 text-xl font-bold tracking-tight">Application received</h1>
        <p className="mt-1 text-sm text-muted-foreground">Thank you! Your loan officer is reviewing it and will reach out with next steps, including any documents needed.</p>
      </div>
    )

  const steps = stepsFor(answers)
  const at = Math.max(0, steps.findIndex((s) => s.id === step))
  const current = steps[at] ?? steps[0]
  const set = (patch: Partial<ApplicationAnswers>) => setAnswers((a) => (a ? { ...a, ...patch } : a))

  const go = async (to: number, check: boolean) => {
    if (check) {
      const p = stepProblems(current.id, answers, todayLocal())
      setProblems(p)
      if (p.length) return
    } else setProblems([])
    const next = steps[Math.min(Math.max(to, 0), steps.length - 1)].id
    setBusy(true)
    const r = await callApply({ action: 'save', ...who(), answers, step: next })
    setBusy(false)
    if (r.status === 401 || r.status === 410) return onExpired?.()
    if (r.status !== 200) return setProblems([r.body.error ?? 'Your answers did not save. Try again.'])
    setStep(next)
    window.scrollTo({ top: 0 })
  }

  const submit = async () => {
    const p = stepProblems('review', answers, todayLocal())
    setProblems(p)
    if (p.length) return
    setBusy(true)
    const r = await callApply({ action: 'submit', ...who(), answers })
    setBusy(false)
    if (r.status === 401 || r.status === 410) return onExpired?.()
    if (r.status !== 200) return setProblems(r.body.problems ?? [r.body.error ?? 'It did not go through. Try again.'])
    if (mode.kind === 'standalone') writeResume(null)
    setStatus('submitted')
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Step {at + 1} of {steps.length}
        </p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={at + 1} aria-valuemin={1} aria-valuemax={steps.length} aria-label="Application progress">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((at + 1) / steps.length) * 100}%` }} />
        </div>
        <h1 className="mt-3 text-xl font-bold tracking-tight">{current.label}</h1>
      </div>

      <div className={`${card} space-y-3`}>
        {current.id === 'you' && <PersonFields p={answers.borrower} onChange={(borrower) => set({ borrower })} />}
        {current.id === 'co_borrower' && (
          <>
            <YesNo label="Is anyone applying with you (a co-borrower)?" value={answers.hasCoBorrower} onChange={(hasCoBorrower) => set({ hasCoBorrower: !!hasCoBorrower })} />
            {answers.hasCoBorrower && (
              <>
                <PersonFields p={answers.coBorrower} onChange={(coBorrower) => set({ coBorrower })} />
                <YesNo label="Do they live with you?" value={answers.coSameAddress} onChange={(coSameAddress) => set({ coSameAddress: coSameAddress !== false })} />
              </>
            )}
          </>
        )}
        {current.id === 'home' && (
          <>
            <AddressFields a={answers.address} onChange={(address) => set({ address })} withHousing />
            {answers.address.housing === 'own' && (
              <div className="space-y-3 border-t pt-3">
                <p className="text-sm font-semibold">About your home</p>
                <HomeMoneyFields h={answers.address.owned} onChange={(patch) => set({ address: { ...answers.address, owned: { ...answers.address.owned, ...patch } } })} />
              </div>
            )}
            {answers.address.years != null && answers.address.years < 2 && (
              <div className="space-y-3 border-t pt-3">
                <p className="text-sm font-semibold">Your previous address</p>
                <AddressFields a={answers.previousAddress} onChange={(previousAddress) => set({ previousAddress })} />
              </div>
            )}
          </>
        )}
        {current.id === 'homes' && <OtherHomesFields a={answers} onChange={set} />}
        {current.id === 'work' &&<WorkFields jobs={answers.jobs} other={answers.otherIncome} onJobs={(jobs) => set({ jobs })} onOther={(otherIncome) => set({ otherIncome })} />}
        {current.id === 'co_work' && <WorkFields jobs={answers.coJobs} other={answers.coOtherIncome} onJobs={(coJobs) => set({ coJobs })} onOther={(coOtherIncome) => set({ coOtherIncome })} />}
        {current.id === 'assets' && <AssetFields items={answers.assets} co={answers.hasCoBorrower} onChange={(assets) => set({ assets })} />}
        {current.id === 'debts' && <DebtFields items={answers.debts} co={answers.hasCoBorrower} onChange={(debts) => set({ debts })} />}
        {current.id === 'loan' && <LoanFields a={answers} onChange={(loan) => set({ loan })} />}
        {current.id === 'declarations' && (
          <>
            <p className="text-sm text-muted-foreground">These are standard questions on every mortgage application.</p>
            {DECLARATIONS.map((d) => (
              <YesNo key={d.key} label={d.label} value={answers.declarations[d.key] ?? null} onChange={(v) => set({ declarations: { ...answers.declarations, [d.key]: v } })} />
            ))}
          </>
        )}
        {current.id === 'review' && <Review a={answers} onChange={set} />}
      </div>

      {problems.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        {at > 0 && (
          <button type="button" disabled={busy} onClick={() => void go(at - 1, false)} className="flex h-12 items-center gap-1 rounded-lg border bg-white px-4 text-base font-medium disabled:opacity-60">
            <ChevronLeftIcon className="size-4" />
            Back
          </button>
        )}
        {current.id === 'review' ? (
          <button type="button" disabled={busy} onClick={() => void submit()} className="h-12 flex-1 rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
            {busy ? 'Sending…' : 'Submit my application'}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void go(at + 1, true)} className="h-12 flex-1 rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
            {busy ? 'Saving…' : 'Save and continue'}
          </button>
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">Your answers save each time you continue. We never ask for your Social Security number here.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function Text({ label, value, onChange, type = 'text', placeholder, autoComplete, inputMode, maxLength }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoComplete?: string; inputMode?: 'numeric' | 'decimal' | 'tel' | 'email'; maxLength?: number }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input className={field} type={type} value={value} placeholder={placeholder} autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function Money({ label, value, onChange, placeholder = '$' }: { label: string; value: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        className={field}
        inputMode="decimal"
        placeholder={placeholder}
        value={value == null ? '' : value.toLocaleString('en-US')}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9.]/g, '')
          onChange(t === '' ? null : Number.isFinite(Number(t)) ? Number(t) : null)
        }}
      />
    </label>
  )
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T | ''; options: readonly [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <select className={field} value={value} onChange={(e) => onChange(e.target.value as T)}>
        <option value="" disabled>
          Pick one…
        </option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {[true, false].map((v) => (
          <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`h-11 rounded-lg border text-sm font-medium ${value === v ? 'border-primary bg-primary/10 text-primary' : 'bg-white'}`}>
            {v ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

const CITIZENSHIP: [Person['citizenship'] & string, string][] = [
  ['us_citizen', 'U.S. citizen'],
  ['permanent_resident_alien', 'Permanent resident (green card)'],
  ['non_permanent_resident_alien', 'Non-permanent resident (visa)'],
]
const MARITAL: [Person['maritalStatus'] & string, string][] = [
  ['married', 'Married'],
  ['separated', 'Separated'],
  ['unmarried', 'Unmarried (single, divorced, widowed)'],
]

function PersonFields({ p, onChange }: { p: Person; onChange: (p: Person) => void }) {
  const set = <K extends keyof Person>(k: K, v: Person[K]) => onChange({ ...p, [k]: v })
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Text label="First name" value={p.firstName} onChange={(v) => set('firstName', v)} autoComplete="given-name" />
        <Text label="Last name" value={p.lastName} onChange={(v) => set('lastName', v)} autoComplete="family-name" />
      </div>
      <Text label="Email" type="email" inputMode="email" value={p.email} onChange={(v) => set('email', v)} autoComplete="email" />
      <Text label="Cell phone" inputMode="tel" value={p.phone} onChange={(v) => set('phone', v)} autoComplete="tel" />
      <Text label="Date of birth" type="date" value={p.dateOfBirth} onChange={(v) => set('dateOfBirth', v)} autoComplete="bday" />
      <Choice label="Marital status" value={p.maritalStatus} options={MARITAL} onChange={(v) => set('maritalStatus', v)} />
      <label className="block text-sm font-medium">
        Dependents (children or others you support)
        <input className={field} inputMode="numeric" value={p.dependents ?? ''} onChange={(e) => set('dependents', e.target.value === '' ? null : Math.max(0, Math.min(20, Number(e.target.value.replace(/\D/g, '')))))} />
      </label>
      <Choice label="Citizenship" value={p.citizenship} options={CITIZENSHIP} onChange={(v) => set('citizenship', v)} />
      <YesNo label="Have you served in the U.S. military?" value={p.military} onChange={(v) => set('military', v)} />
    </>
  )
}

const HOUSING: [Address['housing'] & string, string][] = [
  ['own', 'I own it'],
  ['rent', 'I rent'],
  ['no_primary_expense', 'I live rent-free'],
]

function AddressFields({ a, onChange, withHousing }: { a: Address; onChange: (a: Address) => void; withHousing?: boolean }) {
  const set = <K extends keyof Address>(k: K, v: Address[K]) => onChange({ ...a, [k]: v })
  return (
    <>
      <Text label="Street address" value={a.line} onChange={(v) => set('line', v)} autoComplete="street-address" />
      <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
        <Text label="City" value={a.city} onChange={(v) => set('city', v)} autoComplete="address-level2" />
        <Text label="State" value={a.state} maxLength={2} onChange={(v) => set('state', v.toUpperCase())} autoComplete="address-level1" />
        <Text label="ZIP" inputMode="numeric" maxLength={5} value={a.zip} onChange={(v) => set('zip', v.replace(/\D/g, ''))} autoComplete="postal-code" />
      </div>
      {withHousing && (
        <>
          <Choice label="Do you own or rent?" value={a.housing} options={HOUSING} onChange={(v) => set('housing', v)} />
          {a.housing === 'rent' && <Money label="Monthly rent" value={a.monthlyRent} onChange={(v) => set('monthlyRent', v)} />}
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm font-medium">
              Years there
              <input className={field} inputMode="numeric" value={a.years ?? ''} onChange={(e) => set('years', e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')))} />
            </label>
            <label className="block text-sm font-medium">
              Months
              <input className={field} inputMode="numeric" value={a.months ?? ''} onChange={(e) => set('months', e.target.value === '' ? null : Math.min(11, Number(e.target.value.replace(/\D/g, ''))))} />
            </label>
          </div>
        </>
      )}
    </>
  )
}

/** How a W-2 job pays: yearly salary, hourly (rate × hours), or a monthly figure, plus overtime, bonus and commission over the last year. */
function W2Pay({ j, onChange }: { j: Job; onChange: (patch: Partial<Job>) => void }) {
  const opt = j.current ? '' : ' (optional)'
  return (
    <>
      <Pills label="How are you paid?" value={j.payType} options={[['salary', 'Salary'], ['hourly', 'Hourly'], ['monthly', 'I know my monthly']]} onChange={(payType) => onChange({ payType })} />
      {j.payType === 'salary' && <Money label={`Yearly salary before taxes${opt}`} value={j.annualSalary} onChange={(annualSalary) => onChange({ annualSalary })} />}
      {j.payType === 'hourly' && (
        <div className="grid grid-cols-2 gap-2">
          <Money label={`Hourly rate${opt}`} value={j.hourlyRate} onChange={(hourlyRate) => onChange({ hourlyRate })} />
          <label className="block text-sm font-medium">
            Hours a week
            <input className={field} inputMode="decimal" placeholder="e.g. 40" value={j.hoursPerWeek ?? ''} onChange={(e) => { const t = e.target.value.replace(/[^0-9.]/g, ''); onChange({ hoursPerWeek: t === '' ? null : Number(t) }) }} />
          </label>
        </div>
      )}
      {j.payType === 'monthly' && <Money label={`Monthly pay before taxes${opt}`} value={j.monthlyIncome} onChange={(monthlyIncome) => onChange({ monthlyIncome })} />}
      <details className="rounded-lg bg-muted/40 p-2.5" open={!!(j.overtimeYearly || j.bonusYearly || j.commissionYearly)}>
        <summary className="cursor-pointer text-sm font-medium">Overtime, bonus or commission?</summary>
        <p className="mt-1 text-xs text-muted-foreground">What you earned in the last 12 months. Leave blank if none.</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Money label="Overtime" value={j.overtimeYearly} onChange={(overtimeYearly) => onChange({ overtimeYearly })} />
          <Money label="Bonus" value={j.bonusYearly} onChange={(bonusYearly) => onChange({ bonusYearly })} />
          <Money label="Commission" value={j.commissionYearly} onChange={(commissionYearly) => onChange({ commissionYearly })} />
        </div>
      </details>
    </>
  )
}

/** A home they own: value, mortgage (balance, payment, whether it includes taxes and insurance), else taxes and insurance, HOA, and whether they're selling. */
function HomeMoneyFields({ h, onChange }: { h: HomeMoney; onChange: (patch: Partial<HomeMoney>) => void }) {
  const askCosts = h.hasMortgage === false || h.paymentIncludesEscrow === false
  return (
    <>
      <Money label="Estimated value" value={h.value} onChange={(value) => onChange({ value })} />
      <YesNo label="Is there a mortgage on it?" value={h.hasMortgage} onChange={(hasMortgage) => onChange({ hasMortgage })} />
      {h.hasMortgage && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Money label="Balance owed" value={h.mortgageBalance} onChange={(mortgageBalance) => onChange({ mortgageBalance })} />
            <Money label="Monthly payment" value={h.mortgagePayment} onChange={(mortgagePayment) => onChange({ mortgagePayment })} />
          </div>
          <YesNo label="Does that payment include your property taxes and insurance?" value={h.paymentIncludesEscrow} onChange={(paymentIncludesEscrow) => onChange({ paymentIncludesEscrow })} />
        </>
      )}
      {askCosts && (
        <div className="grid grid-cols-2 gap-2">
          <Money label="Property taxes a year" value={h.annualTaxes} onChange={(annualTaxes) => onChange({ annualTaxes })} />
          <Money label="Home insurance a year" value={h.annualInsurance} onChange={(annualInsurance) => onChange({ annualInsurance })} />
        </div>
      )}
      <Money label="HOA dues a month (optional)" value={h.monthlyHoa} onChange={(monthlyHoa) => onChange({ monthlyHoa })} placeholder="$0 if none" />
      <YesNo label="Do you plan to sell it?" value={h.selling} onChange={(selling) => onChange({ selling })} />
    </>
  )
}

function OtherHomesFields({ a, onChange }: { a: ApplicationAnswers; onChange: (p: Partial<ApplicationAnswers>) => void }) {
  const homes = a.otherHomes
  const setAt = (i: number, patch: Partial<OwnedHome>) => onChange({ otherHomes: homes.map((h, k) => (k === i ? { ...h, ...patch } : h)) })
  return (
    <>
      <YesNo
        label={a.address.housing === 'own' ? 'Besides where you live, do you own any other homes or rentals?' : 'Do you own any homes or rentals?'}
        value={a.ownsOtherHomes}
        onChange={(v) => onChange({ ownsOtherHomes: v, otherHomes: v && homes.length === 0 ? [blankOwnedHome()] : homes })}
      />
      {a.ownsOtherHomes &&
        homes.map((h, i) => (
          <div key={i} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Home {i + 1}</p>
              <button type="button" onClick={() => onChange({ otherHomes: homes.filter((_, k) => k !== i) })} className="text-muted-foreground" aria-label="Remove this home">
                <Trash2Icon className="size-4" />
              </button>
            </div>
            <Text label="Street address" value={h.line} onChange={(line) => setAt(i, { line })} />
            <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
              <Text label="City" value={h.city} onChange={(city) => setAt(i, { city })} />
              <Text label="State" value={h.state} maxLength={2} onChange={(v) => setAt(i, { state: v.toUpperCase() })} />
              <Text label="ZIP" inputMode="numeric" maxLength={5} value={h.zip} onChange={(v) => setAt(i, { zip: v.replace(/\D/g, '') })} />
            </div>
            <Pills label="How is it used?" value={h.use || ('' as OwnedHome['use'])} options={[['investment', 'Rental'], ['second_home', 'Second home']] as const} onChange={(use) => setAt(i, { use, monthlyRent: use === 'investment' ? h.monthlyRent : null })} />
            {h.use === 'investment' && <Money label="Rent it brings in a month" value={h.monthlyRent} onChange={(monthlyRent) => setAt(i, { monthlyRent })} placeholder="$0 if it's empty" />}
            <HomeMoneyFields h={h} onChange={(patch) => setAt(i, patch)} />
          </div>
        ))}
      {a.ownsOtherHomes && (
        <button type="button" onClick={() => onChange({ otherHomes: [...homes, blankOwnedHome()] })} className="flex h-11 w-full items-center justify-center gap-1 rounded-lg border border-dashed text-sm font-medium">
          <PlusIcon className="size-4" />
          Add another home
        </button>
      )}
    </>
  )
}

const OTHER_INCOME: [OtherIncome['kind'], string][] = [
  ['social_security', 'Social Security'],
  ['retirement', 'Retirement / pension'],
  ['disability', 'Disability'],
  ['child_support', 'Child support'],
  ['alimony', 'Alimony'],
  ['va_compensation', 'VA benefits'],
  ['other', 'Other'],
]

const JOB_KINDS: [JobKind, string][] = [
  ['w2', 'W-2 job'],
  ['1099', '1099 / contract'],
  ['self_employed', 'Own business'],
  ['school', 'School'],
]

/** Segmented buttons (a few short choices). */
function Pills<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly [T, string][]; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-1 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 4)}, minmax(0, 1fr))` }}>
        {options.map(([v, l]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`min-h-11 rounded-lg border px-1 text-xs font-medium leading-tight ${value === v ? 'border-primary bg-primary/10 text-primary' : 'bg-white'}`}>
            {l}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

function WorkFields({ jobs, other, onJobs, onOther }: { jobs: Job[]; other: OtherIncome[]; onJobs: (j: Job[]) => void; onOther: (o: OtherIncome[]) => void }) {
  // Under 2 years of dated jobs → an empty previous-job slot appears, ready to fill in (a gap is fine).
  const save = (next: Job[]) => onJobs(withHistorySlot(next.map(normalizeJob), todayLocal()))
  const setJob = (i: number, patch: Partial<Job>) => save(jobs.map((j, k) => (k === i ? { ...j, ...patch } : j)))
  const note = historyNote(jobs, todayLocal())
  return (
    <>
      <p className="text-sm text-muted-foreground">Your work and school for the last 2 years, starting with now. W-2, 1099 and your own business all count.</p>
      {jobs.map((j, i) => {
        const what = j.kind === 'school' ? 'School' : j.current ? 'Current job' : 'Previous job'
        const total = jobMonthlyTotal(j)
        return (
          <div key={i} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{what}</p>
              {jobs.length > 1 && (
                <button type="button" onClick={() => onJobs(jobs.filter((_, k) => k !== i))} className="text-muted-foreground" aria-label={`Remove this ${j.kind === 'school' ? 'school' : 'job'}`}>
                  <Trash2Icon className="size-4" />
                </button>
              )}
            </div>
            <Pills label="Type" value={j.kind} options={JOB_KINDS} onChange={(kind) => setJob(i, { kind })} />
            {j.kind === 'school' ? (
              <>
                <Text label="School" value={j.employer} onChange={(v) => setJob(i, { employer: v })} />
                <Text label="What you studied (optional)" value={j.title} onChange={(v) => setJob(i, { title: v })} />
                <YesNo label="Are you still in school?" value={j.current} onChange={(v) => setJob(i, { current: v !== false, endDate: v !== false ? '' : j.endDate })} />
              </>
            ) : (
              <>
                <Text label={j.kind === 'self_employed' ? 'Business name' : j.kind === '1099' ? 'Company you contract with' : 'Employer'} value={j.employer} onChange={(v) => setJob(i, { employer: v })} />
                <Text label="Your title" value={j.title} onChange={(v) => setJob(i, { title: v })} />
                {j.kind === 'self_employed' && (
                  <label className="block text-sm font-medium">
                    Your ownership share (%)
                    <input className={field} inputMode="decimal" placeholder="e.g. 100" value={j.ownershipPct ?? ''} onChange={(e) => { const t = e.target.value.replace(/[^0-9.]/g, ''); setJob(i, { ownershipPct: t === '' ? null : Math.min(100, Number(t)) }) }} />
                  </label>
                )}
                <YesNo label={j.kind === 'self_employed' ? 'Is the business still running?' : 'Do you still work here?'} value={j.current} onChange={(v) => setJob(i, { current: v !== false, endDate: v !== false ? '' : j.endDate })} />
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Text label="Start date" type="date" value={j.startDate} onChange={(v) => setJob(i, { startDate: v })} />
              {!j.current && <Text label="End date" type="date" value={j.endDate} onChange={(v) => setJob(i, { endDate: v })} />}
            </div>
            {j.kind === 'w2' && <W2Pay j={j} onChange={(patch) => setJob(i, patch)} />}
            {(j.kind === '1099' || j.kind === 'self_employed') && (
              <Money
                label={`Net income on last year's taxes${j.current ? '' : ' (optional)'}`}
                value={j.netYearly}
                onChange={(netYearly) => setJob(i, { netYearly })}
                placeholder={j.kind === '1099' ? '$ (after expenses, Schedule C)' : '$ (after expenses)'}
              />
            )}
            {j.kind !== 'school' && total > 0 && <p className="text-xs text-muted-foreground">About {money(total)} a month before taxes.</p>}
          </div>
        )
      })}
      {note && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{note}</p>}
      <button type="button" onClick={() => onJobs([...jobs, blankJob(false)])} className="flex h-11 w-full items-center justify-center gap-1 rounded-lg border border-dashed text-sm font-medium">
        <PlusIcon className="size-4" />
        Add a job or school
      </button>
      <div className="space-y-3 border-t pt-3">
        <p className="text-sm font-semibold">Other income (optional)</p>
        {other.map((o, i) => (
          <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
            <Choice label="Type" value={o.kind} options={OTHER_INCOME} onChange={(kind) => onOther(other.map((x, k) => (k === i ? { ...x, kind } : x)))} />
            <Money label="A month" value={o.monthly} onChange={(monthly) => onOther(other.map((x, k) => (k === i ? { ...x, monthly } : x)))} />
            <button type="button" onClick={() => onOther(other.filter((_, k) => k !== i))} className="mb-3 text-muted-foreground" aria-label="Remove this income">
              <Trash2Icon className="size-4" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => onOther([...other, { kind: 'social_security', monthly: null }])} className="flex h-11 w-full items-center justify-center gap-1 rounded-lg border border-dashed text-sm font-medium">
          <PlusIcon className="size-4" />
          Add other income
        </button>
      </div>
    </>
  )
}

const ASSETS: [Asset['kind'], string][] = [
  ['checking', 'Checking'],
  ['savings', 'Savings'],
  ['retirement', 'Retirement (401k, IRA)'],
  ['stocks', 'Stocks / investments'],
  ['gift_cash', 'Gift from family'],
  ['other_liquid', 'Other'],
]

function OwnerPick({ value, onChange }: { value: 'borrower' | 'co'; onChange: (v: 'borrower' | 'co') => void }) {
  return <Choice label="Whose is it?" value={value} options={[['borrower', 'Mine'], ['co', "My co-borrower's"]]} onChange={onChange} />
}

function AssetFields({ items, co, onChange }: { items: Asset[]; co: boolean; onChange: (a: Asset[]) => void }) {
  const setAt = (i: number, patch: Partial<Asset>) => onChange(items.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  return (
    <>
      <p className="text-sm text-muted-foreground">Bank and investment accounts you could use for the down payment and closing. Only the last 4 digits of an account.</p>
      {items.map((a, i) => (
        <div key={i} className="space-y-3 rounded-lg border p-3">
          <div className="flex justify-end">
            <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} className="text-muted-foreground" aria-label="Remove this account">
              <Trash2Icon className="size-4" />
            </button>
          </div>
          <Choice label="Type" value={a.kind} options={ASSETS} onChange={(kind) => setAt(i, { kind })} />
          {co && <OwnerPick value={a.owner} onChange={(owner) => setAt(i, { owner })} />}
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <Text label={a.kind === 'gift_cash' ? 'From whom' : 'Bank or company'} value={a.institution} onChange={(v) => setAt(i, { institution: v })} />
            <Text label="Last 4" inputMode="numeric" maxLength={4} value={a.last4} onChange={(v) => setAt(i, { last4: v.replace(/\D/g, '') })} />
          </div>
          <Money label="Balance" value={a.amount} onChange={(amount) => setAt(i, { amount })} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { owner: 'borrower', kind: 'checking', institution: '', last4: '', amount: null }])} className="flex h-11 w-full items-center justify-center gap-1 rounded-lg border border-dashed text-sm font-medium">
        <PlusIcon className="size-4" />
        Add an account
      </button>
    </>
  )
}

const DEBTS: [Debt['kind'], string][] = [
  ['revolving', 'Credit card'],
  ['installment', 'Car or personal loan'],
  ['lease', 'Lease'],
  ['child_support', 'Child support you pay'],
  ['alimony', 'Alimony you pay'],
  ['other', 'Other (student loan, etc.)'],
]

function DebtFields({ items, co, onChange }: { items: Debt[]; co: boolean; onChange: (d: Debt[]) => void }) {
  const setAt = (i: number, patch: Partial<Debt>) => onChange(items.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  return (
    <>
      <p className="text-sm text-muted-foreground">The monthly payments you know of. Your credit report fills in the rest, so close is fine. Skip this if you have none.</p>
      {items.map((d, i) => (
        <div key={i} className="space-y-3 rounded-lg border p-3">
          <div className="flex justify-end">
            <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} className="text-muted-foreground" aria-label="Remove this debt">
              <Trash2Icon className="size-4" />
            </button>
          </div>
          <Choice label="Type" value={d.kind} options={DEBTS} onChange={(kind) => setAt(i, { kind })} />
          {co && <OwnerPick value={d.owner} onChange={(owner) => setAt(i, { owner })} />}
          <Text label="Who it's with" value={d.creditor} onChange={(v) => setAt(i, { creditor: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Money label="Monthly payment" value={d.monthlyPayment} onChange={(monthlyPayment) => setAt(i, { monthlyPayment })} />
            <Money label="Balance (optional)" value={d.balance} onChange={(balance) => setAt(i, { balance })} />
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { owner: 'borrower', kind: 'revolving', creditor: '', monthlyPayment: null, balance: null }])} className="flex h-11 w-full items-center justify-center gap-1 rounded-lg border border-dashed text-sm font-medium">
        <PlusIcon className="size-4" />
        Add a debt
      </button>
    </>
  )
}

function LoanFields({ a, onChange }: { a: ApplicationAnswers; onChange: (l: ApplicationAnswers['loan']) => void }) {
  const l = a.loan
  const set = <K extends keyof typeof l>(k: K, v: (typeof l)[K]) => onChange({ ...l, [k]: v })
  const purchase = l.purpose === 'purchase'
  return (
    <>
      <Choice label="What is the loan for?" value={l.purpose} options={[['purchase', 'Buying a home'], ['refinance_rate_term', 'Refinancing (lower rate or term)'], ['refinance_cash_out', 'Refinancing with cash out']]} onChange={(v) => set('purpose', v)} />
      <Choice label="How will you use the home?" value={l.occupancy} options={[['primary', 'I will live in it'], ['second_home', 'Second home'], ['investment', 'Investment / rental']]} onChange={(v) => set('occupancy', v)} />
      {l.purpose && (
        <>
          <Money label={purchase ? 'Price you are looking at' : "The home's estimated value"} value={l.price} onChange={(v) => set('price', v)} />
          {purchase ? (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="mr-auto">Down payment you'd like</span>
                <div className="flex rounded-lg bg-muted p-0.5 text-xs">
                  {(['percent', 'amount'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => onChange({ ...l, downMode: m, down: null })} className={`rounded-md px-2.5 py-1 ${l.downMode === m ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground'}`}>
                      {m === 'percent' ? '%' : '$'}
                    </button>
                  ))}
                </div>
              </div>
              <input className={field} inputMode="decimal" aria-label="Down payment" placeholder={l.downMode === 'percent' ? 'e.g. 5' : '$'} value={l.down == null ? '' : l.downMode === 'amount' ? l.down.toLocaleString('en-US') : String(l.down)} onChange={(e) => { const t = e.target.value.replace(/[^0-9.]/g, ''); set('down', t === '' ? null : Number(t)) }} />
            </div>
          ) : (
            <>
              <Money label="What you owe on it now" value={l.balance} onChange={(v) => set('balance', v)} placeholder="$0 if nothing" />
              {l.purpose === 'refinance_cash_out' && <Money label="Cash out you'd like" value={l.cashOut} onChange={(v) => set('cashOut', v)} />}
            </>
          )}
          <Text label="State of the home" maxLength={2} value={l.state} onChange={(v) => set('state', v.toUpperCase())} />
          <Choice label="When would you like to close?" value={l.timeline} options={[['ASAP', 'As soon as possible'], ['1-3 months', 'In 1–3 months'], ['3-6 months', 'In 3–6 months'], ['Just exploring', 'Just exploring']]} onChange={(v) => set('timeline', v)} />
          <Choice label="Your credit, roughly (optional)" value={l.creditScore == null ? '' : String(l.creditScore)} options={[['760', '760 or higher'], ['720', '720–759'], ['680', '680–719'], ['640', '640–679'], ['600', '600–639'], ['580', 'Below 600']]} onChange={(v) => set('creditScore', Number(v))} />
        </>
      )}
    </>
  )
}

function Review({ a, onChange }: { a: ApplicationAnswers; onChange: (p: Partial<ApplicationAnswers>) => void }) {
  const money = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`)
  const rows: [string, string][] = [
    ['You', `${a.borrower.firstName} ${a.borrower.lastName} · ${a.borrower.email}`],
    ...(a.hasCoBorrower ? [['Co-borrower', `${a.coBorrower.firstName} ${a.coBorrower.lastName}`] as [string, string]] : []),
    ['Address', [a.address.line, a.address.city, a.address.state].filter(Boolean).join(', ')],
    ...(a.address.housing === 'own' ? [['Your home', a.address.owned.hasMortgage ? `Mortgage ${money(a.address.owned.mortgageBalance)} · ${money(a.address.owned.mortgagePayment)}/mo` : 'No mortgage'] as [string, string]] : []),
    ['Other homes', a.ownsOtherHomes && a.otherHomes.length ? a.otherHomes.map((h) => `${h.line}${h.use === 'investment' ? ` (rental ${money(h.monthlyRent)}/mo)` : ''}`).join('; ') : 'None'],
    ['Work', a.jobs.filter((j) => j.employer.trim()).map((j) => (j.kind === 'school' ? `${j.employer} (school)` : `${j.employer}${j.current && jobMonthlyTotal(j) ? ` · ${money(jobMonthlyTotal(j))}/mo` : ''}`)).join(', ') || '—'],
    ['Accounts', a.assets.length ? `${a.assets.length} (${money(a.assets.reduce((s, x) => s + (x.amount ?? 0), 0))})` : 'None'],
    ['Debts', a.debts.length ? `${a.debts.length} (${money(a.debts.reduce((s, x) => s + (x.monthlyPayment ?? 0), 0))}/mo)` : 'None'],
    ['Loan', `${a.loan.purpose === 'purchase' ? 'Buying' : 'Refinancing'} · ${money(a.loan.price)}`],
  ]
  return (
    <>
      <dl className="divide-y text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 py-2">
            <dt className="w-24 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 flex-1 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={a.textsOk} onChange={(e) => onChange({ textsOk: e.target.checked })} />
        <span>It's OK to text me about my application. Message and data rates may apply. Reply STOP to opt out.</span>
      </label>
      {/* COMPLIANCE: placeholder credit authorization wording, subject to Connor's review (CREDIT_AUTH_VERSION). */}
      <label className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={a.creditAuthorized} onChange={(e) => onChange({ creditAuthorized: e.target.checked })} />
        <span>{CREDIT_AUTH_TEXT}</span>
      </label>
    </>
  )
}
