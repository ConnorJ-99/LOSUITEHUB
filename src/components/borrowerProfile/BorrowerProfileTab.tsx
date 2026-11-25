// The Borrower Profile tab (plan docs/plans/borrower-profile.md, Stage 1;
// Connor 2026-11-24). One page that pulls together what's already on the file:
// the 1003 (people, housing, jobs, other income, assets, debts, homes owned),
// income worksheets, the 1003 tab's own prequal math and Max Approval, the
// Selected estimate, MyHome's reported balances, readiness and what's still
// outstanding on Docs & Conditions. Nothing is copied or stored: it changes
// whenever those change. Each figure shows where it came from (Borrower-reported,
// Estimated, Verified, Missing); missing figures say "Missing", never $0.
// The status is the file's stage (Connor's choice), with readiness's hint.
import { useMemo, type ReactNode } from 'react'
import { AlertTriangleIcon, InfoIcon } from 'lucide-react'
import { cn } from 'cn'
import { Card } from '@/components/shared'
import { CollapsibleCard } from '@/components/prequal/Fold'
import { useSavedReadiness } from '@/components/prequal/Readiness'
import { MORTGAGE_TYPE_OPTIONS, OCCUPANCY_OPTIONS, REO_DISPOSITION_OPTIONS } from '@/components/profile/options'
import { useReportedAssets } from '@/lib/api/borrowerAssets'
import { useConditions } from '@/lib/api/conditions'
import { useDocumentRequests } from '@/lib/api/documentRules'
import { useLoanDocuments } from '@/lib/api/documents'
import { useEstimates } from '@/lib/api/estimates'
import { useWorksheets } from '@/lib/api/income'
import { useLoanFile } from '@/lib/api/loanfile'
import { useProperties } from '@/lib/api/properties'
import { useFeeTemplates } from '@/lib/api/pricing'
import { useOrganization, useProfile } from '@/lib/api/settings'
import type { LoanProfile } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { maxApproval } from '@/lib/calc'
import { APPROVAL_LIMIT_LABELS } from '@/lib/calc/maxApproval'
import { formatIsoDate } from '@/lib/dates'
import { prequalFeeEstimate, selectedClosingCosts } from '@/lib/estimates/prequal'
import { formatCurrency } from '@/lib/format'
import { purposeLabel, stageLabel } from '@/lib/pipeline/stages'
import { approvalFacts, approvalFormFrom, approvalInput } from '@/lib/prequal/maxApproval'
import { draftFrom, prequalSummary } from '@/lib/prequal/draft'
import { HOUSING_OPTIONS } from '@/lib/urla/options'
import {
  ASSET_GROUP_LABEL,
  QUALIFICATION_LABEL,
  SOURCE_LABEL,
  assetLines,
  assetTotals,
  fig,
  incomeVerification,
  jobLines,
  liabilityLines,
  profileFlags,
  qualification,
  reoLines,
  type AssetGroup,
  type Figure,
  type Source,
} from '@/lib/profile/profile'

const STATEMENT_KINDS = ['bank_statement', 'investment_statement']
const label = <T extends string>(opts: readonly { value: T; label: string }[], v: T | null | undefined) => (v ? (opts.find((o) => o.value === v)?.label ?? v) : null)

const SOURCE_STYLE: Record<Source, string> = {
  reported: 'bg-sky-50 text-sky-800',
  estimated: 'bg-amber-50 text-amber-800',
  verified: 'bg-emerald-50 text-emerald-800',
  missing: 'bg-muted text-muted-foreground',
}

function Tag({ source }: { source: Source }) {
  return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase', SOURCE_STYLE[source])}>{SOURCE_LABEL[source]}</span>
}

