// "Application" on a file's Overview (Stage 5): send each borrower the
// application (their portal link opened on it; drafts only), see where an
// application stands and what it says, "Add to the 1003" for one that wasn't
// added on submit (a person or file that was already here), and the MISMO
// 3.4 file built from the 1003, saved to Documents the first time a submitted,
// added application is opened here, and the file's suggested conditions
// (from the company rules and the 1003 it filled: pay stubs, W-2s, 1099s,
// returns, statements, mortgage statements and leases, a letter for a gap in
// work…) added to the Conditions list at the same time, once.
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2Icon, ChevronDownIcon, FileCode2Icon, MailIcon, MessageSquareIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, confirmAction } from '@/components/shared'
import { useBorrowerApplications, useApplyApplication, useDraftApplicationInvite, useMarkConditionsAdded, useSaveApplicationMismo, type BorrowerApplication } from '@/lib/api/applications'
import { useConditionSuggestions } from '@/components/conditions/SuggestedConditions'
import { useAddConditions, useConditions } from '@/lib/api/conditions'
import { usePortalLinks } from '@/lib/api/portal'
import { useProperties } from '@/lib/api/properties'
import { useOrganization, useProfile } from '@/lib/api/settings'
import type { LoanProfile } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { todayIso, relativeTime } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { buildMismo34 } from '@/lib/mismo/build'
import { exportFileName } from '@/lib/mismo/checklist'
import { applicationUrl } from '@/lib/portal/messages'
import { DECLARATIONS, STEPS, jobMonthlyTotal, normalizeAnswers, type HomeMoney, type Job } from '../../../supabase/functions/apply/form'

const OUTCOME: Record<NonNullable<BorrowerApplication['outcome']>, string> = {
  new_lead: 'New lead from the application link',
  new_loan_existing_person: 'Past client: a new file was started',
  existing_open_loan: 'Sent while this file was open',
  portal: 'From the borrower portal',
}

