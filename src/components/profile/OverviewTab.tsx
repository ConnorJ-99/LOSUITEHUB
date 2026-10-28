import type * as React from 'react'
import { useState } from 'react'
import { Link } from 'react-router'
import { HomeIcon, MailIcon, PhoneIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CurrencyInput, DateInput, FormGrid, Input, PercentInput, Select, SummaryBar, type SummaryItem } from '@/components/shared'
import { StageBadge } from '@/components/pipeline/StageBadge'
import { lastContact, useNotes } from '@/lib/api/notes'
import { useContactLoans, useUpdateLoanDetails } from '@/lib/api/loans'
import { useProperties } from '@/lib/api/properties'
import type { LoanDetails, LoanProfile, Property } from '@/lib/api/types'
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

const FROM_PROPERTY = 'From the subject property'

/** The details this form edits. The subject property is chosen on the Properties tab. */
type EditableDetails = Omit<LoanDetails, 'subjectPropertyId'>

function editable({ subjectPropertyId, ...rest }: LoanDetails): EditableDetails {
  void subjectPropertyId
  return rest
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

  const subject: Property | null = properties.data?.find((p) => p.id === loan.details.subjectPropertyId) ?? null
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
  const dirty = Object.keys(changes).length > 0

  const save = () =>
    updateDetails.mutate(changes, {
      onSuccess: () => toast.success('Loan details saved'),
      onError: (error) => toast.error(`Could not save: ${error.message}`),
    })

  const purpose = loan.purpose
  const isRefi = purpose === 'refinance_rate_term' || purpose === 'refinance_cash_out'
  const isSecond = purpose === 'heloc' || purpose === 'heloan'
  const firstLien = subject?.liens.find((l) => l.position === 'first') ?? null
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
                  <CurrencyInput label="Home value" value={result.value} readOnly hint={FROM_PROPERTY} span={2} />
                  <CurrencyInput label="Current 1st lien" value={firstLien?.balance ?? null} readOnly hint={FROM_PROPERTY} span={2} />
                  <CurrencyInput label="Current P&I" value={firstLien?.monthlyPayment ?? null} readOnly hint={FROM_PROPERTY} span={2} />
                  <CurrencyInput label="New loan amount" value={form.loanAmount} onChange={set('loanAmount')} required span={2} />
                  {purpose === 'refinance_cash_out' && (
                    <CurrencyInput label="Cash-out amount" value={form.cashOutAmount} onChange={set('cashOutAmount')} span={2} />
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
                  <CurrencyInput label="Home value" value={result.value} readOnly hint={FROM_PROPERTY} span={2} />
                  <CurrencyInput
                    label="1st lien balance"
                    value={result.firstLienBalance}
                    readOnly
                    required
                    span={2}
                    hint={FROM_PROPERTY}
                    error={subject && result.firstLienBalance === null ? 'Required: add the 1st lien on the Properties tab' : undefined}
                  />
                  <CurrencyInput
                    label={purpose === 'heloc' ? 'HELOC line amount' : 'HELOAN amount'}
                    value={form.loanAmount}
                    onChange={set('loanAmount')}
                    required
                    span={2}
                  />
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
              <Button variant="ghost" onClick={() => setForm(saved)}>
                Discard
              </Button>
            )}
            <Button onClick={save} disabled={!dirty || updateDetails.isPending}>
              {updateDetails.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </Button>
          </div>
        }
      />
    </>
  )
}
