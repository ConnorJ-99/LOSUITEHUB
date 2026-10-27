import { useState } from 'react'
import { FileTextIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CurrencyInput, DateInput, FormGrid, Input, NumberInput, PercentInput, Select, SummaryBar, TextArea, ToggleChip } from '@/components/shared'
import { MORTGAGE_TYPE_OPTIONS, TERM_OPTIONS } from '@/components/profile/options'
import { firstPaymentDateFor, pointsAmount, pointsPct, prepaidInterestDays, round, type Factor, type FeeTemplate } from '@/lib/calc'
import { useUpdateLoanDetails } from '@/lib/api/loans'
import { useScenarioFees, useUpdateScenario } from '@/lib/api/pricing'
import { useSaveProperty, type PropertyInput } from '@/lib/api/properties'
import type { Buydown, ImpoundWaiver, LoanProfile, Property } from '@/lib/api/types'
import { formatIsoDate, nowIso } from '@/lib/dates'
import { formatCurrency, formatPercent } from '@/lib/format'
import { cashFigure, homeDifferences, loanChangesFrom, otherFinancingFor, payoffsFor, priceScenario, remainingLiensFor, scenarioChanges, type PricingScenario, type ScenarioDraft } from '@/lib/pricing/scenario'
import { FEE_WORKSHEET_TEMPLATE, feeWorksheet, joinNames, missingForBorrowerPdf, worksheetFileName } from '@/lib/documents/feeWorksheet'
import { useSavePdf } from '@/components/pdf/useSavePdf'
import { ReviewFees } from './ReviewFees'

const AMORTIZATION_OPTIONS = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'arm', label: 'ARM' },
] as const
const BUYDOWN_OPTIONS: { value: Buydown; label: string }[] = [
  { value: '1-0', label: '1-0' },
  { value: '2-1', label: '2-1' },
  { value: '3-2-1', label: '3-2-1' },
]
const WAIVER_OPTIONS: { value: ImpoundWaiver; label: string }[] = [
  { value: 'none', label: 'Escrow taxes and insurance' },
  { value: 'taxes', label: 'Waive taxes' },
  { value: 'insurance', label: 'Waive insurance' },
  { value: 'all', label: 'Waive both' },
]
const FACTOR_LABEL: Record<Factor, string> = { annual: 'Annual', monthly: 'Monthly', pct_of_value: '% of value' }

/** Everything about a home except what the Pricing tab doesn't touch, for saving it back. */
function propertyInput(p: Property): PropertyInput {
  const { id: _id, loanId: _loan, createdAt: _created, liens: _liens, rentalIncomeMethod: _method, scheduleEMonthlyIncome: _e, ...input } = p
  return input
}

interface Props {
  loan: LoanProfile
  scenario: PricingScenario
  properties: Property[]
  templates: FeeTemplate[]
  earnestMoney: number
  borrowerNames: string[]
}