export function ApplicationCard({ loan }: { loan: LoanProfile }) {
  const apps = useBorrowerApplications(loan.id)
  const links = usePortalLinks(loan.id)
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  const organization = useOrganization()
  const originator = useProfile(loan.assignedLo?.id)
  const apply = useApplyApplication(loan.id)
  const saveMismo = useSaveApplicationMismo(loan.id)
  const draft = useDraftApplicationInvite(loan.id)
  const saving = useRef(new Set<string>())
  const conditions = useConditions(loan.id)
  const suggested = useConditionSuggestions(loan, conditions.data)
  const addConditions = useAddConditions(loan.id, loan.organizationId)
  const markConditions = useMarkConditionsAdded(loan.id)
  const conditioning = useRef(new Set<string>())
  const readOnly = loan.stage === 'closed' || loan.stage === 'lost'
  const fail = (e: Error) => toast.error(e.message)

  // MISMO saved on first open: a submitted application that's on the 1003 and has no file yet.
  const due = (apps.data ?? []).find((a) => a.status === 'submitted' && a.appliedAt && !a.mismoDocumentId && !saving.current.has(a.id))
  const ready = !!app.data && !app.isFetching && properties.data !== undefined && organization.data !== undefined && originator.isFetched
  useEffect(() => {
    if (!due || !ready || readOnly) return
    saving.current.add(due.id)
    const primary = app.data!.borrowers.find((b) => b.role === 'primary') ?? app.data!.borrowers[0]
    const xml = buildMismo34({ createdAt: new Date().toISOString(), loan, application: app.data!, properties: properties.data ?? [], organization: organization.data ?? null, originator: originator.data ?? null })
    saveMismo.mutate(
      { applicationId: due.id, organizationId: loan.organizationId, fileName: exportFileName(primary?.person.lastName, todayIso()), xml },
      { onSuccess: () => toast.success('MISMO 3.4 file from the application saved to Documents'), onError: fail },
    )
    // saveMismo/loan are stable enough here; the ref keeps this to once per application.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due?.id, ready, readOnly])

  // Conditions filled in once, after a submitted application is on the 1003 (the suggestions read the 1003 it filled).
  const condDue = (apps.data ?? []).find((a) => a.status === 'submitted' && a.appliedAt && !a.conditionsAddedAt && !conditioning.current.has(a.id))
  const condReady = !!suggested && !app.isFetching && !properties.isFetching && !conditions.isFetching
  useEffect(() => {
    if (!condDue || !condReady || readOnly) return
    conditioning.current.add(condDue.id)
    const items = suggested!.suggestions
    const after = (conditions.data ?? []).reduce((m, c) => Math.max(m, c.position), 0)
    const mark = () => markConditions.mutate(condDue.id, { onError: fail })
    if (!items.length) return mark()
    addConditions.mutate(
      { items: items.map((s) => ({ body: s.body, party: s.party, sourceKey: s.key, documentRequestId: s.request?.id ?? null })), after },
      {
        onSuccess: () => {
          mark()
          toast.success(`Added ${items.length} condition${items.length === 1 ? '' : 's'} from the application. See Docs & Conditions.`)
        },
        onError: (e) => toast.error(/source_key|document_request_id/.test(e.message) ? 'Run the suggested conditions script (20270112000000) in Supabase first.' : e.message),
      },
    )
    // Once per application (the ref); the rest is read when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condDue?.id, condReady, readOnly])

  if (apps.data === null) return null // The applications script hasn't run yet.
  const people = app.data?.borrowers ?? []
  const lo = originator.data?.fullName ?? 'Your loan officer'

  const addTo1003 = async (a: BorrowerApplication) => {
    if (!(await confirmAction('Add this application to the 1003? It fills in what the file is missing and adds jobs, accounts and debts it does not have yet. Nothing already on the file is changed.', { confirmLabel: 'Add to the 1003' }))) return
    apply.mutate(a.id, {
      onSuccess: (n) => toast.success(`Added to the 1003: ${n.jobs_and_income} jobs and income, ${n.assets} accounts, ${n.debts} debts, ${n.homes ?? 0} homes${n.co_borrower ? ', and the co-borrower' : ''}. Conditions follow.`),
      onError: fail,
    })
  }

  return (
    <Card title="Application" description="The borrower's own mortgage application: about 10 minutes, saved as they go, no SSN.">
      {(apps.data?.length ?? 0) > 0 && (
        <ul className="mb-3 divide-y">
          {apps.data!.map((a) => (
            <ApplicationRow key={a.id} a={a} readOnly={readOnly} busy={apply.isPending} onAdd={() => void addTo1003(a)} />
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Send the application</p>
          {people.map((b) => {
            const name = `${b.person.firstName} ${b.person.lastName}`.trim()
            const link = links.data?.find((l) => l.contactId === b.contactId && Date.parse(l.expiresAt) > Date.now()) ?? null
            const queue = (channel: 'text' | 'email') =>
              link &&
              draft.mutate(
                { organizationId: loan.organizationId, contactId: b.contactId, name, firstName: b.person.firstName, loName: lo, phone: b.person.phone, email: b.person.email, url: applicationUrl(link.url), channel },
                { onSuccess: () => toast.success(`The ${channel} is waiting in the Action Queue. Nothing is sent until you press Send.`), onError: fail },
              )
            return (
              <div key={b.contactId} className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="mr-auto font-medium">{name}</span>
                {link ? (
                  <>
                    <Button size="xs" variant="outline" disabled={!b.person.phone || draft.isPending} title={b.person.phone ? 'Draft a text with the application link (Action Queue)' : 'No phone on file'} onClick={() => queue('text')}>
                      <MessageSquareIcon />
                      Draft text
                    </Button>
                    <Button size="xs" variant="outline" disabled={!b.person.email || draft.isPending} title={b.person.email ? 'Draft an email with the application link (Action Queue)' : 'No email on file'} onClick={() => queue('email')}>
                      <MailIcon />
                      Draft email
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">Make their portal link first (Borrower portal); the application opens from it.</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function ApplicationRow({ a, readOnly, busy, onAdd }: { a: BorrowerApplication; readOnly: boolean; busy: boolean; onAdd: () => void }) {
  const [open, setOpen] = useState(false)
  const name = `${a.answers.borrower?.firstName ?? ''} ${a.answers.borrower?.lastName ?? ''}`.trim() || 'Borrower'
  const stepLabel = STEPS.find((s) => s.id === a.step)?.label
  return (
    <li className="space-y-1.5 py-2.5 text-sm first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold">{name}</span>
        <span className="text-xs text-muted-foreground">
          {a.status === 'submitted' ? `Submitted ${a.submittedAt ? relativeTime(a.submittedAt) : ''}` : `In progress${stepLabel ? ` · on ${stepLabel}` : ''} · last saved ${relativeTime(a.updatedAt)}`}
        </span>
      </div>
      {a.outcome && <p className="text-xs text-muted-foreground">{OUTCOME[a.outcome]}</p>}
      {a.status === 'submitted' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {a.appliedAt ? (
            <span className="flex items-center gap-1 text-nurture">
              <CheckCircle2Icon className="size-3.5" />
              On the 1003 since {relativeTime(a.appliedAt)}
            </span>
          ) : (
            !readOnly && (
              <Button size="xs" disabled={busy} onClick={onAdd}>
                Add to the 1003
              </Button>
            )
          )}
          {a.mismoDocumentId && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <FileCode2Icon className="size-3.5" />
              MISMO file in Documents
            </span>
          )}
          {a.conditionsAddedAt && <span className="text-muted-foreground">Conditions added {relativeTime(a.conditionsAddedAt)}</span>}
          {a.creditAuthAt && <span className="text-muted-foreground">Credit check authorized {relativeTime(a.creditAuthAt)}</span>}
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-medium text-primary">
        <ChevronDownIcon className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? 'Hide answers' : 'Show answers'}
      </button>
      {open && <Answers a={a.answers} />}
    </li>
  )
}

const KIND: Record<Job['kind'], string> = { w2: 'W-2', '1099': '1099', self_employed: 'Own business', school: 'School' }

function Answers({ a: raw }: { a: BorrowerApplication['answers'] }) {
  const a = normalizeAnswers(raw)
  const m = (n: number | null | undefined) => (n == null ? '—' : formatCurrency(n))
  const yes = (v: boolean | null | undefined) => (v == null ? '—' : v ? 'Yes' : 'No')
  const job = (j: Job) => {
    if (j.kind === 'school') return `${j.employer}${j.title ? ` · ${j.title}` : ''} · school ${j.startDate}–${j.current ? 'now' : j.endDate}`
    const pay =
      j.kind === 'w2'
        ? [j.payType === 'salary' && j.annualSalary ? `${m(j.annualSalary)}/yr salary` : null, j.payType === 'hourly' && j.hourlyRate ? `${m(j.hourlyRate)}/hr × ${j.hoursPerWeek ?? '?'} hrs` : null, j.overtimeYearly ? `OT ${m(j.overtimeYearly)}/yr` : null, j.bonusYearly ? `bonus ${m(j.bonusYearly)}/yr` : null, j.commissionYearly ? `commission ${m(j.commissionYearly)}/yr` : null]
        : [j.netYearly != null ? `net ${m(j.netYearly)} last year` : null, j.ownershipPct != null ? `owns ${j.ownershipPct}%` : null]
    return [`${j.employer} (${KIND[j.kind]})`, j.title, `${j.startDate}–${j.current ? 'now' : j.endDate}`, ...pay, jobMonthlyTotal(j) ? `≈ ${m(jobMonthlyTotal(j))}/mo` : null].filter(Boolean).join(' · ')
  }
  const home = (h: HomeMoney) =>
    [`value ${m(h.value)}`, h.hasMortgage ? `mortgage ${m(h.mortgageBalance)} · ${m(h.mortgagePayment)}/mo${h.paymentIncludesEscrow ? ' incl. taxes & ins.' : ''}` : 'no mortgage', !h.paymentIncludesEscrow && h.annualTaxes != null ? `taxes ${m(h.annualTaxes)}/yr` : null, !h.paymentIncludesEscrow && h.annualInsurance != null ? `ins. ${m(h.annualInsurance)}/yr` : null, h.monthlyHoa ? `HOA ${m(h.monthlyHoa)}/mo` : null, h.selling ? 'selling' : null]
      .filter(Boolean)
      .join(' · ')
  const rows: [string, string][] = [
    ['Email · phone', [a.borrower?.email, a.borrower?.phone].filter(Boolean).join(' · ') || '—'],
    ['Date of birth', a.borrower?.dateOfBirth || '—'],
    ['Marital · dependents', `${a.borrower?.maritalStatus || '—'} · ${a.borrower?.dependents ?? '—'}`],
    ['Citizenship · military', `${a.borrower?.citizenship || '—'} · ${yes(a.borrower?.military)}`],
    ...(a.hasCoBorrower ? [['Co-borrower', `${a.coBorrower?.firstName ?? ''} ${a.coBorrower?.lastName ?? ''} · ${a.coBorrower?.email ?? ''}`] as [string, string]] : []),
    ['Address', `${[a.address?.line, a.address?.city, a.address?.state, a.address?.zip].filter(Boolean).join(', ')} · ${a.address?.housing ?? '—'}${a.address?.housing === 'rent' ? ` ${m(a.address.monthlyRent)}/mo` : ''} · ${a.address?.years ?? 0} yr ${a.address?.months ?? 0} mo`],
    ...(a.address.housing === 'own' ? [['Their home', home(a.address.owned)] as [string, string]] : []),
    ...(a.previousAddress?.line ? [['Previous address', [a.previousAddress.line, a.previousAddress.city, a.previousAddress.state].filter(Boolean).join(', ')] as [string, string]] : []),
    ...(a.ownsOtherHomes ? a.otherHomes : []).map((h, i): [string, string] => [`Other home ${i + 1}`, `${[h.line, h.city, h.state].filter(Boolean).join(', ')} · ${h.use === 'investment' ? `rental ${m(h.monthlyRent)}/mo` : 'second home'} · ${home(h)}`]),
    ...a.jobs.filter((j) => j.employer.trim()).map((j, i): [string, string] => [`Work ${i + 1}`, job(j)]),
    ...(a.otherIncome ?? []).map((o, i): [string, string] => [`Other income ${i + 1}`, `${o.kind} · ${m(o.monthly)}/mo`]),
    ...(a.hasCoBorrower ? a.coJobs.filter((j) => j.employer.trim()).map((j, i): [string, string] => [`Co-borrower work ${i + 1}`, job(j)]) : []),
    ...(a.assets ?? []).map((x, i): [string, string] => [`Account ${i + 1}`, `${x.kind} · ${x.institution}${x.last4 ? ` ••${x.last4}` : ''} · ${m(x.amount)}${x.owner === 'co' ? ' (co-borrower)' : ''}`]),
    ...(a.debts ?? []).map((d, i): [string, string] => [`Debt ${i + 1}`, `${d.kind} · ${d.creditor} · ${m(d.monthlyPayment)}/mo${d.balance != null ? ` · ${m(d.balance)} owed` : ''}`]),
    ['Loan', `${a.loan?.purpose ?? '—'} · ${a.loan?.occupancy ?? '—'} · ${m(a.loan?.price)}${a.loan?.purpose === 'purchase' ? ` · ${a.loan.down ?? '—'}${a.loan.downMode === 'percent' ? '%' : ''} down` : ` · owes ${m(a.loan?.balance)}`} · ${a.loan?.state ?? ''} · ${a.loan?.timeline ?? ''}`],
    ...DECLARATIONS.filter((d) => a.declarations?.[d.key] === true).map((d): [string, string] => ['Declaration: yes', d.label]),
    ['Texts OK', yes(a.textsOk)],
  ]
  return (
    <dl className="divide-y rounded-lg border text-xs">
      {rows.map(([k, v], i) => (
        <div key={`${k}-${i}`} className="flex gap-3 px-2.5 py-1.5">
          <dt className="w-32 shrink-0 text-muted-foreground">{k}</dt>
          <dd className="min-w-0 flex-1 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
