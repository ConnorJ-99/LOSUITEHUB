import { useState } from 'react'
import { toast } from 'sonner'
import { CurrencyInput, DateInput, FormGrid, Input, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useDeleteRow, useSaveRow, type ApplicationBorrower, type Employment, type OtherIncome } from '@/lib/api/urla'
import { employmentMonthlyIncome } from '@/lib/calc'
import { formatIsoDate, joinMonths, splitMonths } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { labelFor, OTHER_INCOME_OPTIONS, type EmploymentStatus, type OtherIncomeType } from '@/lib/urla/options'
import { AddButton, EditDialog, ListRow, SectionCard, SubHeading } from './parts'

const STATUS_OPTIONS = [
  { value: 'current', label: 'Current job' },
  { value: 'previous', label: 'Previous job' },
] as const

type EmploymentForm = Omit<Employment, 'id' | 'contactId'> & { lineYears: string; lineMonths: string }

function blankEmployment(status: EmploymentStatus, sortOrder: number): EmploymentForm {
  return {
    status, sortOrder, employerName: '', employerPhone: null, addressLine: null, unit: null, city: null, state: 'TX', zip: null,
    positionTitle: null, startDate: null, endDate: null, monthsInLineOfWork: null, employedByParty: false, isSelfEmployed: false,
    ownership25OrMore: null, baseIncome: null, overtimeIncome: null, bonusIncome: null, commissionIncome: null,
    militaryEntitlements: null, otherEmploymentIncome: null, selfEmployedIncome: null, lineYears: '', lineMonths: '',
  }
}

