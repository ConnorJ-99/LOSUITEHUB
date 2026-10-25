import type * as React from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CurrencyInput, FormGrid, Input, NumberInput, PercentInput, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { SubHeading } from '@/components/urla/parts'
import type { MortgageType, Property } from '@/lib/api/types'
import { formatCurrency, formatPercent } from '@/lib/format'
import { changeLoanType, type PrequalLoan, type PrequalSummary, type QuickAsset, type QuickBorrower, type QuickDebt } from '@/lib/prequal/draft'
import { ASSET_OPTIONS, LIABILITY_OPTIONS, OTHER_INCOME_OPTIONS, type AssetType, type LiabilityType } from '@/lib/urla/options'
import { DEFAULT_DTI_LABELS, LOAN_TYPES, newKey, TERMS } from './options'

/** A row of fields with a remove button, used for jobs, income, debts and savings. */
function Row({ children, onRemove, removeLabel }: { children: React.ReactNode; onRemove: () => void; removeLabel: string }) {
  return (
    <div className="flex items-end gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <FormGrid className="min-w-0 flex-1">{children}</FormGrid>
      <Button size="icon-sm" variant="ghost" aria-label={removeLabel} onClick={onRemove} className="mb-0.5 text-muted-foreground">
        <Trash2Icon />
      </Button>
    </div>
  )
}

/** Dropdown options limited to the common choices, plus the row's current value if it's something else. */
function choices<T extends string>(all: readonly { value: T; label: string }[], common: T[], current: T) {
  const values = common.includes(current) ? common : [...common, current]
  return values.map((v) => all.find((o) => o.value === v)!).filter(Boolean)
}

