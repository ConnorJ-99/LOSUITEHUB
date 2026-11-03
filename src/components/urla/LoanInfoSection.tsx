import { Link } from 'react-router'
import { toast } from 'sonner'
import { CurrencyInput, FormGrid, Input, PercentInput, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { MORTGAGE_TYPE_OPTIONS, OCCUPANCY_OPTIONS, TERM_OPTIONS } from '@/components/profile/options'
import { useUpdateLoanDetails } from '@/lib/api/loans'
import type { LoanDetails, LoanProfile, Property } from '@/lib/api/types'
import type { Asset } from '@/lib/api/urla'
import { useEstimates } from '@/lib/api/estimates'
import { cashToClose, type ScenarioResult } from '@/lib/calc'
import { formatCurrency } from '@/lib/format'
import { purposeLabel } from '@/lib/pipeline/stages'
import { SectionCard, SubHeading } from './parts'
import { useDraft } from './useDraft'

const AMORTIZATION_OPTIONS = [
  { value: 'fixed', label: 'Fixed rate' },
  { value: 'arm', label: 'Adjustable rate (ARM)' },
] as const

const ESTATE_OPTIONS = [
  { value: 'fee_simple', label: 'Fee simple' },
  { value: 'leasehold', label: 'Leasehold' },
] as const

/** The loan-level fields this section edits. All of them live on the loan. Closing costs, prepaids, points and lender credits come from the estimate Selected for the file (Scenarios & Estimate). */
const FIELDS = [
  'loanAmount', 'purchasePrice', 'occupancy', 'mortgageType', 'amortizationType', 'termMonths', 'noteRate',
  'titleNames', 'titleManner', 'estateType', 'hasBalloon', 'hasInterestOnly', 'hasNegativeAmortization',
  'hasPrepaymentPenalty', 'improvementsAmount', 'sellerCredits',
] as const satisfies readonly (keyof LoanDetails)[]
type LoanInfoForm = Pick<LoanDetails, (typeof FIELDS)[number]>

const pick = (d: LoanDetails): LoanInfoForm => Object.fromEntries(FIELDS.map((k) => [k, d[k]])) as LoanInfoForm

/** Sections 4 (loan and property) and L (lender loan information). */
export function LoanInfoSection({
  loan,
  subject,
  scenario,
  assets,
}: {
  loan: LoanProfile
  subject: Property | null
  scenario: ScenarioResult
  assets: Asset[]
}) {
  const update = useUpdateLoanDetails(loan.id)
  const { form, set, changes, dirty, reset } = useDraft<LoanInfoForm>(pick(loan.details))
  const isPurchase = loan.purpose === 'purchase' || (loan.purpose === 'investment_dscr' && form.purchasePrice !== null)
  const termValue = form.termMonths ? (String(form.termMonths) as (typeof TERM_OPTIONS)[number]['value']) : null

  const earnestMoney = assets.filter((a) => a.assetType === 'earnest_money').reduce((s, a) => s + a.amount, 0)
  const d = loan.details
  const estimates = useEstimates(loan.id)
  const selected = estimates.data?.find((e) => e.id === d.pricingScenarioId) ?? null
  // The selected estimate's own cash to close; before one is selected, the loan's figures.
  const funds = selected?.figures
    ? { cashToClose: selected.figures.cashToClose, downPayment: selected.figures.downPayment }
    : isPurchase && form.purchasePrice !== null && form.loanAmount !== null
      ? cashToClose({
          isPurchase: true,
          purchasePrice: form.purchasePrice,
          baseLoanAmount: form.loanAmount,
          closingCosts: (d.estimatedClosingCosts ?? 0) + (d.discountPointsAmount ?? 0) + (d.prepaidItemsAmount ?? 0) + (form.improvementsAmount ?? 0),
          earnestMoney,
          sellerCredits: form.sellerCredits ?? 0,
          lenderCredit: d.lenderCredits ?? 0,
        })
      : null
  const fromEstimate = selected ? `From "${selected.name}"` : 'Select an estimate first'

  const save = () =>
    update.mutate(changes, {
      onSuccess: () => toast.success('Loan information saved'),
      onError: (e) => toast.error(`Could not save: ${e.message}`),
    })

  return (
    <SectionCard
      id="section-4"
      title="4 & L. Loan and property information"
      description={`${purposeLabel(loan.purpose)} · same values as the Overview tab`}
      dirty={dirty}
      saving={update.isPending}
      onSave={save}
      onDiscard={reset}
    >
      <FormGrid>
        <CurrencyInput label="Loan amount" value={form.loanAmount} onChange={set('loanAmount')} required span={2} />
        {isPurchase && <CurrencyInput label="Sales contract price" value={form.purchasePrice} onChange={set('purchasePrice')} required span={2} />}
        <CurrencyInput label="Property value" value={scenario.value} readOnly hint="From the subject property" span={2} />
        <Select label="Occupancy" value={form.occupancy} onChange={set('occupancy')} options={OCCUPANCY_OPTIONS} required span={2} />
        <Select label="Mortgage type" value={form.mortgageType} onChange={set('mortgageType')} options={MORTGAGE_TYPE_OPTIONS} span={2} />
        <Select label="Amortization" value={form.amortizationType} onChange={set('amortizationType')} options={AMORTIZATION_OPTIONS} span={2} />
        <Select label="Term" value={termValue} onChange={(v) => set('termMonths')(Number(v))} options={TERM_OPTIONS} />
        <PercentInput label="Note rate" value={form.noteRate} onChange={set('noteRate')} />
      </FormGrid>

      <div className="mt-3 rounded-lg border border-dashed px-3 py-2 text-sm">
        <span className="text-muted-foreground">Subject property: </span>
        {subject ? (
          <>
            {subject.addressLine}
            {subject.city && `, ${subject.city}`} {subject.state} {subject.zip} · {subject.unitCount ?? 1} unit{(subject.unitCount ?? 1) > 1 ? 's' : ''}
          </>
        ) : (
          <span>not chosen yet</span>
        )}{' '}
        <Link to={`/loans/${loan.id}?tab=properties`} className="text-primary hover:underline">
          {subject ? 'Edit on Properties' : 'Choose on Properties'}
        </Link>
      </div>

      <SubHeading>Title</SubHeading>
      <FormGrid>
        <Input label="Title will be held in what name(s)" value={form.titleNames ?? ''} onChange={(v) => set('titleNames')(v || null)} span={3} />
        <Input label="Manner in which title will be held" value={form.titleManner ?? ''} onChange={(v) => set('titleManner')(v || null)} placeholder="e.g. Joint tenants" span={2} />
        <Select label="Estate" value={form.estateType} onChange={set('estateType')} options={ESTATE_OPTIONS} />
      </FormGrid>

      <SubHeading>Loan features</SubHeading>
      <ToggleChipGroup>
        <ToggleChip label="Balloon" pressed={form.hasBalloon} onChange={set('hasBalloon')} />
        <ToggleChip label="Interest only" pressed={form.hasInterestOnly} onChange={set('hasInterestOnly')} />
        <ToggleChip label="Negative amortization" pressed={form.hasNegativeAmortization} onChange={set('hasNegativeAmortization')} />
        <ToggleChip label="Prepayment penalty" pressed={form.hasPrepaymentPenalty} onChange={set('hasPrepaymentPenalty')} />
      </ToggleChipGroup>

      <SubHeading>L4. Qualifying the borrower: funds</SubHeading>
      <FormGrid>
        <CurrencyInput label="Estimated closing costs" value={d.estimatedClosingCosts} readOnly hint={fromEstimate} span={2} />
        <CurrencyInput label="Prepaid items / escrows" value={d.prepaidItemsAmount} readOnly hint={fromEstimate} span={2} />
        <CurrencyInput label="Discount points" value={d.discountPointsAmount} readOnly hint={fromEstimate} span={2} />
        <CurrencyInput label="Improvements, renovations, repairs" value={form.improvementsAmount} onChange={set('improvementsAmount')} span={2} />
        <CurrencyInput label="Seller credits" value={form.sellerCredits} onChange={set('sellerCredits')} span={2} />
        <CurrencyInput label="Lender credits" value={d.lenderCredits} readOnly hint={fromEstimate} span={2} />
        {funds && (
          <>
            <CurrencyInput label="Earnest money (from assets)" value={earnestMoney || null} readOnly span={2} />
            <CurrencyInput label="Estimated cash to close" value={funds.cashToClose} readOnly hint={`Down payment ${formatCurrency(funds.downPayment)} + costs − credits`} span={2} />
          </>
        )}
      </FormGrid>
      <p className="mt-2 text-sm">
        <Link to={`/loans/${loan.id}?tab=estimates${selected ? `&estimate=${selected.id}` : ''}`} className="text-primary hover:underline">
          Edit in Scenarios & Estimate
        </Link>
        <span className="text-muted-foreground"> · closing costs, points, credits and cash to close come from the estimate Selected for this file.</span>
      </p>
    </SectionCard>
  )
}