function EmploymentDialog({
  loanId, organizationId, contactId, employment, defaultStatus, nextSortOrder, onClose,
}: {
  loanId: string
  organizationId: string
  contactId: string
  employment: Employment | null
  defaultStatus: EmploymentStatus
  nextSortOrder: number
  onClose: () => void
}) {
  const save = useSaveRow(loanId, organizationId, 'employments')
  const [form, setForm] = useState<EmploymentForm>(() => {
    if (!employment) return blankEmployment(defaultStatus, nextSortOrder)
    const { years, months } = splitMonths(employment.monthsInLineOfWork)
    return { ...employment, lineYears: years, lineMonths: months }
  })
  const set = <K extends keyof EmploymentForm>(key: K) => (value: EmploymentForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const text = (key: keyof EmploymentForm) => (v: string) => set(key)((v || null) as never)
  const isPrevious = form.status === 'previous'

  const submit = () => {
    if (!form.employerName.trim()) return toast.error('Employer or business name is required')
    const { lineYears, lineMonths, ...rest } = form
    save.mutate(
      {
        ...rest,
        id: employment?.id,
        contactId,
        state: rest.state ? rest.state.toUpperCase() : null,
        monthsInLineOfWork: joinMonths(lineYears, lineMonths),
        ownership25OrMore: rest.isSelfEmployed ? rest.ownership25OrMore : null,
        selfEmployedIncome: rest.isSelfEmployed ? rest.selfEmployedIncome : null,
        endDate: isPrevious ? rest.endDate : null,
      },
      { onSuccess: onClose, onError: (e) => toast.error(`Could not save job: ${e.message}`) },
    )
  }

  return (
    <EditDialog wide title={employment ? 'Edit employment' : 'Add employment'} open onOpenChange={(o) => !o && onClose()} onSubmit={submit} saving={save.isPending}>
      <FormGrid>
        <Select label="Status" value={form.status} onChange={set('status')} options={STATUS_OPTIONS} required span={2} />
        <Input label="Employer or business name" value={form.employerName} onChange={(v) => set('employerName')(v)} required span={4} />
        <Input label="Position or title" value={form.positionTitle ?? ''} onChange={text('positionTitle')} span={2} />
        <Input label="Employer phone" type="tel" value={form.employerPhone ?? ''} onChange={text('employerPhone')} span={2} />
        <DateInput label="Start date" value={form.startDate} onChange={set('startDate')} />
        {isPrevious ? <DateInput label="End date" value={form.endDate} onChange={set('endDate')} /> : <div className="hidden lg:block" />}
        <Input label="Street address" value={form.addressLine ?? ''} onChange={text('addressLine')} span={3} />
        <Input label="City" value={form.city ?? ''} onChange={text('city')} />
        <Input label="State" value={form.state ?? ''} onChange={(v) => set('state')(v.toUpperCase().slice(0, 2) || null)} />
        <Input label="ZIP" value={form.zip ?? ''} onChange={text('zip')} inputMode="numeric" />
        {!isPrevious && (
          <>
            <Input label="Years in this line of work" inputMode="numeric" value={form.lineYears} onChange={set('lineYears')} span={2} />
            <Input label="Months" inputMode="numeric" value={form.lineMonths} onChange={set('lineMonths')} />
          </>
        )}
      </FormGrid>

      <ToggleChipGroup>
        <ToggleChip label="Self-employed / business owner" pressed={form.isSelfEmployed} onChange={set('isSelfEmployed')} />
        <ToggleChip label="Employed by family member or party to the transaction" pressed={form.employedByParty} onChange={set('employedByParty')} />
        {form.isSelfEmployed && (
          <>
            <ToggleChip label="Ownership under 25%" pressed={form.ownership25OrMore === false} onChange={(p) => set('ownership25OrMore')(p ? false : null)} />
            <ToggleChip label="Ownership 25% or more" pressed={form.ownership25OrMore === true} onChange={(p) => set('ownership25OrMore')(p ? true : null)} />
          </>
        )}
      </ToggleChipGroup>

      <SubHeading>Gross monthly income</SubHeading>
      <FormGrid>
        {isPrevious ? (
          <CurrencyInput label="Previous gross monthly income" value={form.baseIncome} onChange={set('baseIncome')} span={2} />
        ) : form.isSelfEmployed ? (
          <CurrencyInput label="Monthly income (or loss)" value={form.selfEmployedIncome} onChange={set('selfEmployedIncome')} hint="Use a minus sign for a loss" span={2} />
        ) : (
          <>
            <CurrencyInput label="Base" value={form.baseIncome} onChange={set('baseIncome')} span={2} />
            <CurrencyInput label="Overtime" value={form.overtimeIncome} onChange={set('overtimeIncome')} span={2} />
            <CurrencyInput label="Bonus" value={form.bonusIncome} onChange={set('bonusIncome')} span={2} />
            <CurrencyInput label="Commission" value={form.commissionIncome} onChange={set('commissionIncome')} span={2} />
            <CurrencyInput label="Military entitlements" value={form.militaryEntitlements} onChange={set('militaryEntitlements')} span={2} />
            <CurrencyInput label="Other" value={form.otherEmploymentIncome} onChange={set('otherEmploymentIncome')} span={2} />
          </>
        )}
        {!isPrevious && (
          <CurrencyInput label="Total monthly" value={employmentMonthlyIncome(form)} readOnly hint="Calculated" span={2} />
        )}
      </FormGrid>
    </EditDialog>
  )
}

/** Sections 1b–1d: current, additional and previous employment. */
export function EmploymentSection({ loanId, organizationId, borrower }: { loanId: string; organizationId: string; borrower: ApplicationBorrower }) {
  const remove = useDeleteRow(loanId, 'employments')
  const [editing, setEditing] = useState<{ employment: Employment | null; status: EmploymentStatus } | null>(null)
  const current = borrower.employments.filter((e) => e.status === 'current')
  const previous = borrower.employments.filter((e) => e.status === 'previous')

  const row = (e: Employment, label: string) => (
    <ListRow
      key={e.id}
      title={
        <>
          <span className="mr-2 text-xs font-semibold text-muted-foreground uppercase">{label}</span>
          {e.employerName}
        </>
      }
      detail={[
        e.positionTitle,
        e.isSelfEmployed && 'Self-employed',
        e.startDate && `since ${formatIsoDate(e.startDate)}`,
        e.endDate && `until ${formatIsoDate(e.endDate)}`,
      ].filter(Boolean).join(' · ')}
      amount={e.status === 'current' ? `${formatCurrency(employmentMonthlyIncome(e))}/mo` : e.baseIncome ? `${formatCurrency(e.baseIncome)}/mo` : undefined}
      onEdit={() => setEditing({ employment: e, status: e.status })}
      onDelete={() => remove.mutate(e.id, { onError: (err) => toast.error(err.message) })}
    />
  )

  return (
    <SectionCard
      id="section-1-employment"
      title="1b–1d. Employment"
      description="Current job first. Add previous jobs to cover 2 years."
      action={<AddButton label="Add job" onClick={() => setEditing({ employment: null, status: current.length ? 'previous' : 'current' })} />}
    >
      {borrower.employments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No employment yet.</p>
      ) : (
        <ul className="divide-y">
          {current.map((e, i) => row(e, i === 0 ? 'Current' : 'Additional'))}
          {previous.map((e) => row(e, 'Previous'))}
        </ul>
      )}
      {editing && (
        <EmploymentDialog
          loanId={loanId}
          organizationId={organizationId}
          contactId={borrower.contactId}
          employment={editing.employment}
          defaultStatus={editing.status}
          nextSortOrder={borrower.employments.length}
          onClose={() => setEditing(null)}
        />
      )}
    </SectionCard>
  )
}

