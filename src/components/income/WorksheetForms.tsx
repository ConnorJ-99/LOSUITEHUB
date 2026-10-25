import { useState } from 'react'
import { cn } from 'cn'
import { CurrencyInput, FormGrid, NumberInput, PercentInput, Select, ToggleChip, ToggleChipGroup, type FieldSpan } from '@/components/shared'
import { scheduleCCashFlow, sCorpCashFlow, partnershipCashFlow, type PartnershipYear, type SCorpYear, type ScheduleCYear } from '@/lib/calc'
import { formatCurrency } from '@/lib/format'
import type { InputsByKind, SalaryFrequency, VariableType, WorksheetData } from '@/lib/income/worksheets'
import { SubHeading } from '@/components/urla/parts'
import { CalcLines } from './CalcLines'

interface FieldDef<T> {
  key: keyof T & string
  label: string
  hint?: string
  type?: 'currency' | 'percent' | 'number'
  span?: FieldSpan
}

/** Renders a list of number fields for one object of inputs. */
function NumberFields<T extends object>({ fields, values, onChange, span = 2 }: { fields: FieldDef<T>[]; values: T; onChange: (next: T) => void; span?: FieldSpan }) {
  return (
    <>
      {fields.map((f) => {
        const props = {
          label: f.label,
          hint: f.hint,
          span: f.span ?? span,
          value: values[f.key] as number | null,
          onChange: (v: number | null) => onChange({ ...values, [f.key]: v }),
        }
        return f.type === 'percent' ? <PercentInput key={f.key} {...props} maxDecimals={2} /> : f.type === 'number' ? <NumberInput key={f.key} {...props} /> : <CurrencyInput key={f.key} {...props} />
      })}
    </>
  )
}

const FREQUENCIES: { value: SalaryFrequency; label: string }[] = [
  { value: 'annual', label: 'Annual salary' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'semi_monthly', label: 'Twice a month (24 checks)' },
  { value: 'biweekly', label: 'Every two weeks (26 checks)' },
  { value: 'weekly', label: 'Weekly' },
]

const SCHEDULE_C_FIELDS: FieldDef<ScheduleCYear>[] = [
  { key: 'netProfit', label: 'Net profit or loss (line 31)' },
  { key: 'nonrecurringIncome', label: 'Non-recurring other income (line 6)', hint: 'Subtracted' },
  { key: 'depletion', label: 'Depletion (line 12)' },
  { key: 'depreciation', label: 'Depreciation (line 13)' },
  { key: 'nonDeductibleMeals', label: 'Non-deductible meals (line 24b)', hint: 'Subtracted' },
  { key: 'businessUseOfHome', label: 'Business use of home (line 30)' },
  { key: 'amortizationCasualty', label: 'Amortization / casualty loss' },
  { key: 'mileageDepreciation', label: 'Mileage depreciation', hint: 'Business miles × IRS depreciation rate' },
]

const K1_FIELDS: FieldDef<SCorpYear>[] = [
  { key: 'k1OrdinaryIncome', label: 'K-1 ordinary income (box 1)' },
  { key: 'k1RentalIncome', label: 'K-1 rental income (boxes 2–3)' },
]

const BUSINESS_FIELDS: FieldDef<SCorpYear>[] = [
  { key: 'depreciation', label: 'Depreciation' },
  { key: 'depletion', label: 'Depletion' },
  { key: 'amortizationCasualty', label: 'Amortization / casualty loss' },
  { key: 'notesPayableUnder1Yr', label: 'Notes payable < 1 year (Sch. L)', hint: 'Subtracted' },
  { key: 'nonDeductibleTravelMeals', label: 'Non-deductible travel & meals (M-1)', hint: 'Subtracted' },
  { key: 'ownershipPct', label: 'Ownership', type: 'percent', hint: 'Applies to the business lines' },
]

const GUARANTEED: FieldDef<PartnershipYear>[] = [{ key: 'k1GuaranteedPayments', label: 'K-1 guaranteed payments (box 4)', hint: 'Counted at 100%' }]

const SCHEDULE_E_FIELDS: FieldDef<InputsByKind['rental']['scheduleE']>[] = [
  { key: 'rentsReceived', label: 'Rents received (line 3)' },
  { key: 'totalExpenses', label: 'Total expenses (line 20)', hint: 'Subtracted' },
  { key: 'depreciation', label: 'Depreciation (line 18)' },
  { key: 'insurance', label: 'Insurance (line 9)' },
  { key: 'mortgageInterest', label: 'Mortgage interest (line 12)' },
  { key: 'taxes', label: 'Taxes (line 16)' },
  { key: 'hoa', label: 'HOA dues', hint: 'If included in expenses' },
  { key: 'oneTimeExpense', label: 'One-time expense', hint: "Won't recur; added back" },
  { key: 'monthsInService', label: 'Months in service', type: 'number', hint: '12 unless bought or rented mid-year' },
]

