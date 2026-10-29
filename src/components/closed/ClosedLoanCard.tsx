import { useState } from 'react'
import { CalendarPlusIcon, CheckIcon, UserPlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CurrencyInput, DateInput, FormGrid, Input, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { MORTGAGE_TYPE_OPTIONS, OCCUPANCY_OPTIONS } from '@/components/profile/options'
import { useAddFollowUp, useClosedLoan, useSaveClosedFacts, type ClosedLoan } from '@/lib/api/closed'
import { CopyToLeadDialog } from './CopyToLeadDialog'
import { MortgageCard } from './MortgageCard'
import { useLoanTasks } from '@/lib/api/tasks'
import type { LoanProfile } from '@/lib/api/types'
import { keyDates } from '@/lib/closed/keyDates'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { formatCurrency, formatPercent } from '@/lib/format'
import { formatPhone, fullName } from '@/lib/pipeline/helpers'
import { purposeLabel } from '@/lib/pipeline/stages'

const labelOf = <T extends string>(list: readonly { value: T; label: string }[], v: T | null) => list.find((o) => o.value === v)?.label ?? null

/**
 * The closed loan profile, a closed file's Overview: the loan, the home and
 * how to reach the client, the mortgage today with an assumed amortization,
 * the key dates to follow up on, and "Copy to a new lead" for their next loan
 * (linked to this one).
 */
export function ClosedLoanCard({ loan }: { loan: LoanProfile }) {
  const closed = useClosedLoan(loan.id)
  if (!closed.data) return closed.isError ? <p className="text-sm text-destructive">{closed.error.message}</p> : <p className="text-sm text-muted-foreground">Loading…</p>
  return (
    <>
      <ClosedLoanDetails key={JSON.stringify(closed.data)} loan={loan} closed={closed.data} />
      <MortgageCard closed={closed.data} />
    </>
  )
}

function ClosedLoanDetails({ loan, closed: c }: { loan: LoanProfile; closed: ClosedLoan }) {
  const save = useSaveClosedFacts(loan.id)
  const tasks = useLoanTasks(loan.id)
  const addFollowUp = useAddFollowUp(loan.id, loan.organizationId)
  const [copying, setCopying] = useState(false)
  const [form, setForm] = useState({
    lenderName: c.lenderName,
    programName: c.programName,
    monthlyPayment: c.monthlyPayment,
    insuranceCarrier: c.home?.insuranceCarrier ?? null,
    insuranceRenewalDate: c.home?.insuranceRenewalDate ?? null,
    homesteadFiled: c.home?.homesteadFiled ?? null,
    smsConsent: c.borrower?.smsConsent ?? null,
    emailConsent: c.borrower?.emailConsent ?? null,
  })
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))
  const dirty =
    form.lenderName !== c.lenderName || form.programName !== c.programName || form.monthlyPayment !== c.monthlyPayment ||
    form.insuranceCarrier !== (c.home?.insuranceCarrier ?? null) || form.insuranceRenewalDate !== (c.home?.insuranceRenewalDate ?? null) ||
    form.homesteadFiled !== (c.home?.homesteadFiled ?? null) || form.smsConsent !== (c.borrower?.smsConsent ?? null) || form.emailConsent !== (c.borrower?.emailConsent ?? null)

  const today = todayIso()
  const dates = keyDates(
    { closingDate: c.closingDate, firstPaymentDate: c.firstPaymentDate, birthday: c.borrower?.birthday ?? null, insuranceRenewalDate: form.insuranceRenewalDate, homesteadFiled: form.homesteadFiled, occupancy: c.occupancy },
    today,
    365,
    { holidays: true },
  )
  const added = new Set((tasks.data ?? []).map((t) => t.sourceKey).filter(Boolean))
  const name = c.borrower ? fullName(c.borrower) : 'the client'

  const submit = () =>
    save.mutate(
      {
        loan: { lenderName: form.lenderName?.trim() || null, programName: form.programName?.trim() || null, monthlyPayment: form.monthlyPayment },
        home: c.home ? { id: c.home.id, insuranceCarrier: form.insuranceCarrier, insuranceRenewalDate: form.insuranceRenewalDate, homesteadFiled: form.homesteadFiled } : null,
        person: c.borrower ? { id: c.borrower.id, smsConsent: form.smsConsent, emailConsent: form.emailConsent } : null,
      },
      { onSuccess: () => toast.success('Closed loan saved'), onError: (e) => toast.error(e.message) },
    )

  const fact = (label: string, value: string | null) => (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value || '—'}</dd>
    </div>
  )

  return (
    <Card
      title="Closed loan"
      description={c.closingDate ? `Closed ${formatIsoDate(c.closingDate)}` : 'No closing date yet'}
      action={
        <Button size="sm" variant="outline" disabled={!c.borrower} onClick={() => setCopying(true)}>
          <UserPlusIcon />
          Copy to a new lead
        </Button>
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          {fact('Loan', [labelOf(MORTGAGE_TYPE_OPTIONS, c.loanType), purposeLabel(c.purpose)].filter(Boolean).join(' · '))}
          {fact('Loan amount', c.loanAmount === null ? null : formatCurrency(c.loanAmount))}
          {fact('Rate · term', [c.rate === null ? null : formatPercent(c.rate), c.termMonths ? `${c.termMonths / 12} years` : null].filter(Boolean).join(' · '))}
          {fact('First payment', c.firstPaymentDate ? formatIsoDate(c.firstPaymentDate) : null)}
          {fact('Home', c.home ? [c.home.addressLine, c.home.city, c.home.state].filter(Boolean).join(', ') : null)}
          {fact('Occupancy', labelOf(OCCUPANCY_OPTIONS, c.occupancy))}
          {fact('Purchase price', c.purchasePrice === null ? null : formatCurrency(c.purchasePrice))}
          {fact('Estimated value', c.home?.estimatedValue == null ? null : formatCurrency(c.home.estimatedValue))}
          {fact('Phone', formatPhone(c.borrower?.phone))}
          {fact('Email', c.borrower?.email ?? null)}
          {fact('Birthday', c.borrower?.birthday ? formatIsoDate(c.borrower.birthday) : null)}
          {fact('Co-borrower', c.coBorrowers.map((p) => fullName(p)).join(', ') || null)}
        </dl>
        {c.program && c.program !== c.programName && <p className="text-xs text-muted-foreground">Program from Product Search: {c.lender} · {c.program}</p>}

        <FormGrid>
          <Input label="Lender" value={form.lenderName ?? ''} onChange={(v) => set('lenderName')(v || null)} span={2} />
          <Input label="Program" value={form.programName ?? ''} onChange={(v) => set('programName')(v || null)} span={2} />
          <CurrencyInput label="Monthly payment at closing" value={form.monthlyPayment} onChange={set('monthlyPayment')} hint="Principal, interest, taxes, insurance, MI" span={2} />
          {c.home ? (
            <>
              <Input label="Insurance carrier" value={form.insuranceCarrier ?? ''} onChange={(v) => set('insuranceCarrier')(v || null)} span={2} />
              <DateInput label="Insurance renewal date" value={form.insuranceRenewalDate} onChange={set('insuranceRenewalDate')} span={2} />
            </>
          ) : (
            <p className="col-span-full text-xs text-muted-foreground sm:col-span-4">Add the home on the Properties tab (and make it the subject property) to track insurance and homestead.</p>
          )}
        </FormGrid>
        <ToggleChipGroup>
          {c.home && <ToggleChip label="Homestead exemption filed" pressed={form.homesteadFiled === true} onChange={(on) => set('homesteadFiled')(on)} />}
          <ToggleChip label="OK to text" pressed={form.smsConsent === true} onChange={(on) => set('smsConsent')(on)} disabled={!c.borrower} />
          <ToggleChip label="OK to email" pressed={form.emailConsent === true} onChange={(on) => set('emailConsent')(on)} disabled={!c.borrower} />
        </ToggleChipGroup>
        {dirty && (
          <div className="flex justify-end">
            <Button size="sm" disabled={save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          </div>
        )}

        <div>
          <p className="eyebrow mb-2">Key dates · next 12 months</p>
          {dates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add the closing date, birthday or insurance renewal to see follow-up dates.</p>
          ) : (
            <ul className="divide-y text-sm">
              {dates.map((d) => (
                <li key={d.sourceKey} className="flex items-center gap-3 py-1.5">
                  <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{formatIsoDate(d.date)}</span>
                  <span className="flex-1">{d.label}</span>
                  {added.has(d.sourceKey) ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckIcon className="size-3.5" />Task added</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={addFollowUp.isPending}
                      onClick={() =>
                        addFollowUp.mutate(
                          { title: `${d.label}: follow up with ${name}`, dueOn: d.date, sourceKey: d.sourceKey },
                          { onSuccess: () => toast.success('Follow-up added to tasks'), onError: (e) => toast.error(e.message) },
                        )
                      }
                    >
                      <CalendarPlusIcon />
                      Add follow-up
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {copying && <CopyToLeadDialog closed={c} organizationId={loan.organizationId} onClose={() => setCopying(false)} />}
    </Card>
  )
}
