import type * as React from 'react'
import { useState } from 'react'
import { Link } from 'react-router'
import { HomeIcon, MailIcon, PhoneIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, confirmAction, CurrencyInput, DateInput, FormGrid, Input, PercentInput, Select, SummaryBar, type SummaryItem } from '@/components/shared'
import { StageBadge } from '@/components/pipeline/StageBadge'
import { lastContact, useNotes } from '@/lib/api/notes'
import { useLenders } from '@/lib/api/lenders'
import { useContactLoans, useUpdateLead, useUpdateLoanDetails } from '@/lib/api/loans'
import { useProgramOptions } from '@/lib/api/loanPricing'
import { useProperties, useSaveHomeFigures, type HomeFigures } from '@/lib/api/properties'
import type { Lien, LoanDetails, LoanProfile, Property } from '@/lib/api/types'
import { computeScenario, texasHomeEquityFlags, type ScenarioResult } from '@/lib/calc'
import { formatIsoDate, relativeTime, todayIso } from '@/lib/dates'
import { formatCurrency, formatPercent } from '@/lib/format'
import { formatPhone } from '@/lib/pipeline/helpers'
import { purposeLabel } from '@/lib/pipeline/stages'
import { noteKindLabel, OCCUPANCY_OPTIONS, TERM_OPTIONS } from './options'
import { TasksCard } from './TasksCard'
import { WebFormsCard } from './WebFormsCard'
import { ReadinessCard, useSavedReadiness } from '@/components/prequal/Readiness'
import { TexasFlags } from './TexasFlags'
import { ActionQueueCard } from '@/components/queue/ActionQueueCard'
import { loanScenarioInput } from '@/lib/urla/summary'

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

/** Key figures for the sticky bar, chosen by loan purpose. */
function summaryItems(loan: LoanProfile, form: EditableDetails, r: ScenarioResult, subject: Property | null, texasCapBreached: boolean): SummaryItem[] {
  switch (loan.purpose) {
    case 'purchase':
      return [
        { label: 'Price', value: formatCurrency(form.purchasePrice) },
        { label: 'Loan amount', value: formatCurrency(form.loanAmount) },
        { label: 'Down', value: r.downPayment ? `${formatCurrency(r.downPayment.amount)} (${formatPercent(r.downPayment.percent, 2)})` : '—' },
        { label: 'LTV', value: formatPercent(r.ltv) },
        { label: 'Est. PITI', value: formatCurrency(r.payment?.total) },
      ]
    case 'refinance_rate_term':
    case 'refinance_cash_out':
      return [
        { label: 'Value', value: formatCurrency(r.value) },
        { label: 'Loan amount', value: formatCurrency(form.loanAmount) },
        { label: 'LTV', value: formatPercent(r.ltv) },
        { label: 'CLTV', value: formatPercent(r.cltv), warning: texasCapBreached },
        { label: 'New P&I', value: formatCurrency(r.payment?.principalAndInterest) },
        { label: 'Savings / mo', value: formatCurrency(r.refinance?.monthlySavings), warning: (r.refinance?.monthlySavings ?? 0) < 0 },
      ]
    case 'heloc':
    case 'heloan':
      return [
        { label: 'Value', value: formatCurrency(r.value) },
        { label: '1st lien', value: formatCurrency(r.firstLienBalance) },
        { label: 'New 2nd', value: formatCurrency(form.loanAmount) },
        { label: 'CLTV', value: formatPercent(r.cltv), warning: texasCapBreached },
        { label: loan.purpose === 'heloc' ? 'Interest-only pmt' : 'Payment', value: formatCurrency(r.payment?.total) },
      ]
    case 'investment_dscr':
      return [
        { label: 'Loan amount', value: formatCurrency(form.loanAmount) },
        { label: 'LTV', value: formatPercent(r.ltv) },
        { label: 'PITIA', value: formatCurrency(r.payment?.total) },
        { label: 'Rent', value: formatCurrency(subject?.monthlyRent) },
        { label: 'DSCR', value: r.dscr?.toFixed(2) ?? '—', warning: r.dscr !== null && r.dscr < 1 },
      ]
  }
}