export function LoanSection({
  isPurchase,
  loan,
  onChange,
  summary,
  subject,
}: {
  isPurchase: boolean
  loan: PrequalLoan
  onChange: (next: PrequalLoan) => void
  summary: PrequalSummary
  subject: Property | null
}) {
  const set = <K extends keyof PrequalLoan>(key: K) => (value: PrequalLoan[K]) => onChange({ ...loan, [key]: value })
  const type = loan.mortgageType ?? 'conventional'
  const mi = summary.scenario.mi
  const hasUpfront = type === 'fha' || type === 'va' || type === 'usda_rural' || loan.upfrontFeePct !== null
  return (
    <Card title="The loan" description={isPurchase ? 'What they want to buy and how' : 'Home value and current mortgage come from the Overview and Properties tabs'}>
      <div className="space-y-4">
        <ToggleChipGroup>
          {LOAN_TYPES.map((t) => (
            <ToggleChip key={t.value} label={t.label} pressed={type === t.value} onChange={() => onChange(changeLoanType(loan, t.value as MortgageType))} />
          ))}
        </ToggleChipGroup>
        <FormGrid>
          {isPurchase ? (
            <>
              <CurrencyInput label="Purchase price" value={loan.purchasePrice} onChange={set('purchasePrice')} span={2} />
              <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    {loan.downPaymentMode === 'percent' ? (
                      <PercentInput label="Down payment" value={loan.downPaymentPct} onChange={set('downPaymentPct')} maxDecimals={2} />
                    ) : (
                      <CurrencyInput label="Down payment" value={loan.downPaymentAmount} onChange={set('downPaymentAmount')} />
                    )}
                  </div>
                  <ToggleChipGroup className="mb-1 flex-nowrap">
                    <ToggleChip label="%" pressed={loan.downPaymentMode === 'percent'} onChange={() => onChange({ ...loan, downPaymentMode: 'percent', downPaymentPct: summary.scenario.downPayment?.percent ?? loan.downPaymentPct })} />
                    <ToggleChip label="$" pressed={loan.downPaymentMode === 'amount'} onChange={() => onChange({ ...loan, downPaymentMode: 'amount', downPaymentAmount: summary.scenario.downPayment?.amount ?? loan.downPaymentAmount })} />
                  </ToggleChipGroup>
                </div>
              </div>
              <CurrencyInput label="Loan amount" value={summary.loanAmount} readOnly span={1} hint={summary.scenario.ltv !== null ? `${formatPercent(summary.scenario.ltv, 2)} LTV` : undefined} />
            </>
          ) : (
            <CurrencyInput label="Loan amount" value={loan.loanAmount} onChange={set('loanAmount')} span={2} hint={summary.scenario.ltv !== null ? `${formatPercent(summary.scenario.ltv, 2)} LTV` : undefined} />
          )}
          <PercentInput label="Interest rate" value={loan.noteRate} onChange={set('noteRate')} span={1} />
        </FormGrid>
        <ToggleChipGroup>
          {TERMS.map((t) => (
            <ToggleChip key={t.months} label={t.label} pressed={loan.termMonths === t.months} onChange={() => onChange({ ...loan, termMonths: t.months })} />
          ))}
        </ToggleChipGroup>

        <SubHeading>Taxes, insurance and HOA</SubHeading>
        <FormGrid>
          {subject?.annualTaxes != null ? (
            <CurrencyInput label="Taxes / year" value={subject.annualTaxes} readOnly hint="From the subject property" span={2} />
          ) : (
            <PercentInput label="Property tax rate" value={loan.estimatedTaxRatePct} onChange={set('estimatedTaxRatePct')} maxDecimals={3} hint="DFW is about 2.2% of price" span={2} />
          )}
          {subject?.annualInsurance != null ? (
            <CurrencyInput label="Insurance / year" value={subject.annualInsurance} readOnly hint="From the subject property" span={2} />
          ) : (
            <CurrencyInput label="Insurance / year" value={loan.estimatedAnnualInsurance} onChange={set('estimatedAnnualInsurance')} span={2} hint="Estimate" />
          )}
          {subject?.monthlyHoa != null ? (
            <CurrencyInput label="HOA / month" value={subject.monthlyHoa} readOnly hint="From the subject property" span={2} />
          ) : (
            <CurrencyInput label="HOA / month" value={loan.estimatedMonthlyHoa} onChange={set('estimatedMonthlyHoa')} span={2} />
          )}
        </FormGrid>

        <SubHeading>Mortgage insurance and limits</SubHeading>
        <FormGrid>
          <PercentInput
            label="MI rate / year"
            value={loan.miRatePct}
            onChange={set('miRatePct')}
            maxDecimals={3}
            placeholder={mi ? String(mi.annualRatePct) : undefined}
            hint={loan.miRatePct === null ? `Default ${formatPercent(mi?.annualRatePct ?? 0)} for this loan` : 'Clear to use the default'}
            span={2}
          />
          {hasUpfront && (
            <PercentInput
              label={type === 'va' ? 'VA funding fee' : 'Upfront fee (financed)'}
              value={loan.upfrontFeePct}
              onChange={set('upfrontFeePct')}
              maxDecimals={3}
              placeholder={mi ? String(mi.upfrontFeePct) : undefined}
              hint={loan.upfrontFeePct === null ? `Default ${formatPercent(mi?.upfrontFeePct ?? 0)}` : 'Clear to use the default'}
              span={2}
            />
          )}
          <PercentInput label="Max DTI" value={loan.maxDtiPct} onChange={(v) => onChange({ ...loan, maxDtiPct: v ?? 0 })} maxDecimals={2} hint={DEFAULT_DTI_LABELS} span={2} />
        </FormGrid>
        {type === 'va' && (
          <ToggleChip label="Exempt from the funding fee (disability)" pressed={loan.upfrontFeePct === 0} onChange={(on) => onChange({ ...loan, upfrontFeePct: on ? 0 : null })} />
        )}
      </div>
    </Card>
  )
}