/** One scenario: dates, loan inputs, the monthly payment, summary, fees A–H and cash to close. */
export function ScenarioEditor({ loan, scenario, properties, templates, earnestMoney, borrowerNames }: Props) {
  const [draft, setDraft] = useState<ScenarioDraft>(() => {
    const { id: _id, ...rest } = scenario
    return rest
  })
  const update = useUpdateScenario(loan.id)
  const fees = useScenarioFees(scenario.id)
  const updateLoan = useUpdateLoanDetails(loan.id)
  const saveProperty = useSaveProperty(loan.id, loan.organizationId)
  const [using, setUsing] = useState(false)
  const pdf = useSavePdf(loan)
  const set = <K extends keyof ScenarioDraft>(key: K) => (value: ScenarioDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const isPurchase = loan.purpose === 'purchase'
  const property = properties.find((p) => p.id === draft.propertyId) ?? null
  const overrides = fees.data ?? []
  const priced = priceScenario(draft, loan.purpose, templates, overrides, otherFinancingFor(loan.purpose, property))
  const { figures } = priced
  const payoffs = payoffsFor(loan.purpose, property)
  const cash = cashFigure({ purpose: loan.purpose, purchasePrice: draft.purchasePrice, totalLoanAmount: figures.totalLoanAmount, closingCosts: priced.closingCosts, payoffs, earnestMoney, sellerCredits: loan.details.sellerCredits ?? 0 })
  const prepaids = round(priced.totals.F + priced.totals.G)
  const changes = scenarioChanges(scenario, draft)
  const dirty = Object.keys(changes).length > 0
  const inUse = loan.details.pricingScenarioId === scenario.id
  const hoiWaived = draft.impoundWaiver === 'all' || draft.impoundWaiver === 'insurance'
  const taxWaived = draft.impoundWaiver === 'all' || draft.impoundWaiver === 'taxes'

  const save = () => {
    if (!draft.name.trim()) return toast.error('The scenario needs a name.')
    update.mutate({ id: scenario.id, changes }, { onSuccess: () => toast.success('Scenario saved'), onError: (e) => toast.error(e.message) })
  }
  const useForLoan = async () => {
    const where = property ? ` and the taxes, insurance and HOA on ${property.addressLine}` : ' and its tax, insurance and HOA estimates'
    if (!window.confirm(`Copy this scenario into the loan? This replaces the loan's amount, rate, term, loan type, points, lender credit and closing cost estimates${where}.`)) return
    setUsing(true)
    try {
      if (dirty) await update.mutateAsync({ id: scenario.id, changes })
      const c = loanChangesFrom({ ...draft, id: scenario.id }, loan.purpose, priced.closingCosts, prepaids)
      await updateLoan.mutateAsync(c.loan)
      if (c.property && property) await saveProperty.mutateAsync({ ...propertyInput(property), ...c.property, id: property.id })
      toast.success('Copied into the loan')
    } catch (e) {
      toast.error(`Could not copy everything: ${(e as Error).message}`)
    } finally {
      setUsing(false)
    }
  }

  const savePdf = async () => {
    if (!draft.name.trim()) return toast.error('The scenario needs a name.')
    const missing = missingForBorrowerPdf(draft, loan.purpose)
    if (missing.length) return toast.error(`Fill in the ${joinNames(missing)} first, so the worksheet doesn't show a blank or $0 payment.`)
    if (dirty) await update.mutateAsync({ id: scenario.id, changes })
    const preparedAt = nowIso()
    const worksheet = feeWorksheet({
      scenarioId: scenario.id,
      purpose: loan.purpose,
      occupancy: loan.details.occupancy,
      scenario: draft,
      lines: priced.lines,
      totals: priced.totals,
      figures,
      cash,
      payoffs,
      remainingLiens: remainingLiensFor(loan.purpose, property),
      earnestMoney,
      sellerCredits: loan.details.sellerCredits ?? 0,
      property,
      borrowerNames,
      preparedAt,
    })
    await pdf.save({
      render: (lib, brand) => lib.feeWorksheetPdf(worksheet, brand),
      tooLong: 'Combine or remove some fee lines.',
      fileName: worksheetFileName('Fee Worksheet', joinNames(borrowerNames), preparedAt),
      kind: 'fee_worksheet',
      propertyId: draft.propertyId,
      pricingScenarioId: scenario.id,
      templateVersion: FEE_WORKSHEET_TEMPLATE,
    })
  }

  const differences = property ? homeDifferences(draft, property) : []
  const useHomeNumbers = () => setDraft((d) => ({ ...d, ...Object.fromEntries(differences.map((x) => [x.field, x.home])) }))

  const fundingDays = draft.estimatedFundingDate ? prepaidInterestDays(draft.estimatedFundingDate) : null
  const pointsDollars = pointsAmount(draft.pointsPct, figures.totalLoanAmount)

  return (
    <div className="space-y-4">
      {differences.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="mr-auto">
            {property!.addressLine} has changed since this scenario was saved:{' '}
            {differences.map((x) => `${x.label} ${formatCurrency(x.home)} on the home, ${formatCurrency(x.scenario)} here`).join('; ')}.
          </p>
          <Button size="sm" variant="outline" onClick={useHomeNumbers}>
            Use the home's numbers
          </Button>
        </div>
      )}
      <Card contentClassName="py-3">
        <FormGrid>
          <DateInput label="Estimated funding" value={draft.estimatedFundingDate} onChange={set('estimatedFundingDate')} hint={fundingDays != null ? `${fundingDays} days of interest` : 'Sets prepaid interest'} />
          <DateInput
            label="First payment"
            value={draft.firstPaymentDate}
            onChange={set('firstPaymentDate')}
            hint={!draft.firstPaymentDate && draft.estimatedFundingDate ? `Usually ${formatIsoDate(firstPaymentDateFor(draft.estimatedFundingDate))}` : undefined}
          />
          <Input label="Closing date (loan)" value={loan.details.closingDate ? formatIsoDate(loan.details.closingDate) : '—'} readOnly />
          <NumberInput label="Lock period" suffix="days" value={draft.lockDays} onChange={set('lockDays')} maxDecimals={0} />
          <Select label="Escrows" value={draft.impoundWaiver} options={WAIVER_OPTIONS} onChange={set('impoundWaiver')} span={2} />
        </FormGrid>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card title="Loan" action={inUse && <Badge variant="secondary">Used for this loan</Badge>}>
          <FormGrid className="lg:grid-cols-2">
            <Input label="Scenario name" value={draft.name} onChange={set('name')} required span={2} />
            <Input label="Lender" value={draft.lenderName ?? ''} onChange={(v) => set('lenderName')(v || null)} />
            <Input label="Program" value={draft.programName ?? ''} onChange={(v) => set('programName')(v || null)} />
            <Select
              label="Property"
              value={draft.propertyId}
              options={properties.map((p) => ({ value: p.id, label: p.addressLine }))}
              onChange={set('propertyId')}
              onClear={() => set('propertyId')(null)}
              placeholder="No property"
              span={2}
            />
            <Select label="Loan type" value={draft.mortgageType} options={MORTGAGE_TYPE_OPTIONS} onChange={set('mortgageType')} onClear={() => set('mortgageType')(null)} />
            <Select label="Term" value={draft.termMonths ? String(draft.termMonths) : null} options={TERM_OPTIONS} onChange={(v) => set('termMonths')(Number(v))} />
            <Select label="Amortization" value={draft.amortizationType} options={AMORTIZATION_OPTIONS} onChange={set('amortizationType')} />
            <Select label="Buydown" value={draft.buydown} options={BUYDOWN_OPTIONS} onChange={set('buydown')} onClear={() => set('buydown')(null)} placeholder="None" />
            <PercentInput label="Rate" value={draft.noteRate} onChange={set('noteRate')} required />
            <PercentInput label="Qualifying rate" value={draft.qualifyingRate} onChange={set('qualifyingRate')} hint="If different from the rate" />
            {isPurchase && <CurrencyInput label="Purchase price" value={draft.purchasePrice} onChange={set('purchasePrice')} required />}
            <CurrencyInput label={isPurchase ? 'Appraised value' : 'Value'} value={draft.propertyValue} onChange={set('propertyValue')} hint={isPurchase ? 'Blank = the price' : undefined} />
            <CurrencyInput label="Loan amount" value={draft.loanAmount} onChange={set('loanAmount')} required />
            <Input label="LTV" value={formatPercent(figures.ltvPct, 2)} readOnly />
            {figures.financedFee > 0 && (
              <Input label="Total loan (with financed fee)" value={`${formatCurrency(figures.totalLoanAmount)} (+${formatCurrency(figures.financedFee)})`} readOnly span={2} />
            )}
            <PercentInput label="Points" value={draft.pointsPct} onChange={(v) => set('pointsPct')(v ?? 0)} />
            <CurrencyInput label="Points ($)" value={pointsDollars} onChange={(v) => set('pointsPct')(pointsPct(v ?? 0, figures.totalLoanAmount))} />
            <CurrencyInput label="Lender credit" value={draft.lenderCredit} onChange={(v) => set('lenderCredit')(v ?? 0)} />
            <div className="flex items-end pb-1">
              <ToggleChip label="Interest only" pressed={draft.interestOnly} onChange={set('interestOnly')} />
            </div>
            <TextArea label="Notes" value={draft.notes ?? ''} onChange={(v) => set('notes')(v || null)} rows={2} span={2} />
          </FormGrid>
        </Card>

        <div className="space-y-4">
          <Card title="Proposed monthly payment" description={hoiWaived || taxWaived ? 'Waived items are paid by the borrower directly and still count in the payment.' : undefined}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th className="py-1 font-medium">Item</th>
                    <th className="py-1 font-medium">Figured as</th>
                    <th className="py-1 font-medium">Entered</th>
                    <th className="py-1 text-right font-medium">Monthly</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <PaymentRow label="Principal and interest" how={draft.interestOnly ? 'Interest only' : 'Calculated'} monthly={figures.payment.principalAndInterest}>
                    <span className="text-xs text-muted-foreground">
                      {formatPercent(draft.noteRate)} · {draft.termMonths ? `${draft.termMonths / 12} yr` : '—'}
                      {draft.buydown && ` · ${draft.buydown} buydown`}
                    </span>
                  </PaymentRow>
                  {figures.payment.otherFinancing > 0 && <PaymentRow label="Other financing" how="Mortgages that stay" monthly={figures.payment.otherFinancing} />}
                  <PaymentRow label="Homeowner's insurance" waived={hoiWaived} how={<FactorSelect value={draft.insuranceFactor} onChange={set('insuranceFactor')} label="Insurance entered as" />} monthly={figures.payment.hoi}>
                    <ValueInput label="Insurance" factor={draft.insuranceFactor} value={draft.insuranceValue} onChange={set('insuranceValue')} />
                  </PaymentRow>
                  <PaymentRow label="Supplemental insurance" how="Monthly" monthly={figures.payment.supplemental}>
                    <CurrencyInput label="Supplemental insurance" hideLabel value={draft.supplementalInsuranceMonthly} onChange={set('supplementalInsuranceMonthly')} placeholder="Flood, wind…" />
                  </PaymentRow>
                  <PaymentRow label="Property taxes" waived={taxWaived} how={<FactorSelect value={draft.taxesFactor} onChange={set('taxesFactor')} label="Taxes entered as" />} monthly={figures.payment.taxes}>
                    <ValueInput label="Taxes" factor={draft.taxesFactor} value={draft.taxesValue} onChange={set('taxesValue')} />
                  </PaymentRow>
                  <PaymentRow
                    label="Mortgage insurance"
                    how={<ToggleChip label="Calculated" pressed={draft.monthlyMi == null} onChange={(on) => set('monthlyMi')(on ? null : figures.payment.mi)} />}
                    monthly={figures.payment.mi}
                  >
                    {draft.monthlyMi != null && <CurrencyInput label="Mortgage insurance" hideLabel value={draft.monthlyMi} onChange={(v) => set('monthlyMi')(v ?? 0)} />}
                  </PaymentRow>
                  <PaymentRow label="HOA dues" how="Monthly" monthly={figures.payment.hoa}>
                    <CurrencyInput label="HOA dues" hideLabel value={draft.monthlyHoa} onChange={set('monthlyHoa')} />
                  </PaymentRow>
                  <PaymentRow label={draft.otherPaymentLabel || 'Other'} how="Monthly" monthly={figures.payment.other}>
                    <div className="flex gap-2">
                      <Input label="Other payment name" hideLabel value={draft.otherPaymentLabel ?? ''} onChange={(v) => set('otherPaymentLabel')(v || null)} placeholder="Name" />
                      <CurrencyInput label="Other payment" hideLabel value={draft.otherPaymentMonthly} onChange={set('otherPaymentMonthly')} />
                    </div>
                  </PaymentRow>
                </tbody>
                <tfoot>
                  <tr className="border-t-2">
                    <td className="py-2 font-semibold" colSpan={3}>
                      Total PITIA
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums">{formatCurrency(figures.pitia)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card title="Summary">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              {isPurchase && <SummaryLine label="Purchase price" value={formatCurrency(draft.purchasePrice)} />}
              <SummaryLine label={isPurchase ? 'Appraised value' : 'Value'} value={formatCurrency(draft.propertyValue ?? draft.purchasePrice)} />
              <SummaryLine label="Loan amount" value={formatCurrency(figures.totalLoanAmount)} />
              <SummaryLine label="LTV" value={formatPercent(figures.ltvPct, 2)} />
              <SummaryLine label="Rate / term" value={`${formatPercent(draft.noteRate)} / ${draft.termMonths ? `${draft.termMonths / 12} yr` : '—'}`} />
              <SummaryLine label="Total PITIA" value={formatCurrency(figures.pitia)} />
              <SummaryLine label="Closing costs (A–H)" value={formatCurrency(round(priced.closingCosts + draft.lenderCredit))} />
              {draft.lenderCredit > 0 && <SummaryLine label="Lender credit" value={`−${formatCurrency(draft.lenderCredit)}`} />}
              {isPurchase ? (
                <>
                  <SummaryLine label="Down payment" value={formatCurrency(round((draft.purchasePrice ?? 0) - figures.totalLoanAmount))} />
                  {earnestMoney > 0 && <SummaryLine label="Earnest money" value={`−${formatCurrency(earnestMoney)}`} />}
                  {(loan.details.sellerCredits ?? 0) > 0 && <SummaryLine label="Seller credits" value={`−${formatCurrency(loan.details.sellerCredits)}`} />}
                </>
              ) : (
                <SummaryLine label="Payoffs" value={payoffs ? `−${formatCurrency(payoffs)}` : property ? '$0' : 'Pick a property'} />
              )}
              <div className="col-span-2 mt-1 flex items-baseline justify-between border-t pt-2">
                <dt className="font-semibold">{cash.label}</dt>
                <dd className="text-base font-semibold tabular-nums">{formatCurrency(cash.amount)}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      <ReviewFees
        scenario={scenario}
        organizationId={loan.organizationId}
        purpose={loan.purpose}
        draft={draft}
        setDraft={setDraft}
        lines={priced.lines}
        totals={priced.totals}
        overrides={overrides}
        closingCosts={priced.closingCosts}
        totalLoanAmount={figures.totalLoanAmount}
        noFeeList={templates.length === 0}
      />

      <SummaryBar
        items={[
          { label: cash.label, value: formatCurrency(cash.amount) },
          { label: 'PITIA', value: formatCurrency(figures.pitia) },
          { label: 'Closing costs', value: formatCurrency(priced.closingCosts) },
          { label: 'LTV', value: formatPercent(figures.ltvPct, 2) },
        ]}
        action={
          <div className="flex gap-2">
            {dirty && (
              <Button variant="outline" onClick={save} disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save scenario'}
              </Button>
            )}
            <Button variant="outline" onClick={savePdf} disabled={pdf.saving || !pdf.ready || update.isPending} title={property ? `Saved to Documents and to ${property.addressLine}` : 'Saved to Documents'}>
              <FileTextIcon />
              {pdf.saving ? 'Making PDF…' : 'Save Fee Worksheet PDF'}
            </Button>
            <Button onClick={useForLoan} disabled={using}>
              {using ? 'Copying…' : inUse ? 'Use again for this loan' : 'Use for this loan'}
            </Button>
          </div>
        }
      />
    </div>
  )
}