/** "$4,000" with its source tag, or "Missing". */
function Money({ f, pct, suffix }: { f: Figure; pct?: boolean; suffix?: string }) {
  if (f.value == null) return <span className="text-muted-foreground italic">Missing</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-semibold tabular-nums">{pct ? `${f.value.toFixed(1)}%` : `${formatCurrency(f.value)}${suffix ?? ''}`}</span>
      <Tag source={f.source} />
    </span>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b py-1.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

function Tile({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{k}</p>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  )
}

const text = (v: string | null | undefined) => (v ? <span className="font-medium">{v}</span> : <span className="text-muted-foreground italic">Missing</span>)

export function BorrowerProfileTab({ loan }: { loan: LoanProfile }) {
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  const templates = useFeeTemplates()
  const org = useOrganization()
  const worksheets = useWorksheets(loan.id)
  const file = useLoanFile(loan.id)
  const docs = useLoanDocuments(loan.id)
  const estimates = useEstimates(loan.id)
  const conditions = useConditions(loan.id)
  const requests = useDocumentRequests(loan.id)
  const readinessView = useSavedReadiness(loan)
  const borrowers = app.data?.borrowers ?? []
  const reported = useReportedAssets(borrowers.map((b) => b.contactId))
  const processorRow = file.data?.team.find((t) => t.role === 'processor') ?? null
  const processorProfile = useProfile(processorRow?.profileId)

  const isPurchase = loan.purpose === 'purchase'
  const ready = app.data && properties.data && worksheets.data

  // The 1003 tab's own math, from the saved records (no what-ifs).
  const calc = useMemo(() => {
    if (!app.data || !properties.data) return null
    const draft = draftFrom(loan, app.data, properties.data, false)
    const feeEstimate = prequalFeeEstimate(loan, templates.data ?? [])
    const summary = prequalSummary(loan, draft, properties.data, feeEstimate)
    if (!isPurchase) return { draft, summary, approval: null }
    const form = approvalFormFrom(loan.details)
    const facts = approvalFacts(draft, summary, org.data, selectedClosingCosts(loan.details))
    const input = approvalInput(draft.loan, form, facts)
    const approval = maxApproval({
      ...input,
      costsAt: input.costsAt ?? (feeEstimate && ((price, loanAmount) => feeEstimate(price, loanAmount, { mortgageType: draft.loan.mortgageType, noteRate: draft.loan.noteRate, termMonths: draft.loan.termMonths, occupancy: form.occupancy, upfrontFeePct: draft.loan.upfrontFeePct }))),
    })
    return { draft, summary, approval }
  }, [app.data, properties.data, templates.data, org.data, loan, isPurchase])

  if (!ready || !calc)
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Loading the borrower profile…</p>
      </Card>
    )

  const { draft, summary, approval } = calc
  const a = app.data!
  const ws = worksheets.data!
  const creditPulled = !!file.data?.marks.some((m) => m.stepKey === 'credit' && m.status === 'done')
  const statementContacts = [...new Set((docs.data ?? []).filter((d) => STATEMENT_KINDS.includes(d.kind) && d.contactId).map((d) => d.contactId!))]
  const jobs = jobLines(a.borrowers.flatMap((b) => b.employments), ws.map((w) => ({ contactId: w.contactId, employmentId: w.employmentId, status: w.status, pushedMonthly: w.pushedMonthly })))
  const assets = assetLines(a.assets, statementContacts)
  const max = approval?.max ?? null
  const totals = assetTotals(assets, max ? max.funds : null)
  const debts = liabilityLines(a.liabilities, creditPulled)
  const owned = (properties.data ?? []).filter((p) => p.id !== loan.details.subjectPropertyId && (p.status === 'current_home' || p.status === 'owned'))
  const reo = reoLines(owned.map((p) => ({ id: p.id, addressLine: p.addressLine, city: p.city, status: p.status, occupancy: p.reoOccupancy, disposition: p.reoDisposition, estimatedValue: p.estimatedValue, monthlyRent: p.monthlyRent, annualTaxes: p.annualTaxes, annualInsurance: p.annualInsurance, monthlyHoa: p.monthlyHoa, liens: p.liens.map((l) => ({ balance: l.balance, monthlyPayment: l.monthlyPayment })) })))
  const selected = (estimates.data ?? []).find((e) => e.id === loan.details.pricingScenarioId) ?? null
  const nameOf = (contactId: string) => {
    const b = a.borrowers.find((x) => x.contactId === contactId)
    return b ? `${b.person.firstName} ${b.person.lastName}`.trim() : ''
  }
  const several = a.borrowers.length > 1

  // The headline figures. Income and DTI only count when income is entered.
  const anyIncome = jobs.some((j) => j.current && j.monthly.value != null) || a.borrowers.some((b) => b.otherIncomes.length > 0)
  const incomeSource: Exclude<Source, 'missing'> = incomeVerification(jobs) === 'verified' ? 'verified' : 'reported'
  const income = anyIncome ? fig(summary.totalIncome, incomeSource) : fig(null, 'reported')
  const score = fig(summary.creditScore, 'reported')
  const targetPrice = fig(isPurchase ? loan.details.purchasePrice : null, 'reported')
  const loanAmount = fig(summary.loanAmount, selected ? 'estimated' : 'reported')
  const downPayment = fig(isPurchase && summary.cash ? summary.cash.downPayment : null, 'estimated')
  const housing = fig(selected?.figures?.pitia ?? summary.housing, 'estimated')
  const front = anyIncome ? fig(summary.dti.front, 'estimated') : fig(null, 'estimated')
  const back = anyIncome ? fig(summary.dti.back, 'estimated') : fig(null, 'estimated')
  const rate = fig(selected?.figures?.ratePct ?? draft.loan.noteRate, 'estimated')
  const q = qualification(loan.stage, readinessView?.result.level ?? null)
  const reportedTotal = reported.data?.length ? reported.data.reduce((s, x) => s + x.balance, 0) : null
  const flags = profileFlags({
    isPurchase,
    targetPrice: targetPrice.value,
    maxPrice: max?.price ?? null,
    maxMissing: approval?.missing ?? null,
    income: income.value,
    jobs,
    worksheets: ws.map((w) => ({ contactId: w.contactId, employmentId: w.employmentId, status: w.status, pushedMonthly: w.pushedMonthly })),
    assets1003: totals.total.value,
    assetsMyHome: reportedTotal,
    score: score.value,
    creditPulled,
    hasDebts: a.liabilities.length > 0,
    rate: rate.value,
  })
  const outstandingConditions = (conditions.data ?? []).filter((c) => c.status === 'outstanding' || c.status === 'requested')
  // Every document asked for sits under a condition (Connor 2026-11-17), so open conditions are the outstanding list.
  const waitingDocs = (requests.data ?? []).filter((r) => (r.status === 'requested' || r.status === 'rejected') && !r.conditionId)
  const groups = (Object.keys(ASSET_GROUP_LABEL) as AssetGroup[]).filter((g) => assets.some((x) => x.group === g))

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Borrower profile · {purposeLabel(loan.purpose)}
            </p>
            <h2 className="text-2xl font-bold tracking-tight">{a.borrowers.map((b) => `${b.person.firstName} ${b.person.lastName}`.trim()).join(' & ') || 'No borrower yet'}</h2>
            <p className="text-sm text-muted-foreground">
              {stageLabel(loan.stage)} · Loan officer: {loan.assignedLo?.name ?? 'Unassigned'}
              {processorRow && ` · Processor: ${processorProfile.data?.fullName ?? processorRow.name ?? 'Assigned'}`}
            </p>
          </div>
          <div className="text-right">
            <span className={cn('inline-block rounded-full px-3 py-1 text-sm font-semibold', q.qualified ? 'bg-emerald-50 text-emerald-800' : q.status === 'not_qualified' ? 'bg-rose-50 text-rose-800' : 'bg-muted')}>{QUALIFICATION_LABEL[q.status]}</span>
            {q.hint && <p className="mt-1 text-xs text-amber-800">Readiness: {QUALIFICATION_LABEL[q.hint].toLowerCase()}</p>}
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Tile k="Purpose · occupancy">{text([purposeLabel(loan.purpose), label(OCCUPANCY_OPTIONS, loan.details.occupancy)].filter(Boolean).join(' · '))}</Tile>
          {isPurchase && <Tile k="Target price">{<Money f={targetPrice} />}</Tile>}
          {isPurchase && (
            <Tile k="Max calculated price">
              {max ? <Money f={fig(max.price, 'estimated')} /> : <span className="text-muted-foreground italic">Not calculated</span>}
              {approval?.limitedBy && <p className="text-xs text-muted-foreground">Limited by {APPROVAL_LIMIT_LABELS[approval.limitedBy].toLowerCase()}</p>}
            </Tile>
          )}
          {isPurchase && <Tile k="Down payment">{<Money f={downPayment} />}</Tile>}
          <Tile k="Loan amount">{<Money f={loanAmount} />}</Tile>
          <Tile k="Credit score">
            {score.value == null ? (
              <span className="text-muted-foreground italic">Missing</span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="font-semibold">{score.value}</span>
                <Tag source="reported" />
              </span>
            )}
          </Tile>
          <Tile k="Qualifying income / mo">{<Money f={income} />}</Tile>
          <Tile k="Monthly debts">{<Money f={debts.monthly} />}</Tile>
          <Tile k="Liquid assets">{<Money f={totals.liquid} />}</Tile>
          <Tile k="Eligible assets">{<Money f={totals.eligible} />}</Tile>
          <Tile k="Housing payment / mo">{<Money f={housing} />}</Tile>
          <Tile k="DTI front / back">{front.value == null ? <span className="text-muted-foreground italic">Missing</span> : <span className="font-semibold tabular-nums">{front.value.toFixed(1)}% / {back.value?.toFixed(1)}%</span>}</Tile>
          <Tile k="Timeline">{text(loan.timeline)}</Tile>
        </div>
      </Card>

      {flags.length > 0 && (
        <Card title="Discrepancies and missing information">
          <ul className="space-y-1.5 text-sm">
            {flags.map((f, i) => (
              <li key={i} className="flex items-start gap-2">
                {f.level === 'warning' ? <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <CollapsibleCard title="Personal information" summary={`${a.borrowers.length} borrower${a.borrowers.length === 1 ? '' : 's'}`}>
        <div className="grid gap-4 md:grid-cols-2">
          {a.borrowers.map((b) => {
            const home = b.addresses.find((x) => x.kind === 'current') ?? null
            return (
              <div key={b.contactId} className="rounded-lg border p-3">
                <p className="font-semibold">
                  {b.person.firstName} {b.person.lastName} <span className="text-xs font-normal text-muted-foreground">{b.role === 'primary' ? 'Borrower' : 'Co-borrower'}</span>
                </p>
                <Row k="Email">{text(b.person.email)}</Row>
                <Row k="Phone">{text(b.person.phone)}</Row>
                <Row k="Current address">{text(home ? [home.addressLine, home.city].filter(Boolean).join(', ') : null)}</Row>
                <Row k="Housing">{text(label(HOUSING_OPTIONS, home?.housing))}{home?.monthlyRent != null && <span className="ml-1 text-muted-foreground">({formatCurrency(home.monthlyRent)}/mo)</span>}</Row>
              </div>
            )
          })}
        </div>
        <div className="mt-3">
          <Row k="Purchase objective">{text(purposeLabel(loan.purpose))}</Row>
          <Row k="Timeline">{text(loan.timeline)}</Row>
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Income and employment" summary={income.value == null ? 'Missing' : `${formatCurrency(income.value)}/mo`}>
        {jobs.length === 0 && a.borrowers.every((b) => b.otherIncomes.length === 0) ? (
          <p className="text-sm text-muted-foreground italic">No income on the 1003 yet.</p>
        ) : (
          <div className="space-y-3">
            {jobs.map((j) => (
              <div key={j.id} className="rounded-lg border p-3">
                <p className="font-semibold">
                  {j.employer} <span className="text-xs font-normal text-muted-foreground">{[j.title, j.type, j.current ? 'Current' : 'Previous', several ? nameOf(j.contactId) : null].filter(Boolean).join(' · ')}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {j.startDate ? formatIsoDate(j.startDate) : 'Start date missing'} – {j.current ? 'present' : j.endDate ? formatIsoDate(j.endDate) : 'end date missing'}
                </p>
                {j.type === 'Self-employed' ? <Row k="Self-employment income / mo">{<Money f={j.selfEmployed} />}</Row> : (
                  <>
                    <Row k="Base / mo">{<Money f={j.base} />}</Row>
                    <Row k="Overtime, bonus, commission / mo">{<Money f={j.variable} />}</Row>
                  </>
                )}
              </div>
            ))}
            {a.borrowers.flatMap((b) => b.otherIncomes).map((o) => (
              <Row key={o.id} k={`${o.incomeType.replace(/_/g, ' ')}${o.description ? ` (${o.description})` : ''}`}>{<Money f={fig(o.monthlyAmount, 'reported')} suffix="/mo" />}</Row>
            ))}
            <Row k="Total qualifying monthly income">{<Money f={income} />}</Row>
            <Row k="Income verification">{text({ verified: 'Verified (final income worksheets)', partly: 'Partly verified', unverified: 'Not verified yet' }[incomeVerification(jobs) ?? 'unverified'])}</Row>
          </div>
        )}
      </CollapsibleCard>

      <CollapsibleCard title="Assets and reserves" summary={totals.total.value == null ? 'Missing' : formatCurrency(totals.total.value)}>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No assets on the 1003 yet.</p>
        ) : (
          groups.map((g) => (
            <div key={g} className="mb-2">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{ASSET_GROUP_LABEL[g]}</p>
              {assets.filter((x) => x.group === g).map((x) => (
                <Row key={x.id} k={x.name}>{<Money f={x.amount} />}</Row>
              ))}
            </div>
          ))
        )}
        <div className="mt-2">
          <Row k="Total liquid assets">{<Money f={totals.liquid} />}</Row>
          <Row k="Total eligible assets">{<Money f={totals.eligible} />}</Row>
          <Row k="Estimated funds to close">{<Money f={fig(max?.cashToClose ?? selected?.figures?.cashToClose ?? summary.cashNeeded, 'estimated')} />}</Row>
          <Row k="Estimated reserves after closing">{<Money f={fig(summary.reserves?.amount ?? null, 'estimated')} />}{summary.reserves?.months != null && <span className="ml-1 text-xs text-muted-foreground">({summary.reserves.months} months)</span>}</Row>
          {reportedTotal != null && <Row k="Reported in MyHome">{<Money f={fig(reportedTotal, 'reported')} />}</Row>}
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Credit and liabilities" summary={debts.monthly.value == null ? 'No debts entered' : `${formatCurrency(debts.monthly.value)}/mo`}>
        {a.borrowers.map((b) => (
          <Row key={b.contactId} k={`${b.person.firstName}'s score`}>{b.estimatedCreditScore != null ? <span className="inline-flex items-center gap-1.5"><span className="font-semibold">{b.estimatedCreditScore}</span><Tag source="reported" /></span> : <span className="text-muted-foreground italic">Missing</span>}</Row>
        ))}
        <Row k="Mortgage credit scores">
          <span className="text-muted-foreground italic">Missing</span>
        </Row>
        <Row k="Credit pulled">{text(creditPulled ? 'Yes (Workflow step done)' : 'Not yet')}</Row>
        {debts.lines.length > 0 && (
          <div className="mt-2">
            {debts.lines.map((d) => (
              <Row key={d.id} k={`${d.name}${d.paidOff ? ' · paid off at closing' : ''}`}>
                <span className="inline-flex flex-wrap justify-end gap-2">
                  <span className="text-muted-foreground">Balance</span> <Money f={d.balance} /> <span className="text-muted-foreground">Payment</span> <Money f={d.payment} />
                </span>
              </Row>
            ))}
          </div>
        )}
        <Row k="Total monthly liabilities">{<Money f={debts.monthly} />}</Row>
      </CollapsibleCard>

      <CollapsibleCard title="Real estate owned" summary={reo.length ? `${reo.length} home${reo.length === 1 ? '' : 's'}` : 'None'}>
        {reo.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No homes owned on the file.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {reo.map((h) => (
              <div key={h.id} className="rounded-lg border p-3">
                <p className="font-semibold">{h.address}</p>
                <Row k="Occupancy">{text(h.occupancy ? label(OCCUPANCY_OPTIONS, h.occupancy as never) : null)}</Row>
                <Row k="Plan">{text(h.disposition ? label(REO_DISPOSITION_OPTIONS, h.disposition as never) : null)}</Row>
                <Row k="Estimated value">{<Money f={h.value} />}</Row>
                <Row k="Mortgage balance">{<Money f={h.balance} />}</Row>
                <Row k="Housing costs / mo">{<Money f={h.housing} />}</Row>
                {h.rent.value != null && <Row k="Rent / mo">{<Money f={h.rent} />}</Row>}
                <Row k="Estimated equity">{<Money f={h.equity} />}</Row>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      <CollapsibleCard title="Financing and qualification" summary={loan.details.programName ?? label(MORTGAGE_TYPE_OPTIONS, draft.loan.mortgageType) ?? ''}>
        <Row k="Program">{text(selected?.program ? `${selected.program.programName ?? ''}`.trim() || null : (loan.details.programName ?? label(MORTGAGE_TYPE_OPTIONS, draft.loan.mortgageType)))}</Row>
        {isPurchase && <Row k="Target price">{<Money f={targetPrice} />}</Row>}
        {isPurchase && <Row k="Maximum calculated price">{max ? <Money f={fig(max.price, 'estimated')} /> : <span className="text-muted-foreground italic">{approval?.missing ?? 'Not calculated'}</span>}</Row>}
        {isPurchase && <Row k="Down payment">{<Money f={downPayment} />}</Row>}
        <Row k="Loan amount">{<Money f={loanAmount} />}</Row>
        <Row k="Interest rate">{rate.value == null ? <span className="text-muted-foreground italic">Missing</span> : <span className="inline-flex items-center gap-1.5"><span className="font-semibold">{rate.value.toFixed(3)}%</span><Tag source="estimated" /></span>}</Row>
        <Row k="Term">{text(draft.loan.termMonths ? `${draft.loan.termMonths / 12} years` : null)}</Row>
        <Row k="Housing payment / mo">{<Money f={housing} />}</Row>
        <Row k="Closing costs">{<Money f={fig(selected?.figures?.closingCosts ?? summary.cash?.closingCosts ?? null, 'estimated')} />}</Row>
        <Row k="Cash to close">{<Money f={fig(selected?.figures?.cashToClose ?? summary.cashNeeded, 'estimated')} />}</Row>
        <Row k="Housing ratio / total DTI">{front.value == null ? <span className="text-muted-foreground italic">Missing</span> : `${front.value.toFixed(1)}% / ${back.value?.toFixed(1)}%`}</Row>
        <div className="mt-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Scenarios & Estimate</p>
          {(estimates.data ?? []).filter((e) => !e.archivedAt).length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No estimates yet.</p>
          ) : (
            (estimates.data ?? [])
              .filter((e) => !e.archivedAt)
              .map((e) => (
                <Row key={e.id} k={`${e.name || 'Estimate'}${e.id === loan.details.pricingScenarioId ? ' · Selected' : ''}`}>
                  {e.figures ? `${formatCurrency(e.figures.totalLoanAmount)} · ${e.figures.ratePct ?? '—'}% · ${formatCurrency(e.figures.pitia)}/mo · ${formatCurrency(e.figures.cashToClose)} to close` : 'Not priced'}
                </Row>
              ))
          )}
        </div>
        {(outstandingConditions.length > 0 || waitingDocs.length > 0) && (
          <div className="mt-3">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Outstanding</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {outstandingConditions.slice(0, 12).map((c) => (
                <li key={c.id}>{c.body}</li>
              ))}
              {waitingDocs.map((r) => (
                <li key={r.id}>{r.label}</li>
              ))}
            </ul>
          </div>
        )}
      </CollapsibleCard>
    </div>
  )
}