function NoSubjectProperty({ onGoToProperties }: { onGoToProperties: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2.5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <HomeIcon className="size-4 shrink-0" />
        No subject property yet. Add the home to fill in its value, taxes, insurance and existing liens.
      </p>
      <Button size="sm" variant="outline" onClick={onGoToProperties}>
        Go to Properties
      </Button>
    </div>
  )
}

const FROM_PROPERTY = 'Saved to the subject property'
const NEEDS_PROPERTY = 'Add the subject property first'

/** The details this form edits. The subject property is chosen on the Properties tab. */
type EditableDetails = Omit<LoanDetails, 'subjectPropertyId'>

function editable({ subjectPropertyId, ...rest }: LoanDetails): EditableDetails {
  void subjectPropertyId
  return rest
}

/**
 * The lender (and program, if known) for this file without pricing it first:
 * pick one of your lenders or type any name. A program chosen on Loan ·
 * Pricing names its own lender and takes over, so it's shown instead.
 */
function LenderFields({ loan, lenderName, programName, onLender, onProgram }: { loan: LoanProfile; lenderName: string | null; programName: string | null; onLender: (v: string) => void; onProgram: (v: string) => void }) {
  const lenders = useLenders()
  const options = useProgramOptions(loan.id)
  const chosen = loan.details.programId ? options.data?.find((o) => o.programId === loan.details.programId) : undefined
  if (loan.details.programId)
    return (
      <>
        <Input label="Lender" value={chosen?.lenderName ?? ''} readOnly hint="Chosen on Loan · Pricing" span={2} />
        <Input label="Program" value={chosen?.programName ?? ''} readOnly span={2} />
      </>
    )
  const lender = lenders.data?.find((l) => l.name.toLowerCase() === (lenderName ?? '').trim().toLowerCase())
  return (
    <>
      <Input label="Lender" value={lenderName ?? ''} onChange={onLender} list={`lenders-${loan.id}`} placeholder="Pick or type a lender" hint="No pricing needed; quotes can come later" span={2} />
      <datalist id={`lenders-${loan.id}`}>
        {(lenders.data ?? []).map((l) => (
          <option key={l.id} value={l.name} />
        ))}
      </datalist>
      <Input label="Program (optional)" value={programName ?? ''} onChange={onProgram} list={`programs-${loan.id}`} placeholder={lender ? 'Pick or type a program' : 'e.g. Conventional'} span={2} />
      <datalist id={`programs-${loan.id}`}>
        {(lender?.programs ?? []).filter((p) => p.active).map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
    </>
  )
}

/** A 1st lien typed on the Loan details card before the home has one (used for the live math until it's saved). */
function newFirstLien(propertyId: string, balance: number | null, monthlyPayment: number | null): Lien {
  return { id: 'new-first-lien', propertyId, position: 'first', lender: null, balance, noteRate: null, monthlyPayment, isHeloc: false, originatedOn: null, isTexasCashOut: false, toBePaidOff: false, creditLimit: null, mortgageType: null }
}

function OtherLoans({ loan }: { loan: LoanProfile }) {
  const loans = useContactLoans(loan.borrower?.id)
  const others = (loans.data ?? []).filter((l) => l.id !== loan.id)
  if (others.length === 0) return <p className="text-sm text-muted-foreground">This is their only loan so far.</p>
  return (
    <ul className="divide-y">
      {others.map((other) => (
        <li key={other.id}>
          <Link to={`/loans/${other.id}`} className="flex items-center justify-between gap-3 py-2 hover:underline">
            <span className="text-sm">
              {purposeLabel(other.purpose)}
              <span className="text-xs text-muted-foreground"> · {formatIsoDate(other.createdAt.slice(0, 10))}</span>
              {other.id === loan.priorLoanId && <span className="text-xs text-muted-foreground"> · prior loan</span>}
            </span>
            <StageBadge stage={other.stage} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function OverviewTab({ loan, onGoToTab }: { loan: LoanProfile; onGoToTab: (tab: 'notes' | 'properties') => void }) {
  const properties = useProperties(loan.id)
  const notes = useNotes(loan.borrower?.id)
  const updateDetails = useUpdateLoanDetails(loan.id)
  const readinessResult = useSavedReadiness(loan)
  const saved = editable(loan.details)
  const [form, setForm] = useState<EditableDetails>(saved)
  const set = <K extends keyof EditableDetails>(key: K) => (value: EditableDetails[K]) => setForm((f) => ({ ...f, [key]: value }))

  const saveHome = useSaveHomeFigures(loan.id, loan.organizationId)
  const updateLead = useUpdateLead()
  // The home's value and 1st lien, edited here but saved on the property (so every tab shows the same figures).
  const [home, setHome] = useState<HomeFigures>({})
  const savedSubject: Property | null = properties.data?.find((p) => p.id === loan.details.subjectPropertyId) ?? null
  const savedFirstLien = savedSubject?.liens.find((l) => l.position === 'first') ?? null
  type Figure = Exclude<keyof HomeFigures, 'firstLienStays'>
  const savedHome: Record<Figure, number | null> = { estimatedValue: savedSubject?.estimatedValue ?? null, firstLienBalance: savedFirstLien?.balance ?? null, firstLienPayment: savedFirstLien?.monthlyPayment ?? null }
  const homeValue = (k: Figure) => (home[k] !== undefined ? home[k]! : savedHome[k])
  const setHomeValue = (k: Figure) => (v: number | null) => setHome((h) => ({ ...h, [k]: v }))
  const homeChanges = Object.fromEntries(Object.entries(home).filter(([k, v]) => v !== savedHome[k as Figure])) as HomeFigures
  const homeDirty = Object.keys(homeChanges).length > 0
  // The subject property as it will be once saved, so every calculated box updates as you type.
  const subject: Property | null = savedSubject && {
    ...savedSubject,
    estimatedValue: homeValue('estimatedValue'),
    liens: savedFirstLien
      ? savedSubject.liens.map((l) => (l.id === savedFirstLien.id ? { ...l, balance: homeValue('firstLienBalance'), monthlyPayment: homeValue('firstLienPayment') } : l))
      : homeChanges.firstLienBalance != null || homeChanges.firstLienPayment != null
        ? [...savedSubject.liens, newFirstLien(savedSubject.id, homeValue('firstLienBalance'), homeValue('firstLienPayment'))]
        : savedSubject.liens,
  }
  const result = computeScenario(loanScenarioInput(loan.purpose, { ...loan.details, ...form }, subject))
  const texasFlags = texasHomeEquityFlags({
    purpose: loan.purpose,
    propertyState: subject?.state ?? null,
    isHomestead: subject?.isHomestead ?? false,
    cltv: result.cltv,
    priorCashOutDates: (subject?.liens ?? []).filter((l) => l.isTexasCashOut && l.originatedOn).map((l) => l.originatedOn!),
    closingDate: form.closingDate,
    today: todayIso(),
  })
  const texasCapBreached = texasFlags.some((f) => f.code === 'cltv_cap')

  const changes = Object.fromEntries(
    Object.entries(form).filter(([key, value]) => value !== saved[key as keyof EditableDetails]),
  ) as Partial<EditableDetails>
  const dirty = Object.keys(changes).length > 0 || homeDirty
  const saving = updateDetails.isPending || saveHome.isPending

  const save = async () => {
    try {
      if (Object.keys(changes).length) await updateDetails.mutateAsync(changes)
      if (homeDirty && savedSubject) await saveHome.mutateAsync({ propertyId: savedSubject.id, firstLienId: savedFirstLien?.id ?? null, figures: homeChanges })
      setHome({})
      toast.success('Loan details saved')
    } catch (error) {
      toast.error(`Could not save: ${(error as Error).message}`)
    }
  }

  /** A cash-out on a home whose 1st mortgage stays is a 2nd lien: the HELOAN layout shows the 1st lien, the new 2nd and CLTV. */
  const switchToHeloan = async () => {
    if (!loan.borrower) return
    if (!(await confirmAction('Switch this file to HELOAN (closed-end 2nd lien)? Loan details will show the home value, the 1st lien that stays, the new 2nd lien amount, the cash out and CLTV.', { confirmLabel: 'Switch to HELOAN' }))) return
    const b = loan.borrower
    updateLead.mutate(
      { loanId: loan.id, contactId: b.id, contact: { firstName: b.firstName, lastName: b.lastName, phone: b.phone, email: b.email }, loan: { purpose: 'heloan', referralSource: loan.referralSource, assignedLoId: loan.assignedLo?.id ?? null } },
      {
        onSuccess: () => {
          // The 1st mortgage stays on a 2nd-lien file, so it isn't paid off at closing.
          if (savedSubject && savedFirstLien?.toBePaidOff) saveHome.mutate({ propertyId: savedSubject.id, firstLienId: savedFirstLien.id, figures: { firstLienStays: true } })
          toast.success('Switched to HELOAN')
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  const purpose = loan.purpose
  const isRefi = purpose === 'refinance_rate_term' || purpose === 'refinance_cash_out'
  const isSecond = purpose === 'heloc' || purpose === 'heloan'
  const contact = lastContact(notes.data)
  const b = loan.borrower
  const termValue = form.termMonths ? (String(form.termMonths) as (typeof TERM_OPTIONS)[number]['value']) : null
  const items = summaryItems(loan, form, result, subject, texasCapBreached)

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ActionQueueCard loan={loan} />
          <TexasFlags flags={texasFlags} />

          <Card title="Loan details" description={purposeLabel(purpose)}>
            {purpose !== 'purchase' && !subject && properties.isSuccess && <NoSubjectProperty onGoToProperties={() => onGoToTab('properties')} />}

            <FormGrid>
              {purpose === 'purchase' && (
                <>
                  <CurrencyInput label="Purchase price" value={form.purchasePrice} onChange={set('purchasePrice')} required span={2} />
                  <CurrencyInput label="Loan amount" value={form.loanAmount} onChange={set('loanAmount')} required span={2} />
                  <PercentInput label="LTV" value={result.ltv} readOnly hint="Calculated" span={2} />
                  <CurrencyInput label="Down payment" value={result.downPayment?.amount ?? null} readOnly hint="Calculated" span={2} />
                  <PercentInput label="Down payment %" value={result.downPayment?.percent ?? null} readOnly maxDecimals={2} hint="Calculated" span={2} />
                  <CurrencyInput label="Est. PITI" value={result.payment?.total ?? null} readOnly hint="Taxes, insurance, HOA from the subject property" span={2} />
                </>
              )}

              {isRefi && (
                <>
                  <CurrencyInput label="Home value" value={homeValue('estimatedValue')} onChange={setHomeValue('estimatedValue')} readOnly={!subject} hint={subject ? FROM_PROPERTY : NEEDS_PROPERTY} span={2} />
                  <CurrencyInput label="Current 1st lien" value={homeValue('firstLienBalance')} onChange={setHomeValue('firstLienBalance')} readOnly={!subject} hint={subject ? FROM_PROPERTY : NEEDS_PROPERTY} span={2} />
                  <CurrencyInput label="Current P&I" value={homeValue('firstLienPayment')} onChange={setHomeValue('firstLienPayment')} readOnly={!subject} hint={subject ? FROM_PROPERTY : NEEDS_PROPERTY} span={2} />
                  <CurrencyInput label="New loan amount" value={form.loanAmount} onChange={set('loanAmount')} required span={2} />
                  {purpose === 'refinance_cash_out' && (
                    <CurrencyInput label="Cash-out amount" value={form.cashOutAmount} onChange={set('cashOutAmount')} span={2} />
                  )}
                  {purpose === 'refinance_cash_out' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground sm:col-span-2 lg:col-span-6">
                      <span>Keeping the 1st mortgage? Then this cash out is a 2nd lien (HELOAN).</span>
                      <Button size="sm" variant="outline" onClick={switchToHeloan} disabled={updateLead.isPending}>
                        Switch to HELOAN
                      </Button>
                    </div>
                  )}
                  <PercentInput label="LTV" value={result.ltv} readOnly hint="Calculated" />
                  <PercentInput label="CLTV" value={result.cltv} readOnly hint="Calculated" />
                  <CurrencyInput label="New P&I" value={result.payment?.principalAndInterest ?? null} readOnly hint="Calculated" span={2} />
                  <CurrencyInput
                    label="Monthly savings"
                    value={result.refinance?.monthlySavings ?? null}
                    readOnly
                    hint="Net tangible benefit: current P&I minus new P&I"
                    span={2}
                  />
                </>
              )}

              {isSecond && (
                <>
                  <CurrencyInput label="Home value" value={homeValue('estimatedValue')} onChange={setHomeValue('estimatedValue')} readOnly={!subject} hint={subject ? FROM_PROPERTY : NEEDS_PROPERTY} span={2} />
                  <CurrencyInput
                    label="1st lien balance"
                    value={homeValue('firstLienBalance')}
                    onChange={setHomeValue('firstLienBalance')}
                    readOnly={!subject}
                    required
                    span={2}
                    hint={subject ? `${FROM_PROPERTY} (the 1st mortgage that stays)` : NEEDS_PROPERTY}
                    error={subject && homeValue('firstLienBalance') === null ? 'Required for CLTV' : undefined}
                  />
                  <CurrencyInput label="1st lien P&I" value={homeValue('firstLienPayment')} onChange={setHomeValue('firstLienPayment')} readOnly={!subject} hint={subject ? FROM_PROPERTY : NEEDS_PROPERTY} span={2} />
                  <CurrencyInput
                    label={purpose === 'heloc' ? 'HELOC line amount (2nd lien)' : '2nd lien amount (HELOAN)'}
                    value={form.loanAmount}
                    onChange={set('loanAmount')}
                    required
                    span={2}
                  />
                  <CurrencyInput label="Cash-out amount" value={form.cashOutAmount} onChange={set('cashOutAmount')} hint="Cash to the borrower at closing" span={2} />
                  <PercentInput label="CLTV (qualifying)" value={result.cltv} readOnly hint="1st lien + new 2nd, over value" span={2} />
                  <CurrencyInput
                    label={purpose === 'heloc' ? 'Interest-only payment' : 'Monthly payment'}
                    value={result.payment?.total ?? null}
                    readOnly
                    hint="Calculated"
                    span={2}
                  />
                </>
              )}

              {purpose === 'investment_dscr' && (
                <>
                  <CurrencyInput label="Purchase price" value={form.purchasePrice} onChange={set('purchasePrice')} hint="Leave blank for a refinance" span={2} />
                  <CurrencyInput label="Loan amount" value={form.loanAmount} onChange={set('loanAmount')} required span={2} />
                  <PercentInput label="LTV" value={result.ltv} readOnly hint="Calculated" span={2} />
                  <CurrencyInput label="Monthly rent" value={subject?.monthlyRent ?? null} readOnly hint={FROM_PROPERTY} span={2} />
                  <CurrencyInput label="PITIA" value={result.payment?.total ?? null} readOnly hint="Calculated" span={2} />
                  <Input label="DSCR" value={result.dscr?.toFixed(2) ?? ''} readOnly hint="Rent ÷ PITIA" span={2} />
                  <Input label="Vesting entity (LLC)" value={form.vestingEntity ?? ''} onChange={(v) => set('vestingEntity')(v || null)} span={4} />
                  <Input
                    label="Financed properties"
                    inputMode="numeric"
                    value={form.financedPropertiesCount?.toString() ?? ''}
                    onChange={(v) => set('financedPropertiesCount')(v.trim() === '' ? null : Math.max(0, Math.floor(Number(v.replace(/\D/g, '')) || 0)))}
                    span={2}
                  />
                </>
              )}

              <PercentInput label="Note rate" value={form.noteRate} onChange={set('noteRate')} />
              {purpose !== 'heloc' && (
                <Select label="Term" value={termValue} onChange={(v) => set('termMonths')(Number(v))} options={TERM_OPTIONS} />
              )}
              <Select label="Occupancy" value={form.occupancy} onChange={set('occupancy')} options={OCCUPANCY_OPTIONS} required span={2} />
              <DateInput label="Closing date" value={form.closingDate} onChange={set('closingDate')} span={2} />
              <LenderFields loan={loan} lenderName={form.lenderName} programName={form.programName} onLender={(v) => set('lenderName')(v.trim() ? v : null)} onProgram={(v) => set('programName')(v.trim() ? v : null)} />
              {purpose === 'purchase' && (
                <>
                  <DateInput label="Contract date" value={form.contractDate} onChange={set('contractDate')} span={2} />
                  <DateInput label="Option period ends" value={form.optionEndDate} onChange={set('optionEndDate')} span={2} />
                </>
              )}
            </FormGrid>
          </Card>

          <Card title="Contact">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Phone">
                {b?.phone ? (
                  <a href={`tel:${b.phone}`} className="inline-flex items-center gap-1.5 font-mono text-primary hover:underline">
                    <PhoneIcon className="size-3.5" />
                    {formatPhone(b.phone)}
                  </a>
                ) : (
                  '—'
                )}
              </Detail>
              <Detail label="Email">
                {b?.email ? (
                  <a href={`mailto:${b.email}`} className="inline-flex items-center gap-1.5 break-all text-primary hover:underline">
                    <MailIcon className="size-3.5 shrink-0" />
                    {b.email}
                  </a>
                ) : (
                  '—'
                )}
              </Detail>
            </dl>
          </Card>

          <WebFormsCard loan={loan} />

          <Card title="Other loans for this person">
            <OtherLoans loan={loan} />
          </Card>
        </div>

        <div className="order-first space-y-4 lg:order-none">
          {/* Readiness matters until the file is pre-approved. */}
          {['lead', 'contacted', 'pre_qualified', 'nurture'].includes(loan.stage) && <ReadinessCard loan={loan} view={readinessResult} compact />}
          <TasksCard loanId={loan.id} organizationId={loan.organizationId} />
          <Card title="At a glance">
            <dl className="space-y-3">
              <Detail label="Last contact">
                {contact ? (
                  <button type="button" onClick={() => onGoToTab('notes')} className="text-left hover:underline">
                    {noteKindLabel(contact.kind)} · {relativeTime(contact.createdAt)}
                    {contact.author && <span className="text-muted-foreground"> · {contact.author.name}</span>}
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{contact.body}</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => onGoToTab('notes')} className="text-muted-foreground hover:underline">
                    None logged. Log a call or text in Notes.
                  </button>
                )}
              </Detail>
              <Detail label="Assigned LO">{loan.assignedLo?.name ?? 'Unassigned'}</Detail>
              <Detail label="Referral source">{loan.referralSource ?? '—'}</Detail>
              <Detail label="Subject property">
                {subject ? (
                  <button type="button" onClick={() => onGoToTab('properties')} className="text-left hover:underline">
                    {subject.addressLine}
                    {subject.city && `, ${subject.city}`}
                  </button>
                ) : (
                  '—'
                )}
              </Detail>
              <Detail label="Created">{formatIsoDate(loan.createdAt.slice(0, 10))}</Detail>
            </dl>
          </Card>
        </div>
      </div>

      <SummaryBar
        items={items}
        action={
          <div className="flex items-center gap-2">
            {dirty && (
              <Button variant="ghost" onClick={() => (setForm(saved), setHome({}))}>
                Discard
              </Button>
            )}
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </Button>
          </div>
        }
      />
    </>
  )
}