function OtherIncomeDialog({ loanId, organizationId, contactId, income, onClose }: { loanId: string; organizationId: string; contactId: string; income: OtherIncome | null; onClose: () => void }) {
  const save = useSaveRow(loanId, organizationId, 'other_incomes')
  const [incomeType, setIncomeType] = useState<OtherIncomeType | null>(income?.incomeType ?? null)
  const [description, setDescription] = useState(income?.description ?? '')
  const [amount, setAmount] = useState<number | null>(income?.monthlyAmount ?? null)

  const submit = () => {
    if (!incomeType || amount === null) return toast.error('Choose a type and enter the monthly amount')
    save.mutate(
      { id: income?.id, contactId, incomeType, description, monthlyAmount: amount },
      { onSuccess: onClose, onError: (e) => toast.error(`Could not save income: ${e.message}`) },
    )
  }

  return (
    <EditDialog title={income ? 'Edit other income' : 'Add other income'} open onOpenChange={(o) => !o && onClose()} onSubmit={submit} saving={save.isPending}>
      <FormGrid className="lg:grid-cols-4">
        <Select label="Income type" value={incomeType} onChange={setIncomeType} options={OTHER_INCOME_OPTIONS} required span={2} />
        <CurrencyInput label="Monthly amount" value={amount} onChange={setAmount} required span={2} />
        <Input label="Description" value={description} onChange={setDescription} span={4} />
      </FormGrid>
    </EditDialog>
  )
}

/** Section 1e: income from other sources. */
export function OtherIncomeSection({ loanId, organizationId, borrower }: { loanId: string; organizationId: string; borrower: ApplicationBorrower }) {
  const remove = useDeleteRow(loanId, 'other_incomes')
  const [editing, setEditing] = useState<{ income: OtherIncome | null } | null>(null)
  return (
    <SectionCard id="section-1-other-income" title="1e. Income from other sources" action={<AddButton label="Add income" onClick={() => setEditing({ income: null })} />}>
      {borrower.otherIncomes.length === 0 ? (
        <p className="text-sm text-muted-foreground">None (Social Security, pension, alimony, child support and so on).</p>
      ) : (
        <ul className="divide-y">
          {borrower.otherIncomes.map((i) => (
            <ListRow
              key={i.id}
              title={labelFor(OTHER_INCOME_OPTIONS, i.incomeType)}
              detail={i.description}
              amount={`${formatCurrency(i.monthlyAmount)}/mo`}
              onEdit={() => setEditing({ income: i })}
              onDelete={() => remove.mutate(i.id, { onError: (e) => toast.error(e.message) })}
            />
          ))}
        </ul>
      )}
      {editing && <OtherIncomeDialog loanId={loanId} organizationId={organizationId} contactId={borrower.contactId} income={editing.income} onClose={() => setEditing(null)} />}
    </SectionCard>
  )
}