type YearFlow = ReturnType<typeof scheduleCCashFlow>

/**
 * Two tax years side by side, one row per line of the return (like Fannie
 * Mae Form 1084). On phones the label sits above the two year boxes.
 */
function YearTable<Y extends object>({
  years,
  fields,
  values,
  onChange,
  flows,
}: {
  years: [number, number]
  fields: FieldDef<Y>[]
  values: [Y, Y]
  onChange: (index: 0 | 1, y: Y) => void
  flows: [YearFlow, YearFlow]
}) {
  const cols = 'grid grid-cols-2 gap-x-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-center'
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className={cn(cols, 'text-xs font-semibold text-muted-foreground')}>
        <span className="hidden sm:block">From the return</span>
        <span>{years[0]}</span>
        <span>{years[1]}</span>
      </div>
      {fields.map((f) => (
        <div key={f.key} className={cn(cols, 'gap-y-1 border-t pt-2')}>
          <p className="col-span-2 text-xs sm:col-span-1">
            {f.label}
            {f.hint && <span className="block text-muted-foreground">{f.hint}</span>}
          </p>
          {([0, 1] as const).map((i) => {
            const props = {
              label: `${f.label} (${years[i]})`,
              hideLabel: true,
              value: values[i][f.key] as number | null,
              onChange: (v: number | null) => onChange(i, { ...values[i], [f.key]: v }),
            }
            return f.type === 'percent' ? <PercentInput key={i} {...props} maxDecimals={2} /> : <CurrencyInput key={i} {...props} />
          })}
        </div>
      ))}
      <div className={cn(cols, 'border-t pt-2 text-sm font-semibold')}>
        <span className="col-span-2 sm:col-span-1">Cash flow</span>
        {flows.map((flow, i) => (
          <span key={i} className={cn('tabular-nums', flow.total < 0 && 'text-destructive')}>
            {formatCurrency(flow.total)}
          </span>
        ))}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Show each year's math</summary>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          {flows.map((flow, i) => (
            <div key={i} className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">{years[i]}</p>
              <CalcLines lines={flow.lines} />
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

/** The input fields for a worksheet, by kind. `onChange` gets the whole new inputs object. */
export function WorksheetInputs({ data, onChange }: { data: WorksheetData; onChange: (inputs: WorksheetData['inputs']) => void }) {
  // Read once per form, so the year labels stay put while typing.
  const [thisYear] = useState(() => new Date().getFullYear())
  switch (data.kind) {
    case 'salary': {
      const v = data.inputs
      return (
        <FormGrid>
          <Select label="Paid" value={v.frequency} options={FREQUENCIES} onChange={(frequency) => onChange({ ...v, frequency })} span={3} />
          <CurrencyInput label={v.frequency === 'annual' ? 'Annual salary' : 'Gross pay per check'} value={v.amount} onChange={(amount) => onChange({ ...v, amount })} span={3} hint="From the latest pay stub" />
        </FormGrid>
      )
    }
    case 'hourly': {
      const v = data.inputs
      return (
        <FormGrid>
          <CurrencyInput label="Hourly rate" value={v.rate} onChange={(rate) => onChange({ ...v, rate })} span={3} />
          <NumberInput label="Average hours per week" value={v.hoursPerWeek} onChange={(hoursPerWeek) => onChange({ ...v, hoursPerWeek })} suffix="hrs" span={3} />
        </FormGrid>
      )
    }
    case 'variable': {
      const v = data.inputs
      const types: { value: VariableType; label: string }[] = [
        { value: 'overtime', label: 'Overtime' },
        { value: 'bonus', label: 'Bonus' },
        { value: 'commission', label: 'Commission' },
      ]
      return (
        <div className="space-y-3">
          <ToggleChipGroup>
            {types.map((t) => (
              <ToggleChip key={t.value} label={t.label} pressed={v.incomeType === t.value} onChange={() => onChange({ ...v, incomeType: t.value })} />
            ))}
          </ToggleChipGroup>
          <FormGrid>
            <CurrencyInput label={`${thisYear} year to date`} value={v.ytdAmount} onChange={(ytdAmount) => onChange({ ...v, ytdAmount })} span={2} />
            <NumberInput label="Months covered by YTD" value={v.ytdMonths} onChange={(ytdMonths) => onChange({ ...v, ytdMonths })} hint="e.g. 9.5 for mid-October" span={2} />
            <CurrencyInput label={`${thisYear - 1} total`} value={v.priorYear1} onChange={(priorYear1) => onChange({ ...v, priorYear1 })} span={1} hint="W-2 or WVOE" />
            <CurrencyInput label={`${thisYear - 2} total`} value={v.priorYear2} onChange={(priorYear2) => onChange({ ...v, priorYear2 })} span={1} />
          </FormGrid>
        </div>
      )
    }
    case 'schedule_c':
    case 's_corp':
    case 'partnership': {
      const v = data.inputs
      const recent = v.recentYear ?? thisYear - 1
      const years = [thisYear, thisYear - 1, thisYear - 2].map((y) => ({ value: String(y), label: String(y) }))
      let fields: FieldDef<object>[]
      let flow: (y: object) => YearFlow
      if (data.kind === 'schedule_c') {
        fields = SCHEDULE_C_FIELDS as FieldDef<object>[]
        flow = (y) => scheduleCCashFlow(y as ScheduleCYear)
      } else if (data.kind === 's_corp') {
        fields = [...K1_FIELDS, ...BUSINESS_FIELDS] as FieldDef<object>[]
        flow = (y) => sCorpCashFlow(y as SCorpYear)
      } else {
        fields = [...K1_FIELDS, ...GUARANTEED, ...BUSINESS_FIELDS] as FieldDef<object>[]
        flow = (y) => partnershipCashFlow(y as PartnershipYear)
      }
      return (
        <div className="space-y-3">
          <FormGrid>
            <Select label="Most recent tax return" value={String(recent)} options={years} onChange={(y) => onChange({ ...v, recentYear: Number(y) })} span={2} />
          </FormGrid>
          {data.kind !== 'schedule_c' && (
            <p className="text-xs text-muted-foreground">K-1 lines come from the borrower's K-1. The business lines come from the company's return. W-2 wages the company pays the borrower go on a separate Salary worksheet.</p>
          )}
          <YearTable
            years={[recent - 1, recent]}
            fields={fields}
            values={[v.older, v.recent]}
            onChange={(i, y) => onChange({ ...v, [i === 0 ? 'older' : 'recent']: y } as typeof v)}
            flows={[flow(v.older), flow(v.recent)]}
          />
        </div>
      )
    }
    case 'bank_statement': {
      const v = data.inputs
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <ToggleChipGroup>
              {([12, 24] as const).map((m) => (
                <ToggleChip key={m} label={`${m} months`} pressed={v.months === m} onChange={() => onChange({ ...v, months: m })} />
              ))}
            </ToggleChipGroup>
            <ToggleChipGroup>
              {(['business', 'personal'] as const).map((t) => (
                <ToggleChip key={t} label={t === 'business' ? 'Business account' : 'Personal account'} pressed={v.accountType === t} onChange={() => onChange({ ...v, accountType: t })} />
              ))}
            </ToggleChipGroup>
          </div>
          <FormGrid>
            <CurrencyInput label="Total deposits" value={v.totalDeposits} onChange={(totalDeposits) => onChange({ ...v, totalDeposits })} span={2} />
            <CurrencyInput label="Excluded deposits" value={v.excludedDeposits} onChange={(excludedDeposits) => onChange({ ...v, excludedDeposits })} span={2} hint="Transfers, refunds, one-off deposits" />
            {v.accountType === 'business' && (
              <PercentInput label="Expense factor" value={v.expenseRatioPct} onChange={(expenseRatioPct) => onChange({ ...v, expenseRatioPct })} maxDecimals={2} span={1} />
            )}
            <PercentInput label="Ownership" value={v.ownershipPct} onChange={(ownershipPct) => onChange({ ...v, ownershipPct })} maxDecimals={2} span={1} />
          </FormGrid>
        </div>
      )
    }
    case 'rental': {
      const v = data.inputs
      return (
        <div className="space-y-3">
          <ToggleChipGroup>
            <ToggleChip label="Schedule E (tax return)" pressed={v.method === 'schedule_e'} onChange={() => onChange({ ...v, method: 'schedule_e' })} />
            <ToggleChip label="75% of lease" pressed={v.method === 'lease'} onChange={() => onChange({ ...v, method: 'lease' })} />
          </ToggleChipGroup>
          {v.method === 'lease' ? (
            <FormGrid>
              <CurrencyInput label="Monthly rent (lease)" value={v.leaseRent} onChange={(leaseRent) => onChange({ ...v, leaseRent })} span={3} hint="Pushing saves this as the property's monthly rent" />
            </FormGrid>
          ) : (
            <>
              <SubHeading>Schedule E, most recent year</SubHeading>
              <FormGrid>
                <NumberFields fields={SCHEDULE_E_FIELDS} values={v.scheduleE} onChange={(scheduleE) => onChange({ ...v, scheduleE })} />
              </FormGrid>
            </>
          )}
        </div>
      )
    }
  }
}