export function BorrowerSection({ borrower, onChange }: { borrower: QuickBorrower; onChange: (next: QuickBorrower) => void }) {
  const setJob = (key: string, changes: Partial<QuickBorrower['jobs'][number]>) =>
    onChange({ ...borrower, jobs: borrower.jobs.map((j) => (j.key === key ? { ...j, ...changes } : j)) })
  const setOther = (key: string, changes: Partial<QuickBorrower['otherIncomes'][number]>) =>
    onChange({ ...borrower, otherIncomes: borrower.otherIncomes.map((i) => (i.key === key ? { ...i, ...changes } : i)) })
  const addJob = (selfEmployed: boolean) =>
    onChange({ ...borrower, jobs: [...borrower.jobs, { key: newKey(), id: null, employerName: '', selfEmployed, monthly: null, otherPay: 0 }] })
  return (
    <Card title={`${borrower.firstName || 'Borrower'}${borrower.role === 'co_borrower' ? ' (co-borrower)' : ''}`} description="Monthly gross income. Hourly, overtime or tax-return income: use the Income tab worksheets.">
      <div className="space-y-4">
        <FormGrid>
          <NumberInput label="Credit score (estimate)" value={borrower.creditScore} onChange={(creditScore) => onChange({ ...borrower, creditScore })} maxDecimals={0} span={2} />
        </FormGrid>

        <SubHeading>Jobs</SubHeading>
        {borrower.jobs.length === 0 && <p className="text-sm text-muted-foreground">No current job yet.</p>}
        <div className="space-y-3">
          {borrower.jobs.map((j) => (
            <Row key={j.key} removeLabel={`Remove ${j.employerName || 'job'}`} onRemove={() => onChange({ ...borrower, jobs: borrower.jobs.filter((x) => x.key !== j.key) })}>
              <Input label={j.selfEmployed ? 'Business name' : 'Employer'} value={j.employerName} onChange={(employerName) => setJob(j.key, { employerName })} span={3} />
              <CurrencyInput
                label={j.selfEmployed ? 'Self-employed / mo' : 'Base pay / mo'}
                value={j.monthly}
                onChange={(monthly) => setJob(j.key, { monthly })}
                hint={j.otherPay ? `Plus ${formatCurrency(j.otherPay)} other pay on the 1003` : undefined}
                span={3}
              />
            </Row>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => addJob(false)}>
            <PlusIcon />
            Job
          </Button>
          <Button size="sm" variant="outline" onClick={() => addJob(true)}>
            <PlusIcon />
            Self-employed
          </Button>
          <Button size="sm" variant="outline" onClick={() => onChange({ ...borrower, otherIncomes: [...borrower.otherIncomes, { key: newKey(), id: null, incomeType: 'social_security', monthly: null }] })}>
            <PlusIcon />
            Other income
          </Button>
        </div>

        {borrower.otherIncomes.length > 0 && (
          <>
            <SubHeading>Other income</SubHeading>
            <div className="space-y-3">
              {borrower.otherIncomes.map((i) => (
                <Row key={i.key} removeLabel="Remove this income" onRemove={() => onChange({ ...borrower, otherIncomes: borrower.otherIncomes.filter((x) => x.key !== i.key) })}>
                  <Select label="Type" value={i.incomeType} options={OTHER_INCOME_OPTIONS} onChange={(incomeType) => setOther(i.key, { incomeType })} span={3} />
                  <CurrencyInput label="Monthly" value={i.monthly} onChange={(monthly) => setOther(i.key, { monthly })} span={3} />
                </Row>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

const DEBT_PRESETS: { label: string; type: LiabilityType; name: string }[] = [
  { label: 'Car', type: 'installment', name: 'Car loan' },
  { label: 'Student loan', type: 'installment', name: 'Student loan' },
  { label: 'Credit cards', type: 'revolving', name: 'Credit cards' },
  { label: 'Personal loan', type: 'installment', name: 'Personal loan' },
  { label: 'Child support', type: 'child_support', name: '' },
  { label: 'Other', type: 'other', name: '' },
]
const COMMON_DEBTS: LiabilityType[] = ['revolving', 'installment', 'lease', 'child_support', 'alimony', 'other']

export function DebtsSection({ debts, borrowers, onChange }: { debts: QuickDebt[]; borrowers: QuickBorrower[]; onChange: (next: QuickDebt[]) => void }) {
  const set = (key: string, changes: Partial<QuickDebt>) => onChange(debts.map((d) => (d.key === key ? { ...d, ...changes } : d)))
  const owners = borrowers.map((b) => ({ value: b.contactId, label: b.firstName || 'Borrower' }))
  return (
    <Card title="Monthly debts" description="Minimum payments from their credit. Debts being paid off at closing don't count.">
      <div className="space-y-4">
        {debts.length === 0 && <p className="text-sm text-muted-foreground">No debts entered.</p>}
        <div className="space-y-3">
          {debts.map((d) => (
            <Row key={d.key} removeLabel={`Remove ${d.creditorName || 'debt'}`} onRemove={() => onChange(debts.filter((x) => x.key !== d.key))}>
              <Select label="Type" value={d.liabilityType} options={choices(LIABILITY_OPTIONS, COMMON_DEBTS, d.liabilityType)} onChange={(liabilityType) => set(d.key, { liabilityType })} span={2} />
              <Input label="Creditor" value={d.creditorName} onChange={(creditorName) => set(d.key, { creditorName })} span={owners.length > 1 ? 1 : 2} />
              {owners.length > 1 && <Select label="Whose" value={d.contactId} options={owners} onChange={(contactId) => set(d.key, { contactId })} span={1} />}
              <CurrencyInput label="Payment / mo" value={d.monthlyPayment} onChange={(monthlyPayment) => set(d.key, { monthlyPayment })} hint={d.toBePaidOff ? 'Paid off at closing (not counted)' : undefined} span={2} />
            </Row>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {DEBT_PRESETS.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant="outline"
              onClick={() => onChange([...debts, { key: newKey(), id: null, contactId: borrowers[0].contactId, liabilityType: p.type, creditorName: p.name, monthlyPayment: null, toBePaidOff: false }])}
            >
              <PlusIcon />
              {p.label}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  )
}

const COMMON_ASSETS: AssetType[] = ['checking', 'savings', 'money_market', 'retirement', 'gift_cash', 'other_liquid']

export function SavingsSection({ assets, borrowers, onChange }: { assets: QuickAsset[]; borrowers: QuickBorrower[]; onChange: (next: QuickAsset[]) => void }) {
  const set = (key: string, changes: Partial<QuickAsset>) => onChange(assets.map((a) => (a.key === key ? { ...a, ...changes } : a)))
  const owners = borrowers.map((b) => ({ value: b.contactId, label: b.firstName || 'Borrower' }))
  return (
    <Card title="Savings for closing" description="Money available for the down payment and closing costs.">
      <div className="space-y-4">
        {assets.length === 0 && <p className="text-sm text-muted-foreground">Nothing entered yet.</p>}
        <div className="space-y-3">
          {assets.map((a) => (
            <Row key={a.key} removeLabel="Remove this account" onRemove={() => onChange(assets.filter((x) => x.key !== a.key))}>
              <Select label="Type" value={a.assetType} options={choices(ASSET_OPTIONS, COMMON_ASSETS, a.assetType)} onChange={(assetType) => set(a.key, { assetType })} span={2} />
              <Input label="Bank" value={a.institutionName} onChange={(institutionName) => set(a.key, { institutionName })} span={owners.length > 1 ? 1 : 2} />
              {owners.length > 1 && <Select label="Whose" value={a.contactId} options={owners} onChange={(contactId) => set(a.key, { contactId })} span={1} />}
              <CurrencyInput label="Amount" value={a.amount} onChange={(amount) => set(a.key, { amount })} span={2} />
            </Row>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => onChange([...assets, { key: newKey(), id: null, contactId: borrowers[0].contactId, assetType: 'checking', institutionName: '', amount: null }])}>
          <PlusIcon />
          Account
        </Button>
      </div>
    </Card>
  )
}