function PaymentRow({ label, how, monthly, waived, children }: { label: string; how: React.ReactNode; monthly: number; waived?: boolean; children?: React.ReactNode }) {
  return (
    <tr className="align-middle">
      <td className="py-1.5 pr-3">
        {label}
        {waived && (
          <Badge variant="outline" className="ml-1.5 text-[10px]">
            WAIVED
          </Badge>
        )}
      </td>
      <td className="py-1.5 pr-3 text-xs text-muted-foreground">{how}</td>
      <td className="w-40 py-1.5 pr-3">{children}</td>
      <td className="py-1.5 text-right tabular-nums">{formatCurrency(monthly)}</td>
    </tr>
  )
}

function FactorSelect({ value, onChange, label }: { value: Factor; onChange: (f: Factor) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Factor)} className="h-8 rounded-md border bg-transparent px-1.5 text-xs text-foreground">
      {(Object.keys(FACTOR_LABEL) as Factor[]).map((f) => (
        <option key={f} value={f}>
          {FACTOR_LABEL[f]}
        </option>
      ))}
    </select>
  )
}

function ValueInput({ label, factor, value, onChange }: { label: string; factor: Factor; value: number | null; onChange: (v: number | null) => void }) {
  return factor === 'pct_of_value' ? <PercentInput label={label} hideLabel value={value} onChange={onChange} /> : <CurrencyInput label={label} hideLabel value={value} onChange={onChange} />
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-right tabular-nums')}>{value}</dd>
    </>
  )
}
