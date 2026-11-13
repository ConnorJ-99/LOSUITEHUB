import { Card, CurrencyInput, FormGrid, Input, PercentInput, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { OCCUPANCY_OPTIONS, PROPERTY_TYPE_OPTIONS } from '@/components/profile/options'
import { formatCurrency } from '@/lib/format'
import { COUNTY_TAX_RATES, CREDIT_BUCKETS, downAmount, downPct, housingEstimate, QUOTE_PURPOSES, type QuoteScenario } from '@/lib/quickquote/quote'

const CREDIT_OPTIONS = CREDIT_BUCKETS.map((b) => ({ value: String(b.value), label: b.label }))
const COUNTIES = Object.keys(COUNTY_TAX_RATES)

/** Left panel: who the quote is for and the deal. Edits go straight up; nothing is figured here. */
export function ScenarioPanel({ scenario: s, onChange }: { scenario: QuoteScenario; onChange: (s: QuoteScenario) => void }) {
  const set = (changes: Partial<QuoteScenario>) => onChange({ ...s, ...changes })
  const setBorrower = (changes: Partial<QuoteScenario['borrower']>) => set({ borrower: { ...s.borrower, ...changes } })
  const housing = housingEstimate(s)
  const purchase = s.purpose === 'purchase'
  const pct = downPct(s.purchasePrice, s.downPayment)

  return (
    <Card>
      <div className="space-y-5">
        <section className="space-y-3">
          <p className="eyebrow">Borrower</p>
          <FormGrid className="lg:grid-cols-2">
            <Input label="Name" required value={s.borrower.name} onChange={(name) => setBorrower({ name })} span={2} autoComplete="off" />
            <Input label="Email" type="email" value={s.borrower.email} onChange={(email) => setBorrower({ email })} span={2} autoComplete="off" />
            <Input label="Phone" type="tel" value={s.borrower.phone} onChange={(phone) => setBorrower({ phone })} span={2} autoComplete="off" />
          </FormGrid>
        </section>

        <section className="space-y-3 border-t pt-4">
          <p className="eyebrow">Scenario</p>
          <ToggleChipGroup>
            {QUOTE_PURPOSES.map((p) => (
              <ToggleChip key={p.value} label={p.label} pressed={s.purpose === p.value} onChange={() => set({ purpose: p.value })} />
            ))}
          </ToggleChipGroup>
          <FormGrid className="lg:grid-cols-2">
            {purchase ? (
              <>
                <CurrencyInput
                  label="Purchase price"
                  value={s.purchasePrice}
                  onChange={(purchasePrice) => set({ purchasePrice, downPayment: pct != null && purchasePrice ? downAmount(purchasePrice, pct) : s.downPayment })}
                />
                <CurrencyInput label="Down payment" value={s.downPayment} onChange={(downPayment) => set({ downPayment })} />
                <PercentInput label="Down payment %" value={pct} onChange={(v) => set({ downPayment: v == null ? null : downAmount(s.purchasePrice, v) })} />
              </>
            ) : (
              <>
                <CurrencyInput label="Home value" value={s.value} onChange={(value) => set({ value })} />
                <CurrencyInput label="Loan balance" value={s.loanBalance} onChange={(loanBalance) => set({ loanBalance })} />
                {s.purpose === 'refinance_cash_out' && <CurrencyInput label="Cash out" value={s.cashOut} onChange={(cashOut) => set({ cashOut })} />}
              </>
            )}
            <Select label="Est. credit" value={s.creditBucket == null ? null : String(s.creditBucket)} options={CREDIT_OPTIONS} placeholder="Pick a range" onChange={(v) => set({ creditBucket: Number(v) })} onClear={() => set({ creditBucket: null })} />
            <Select label="Occupancy" value={s.occupancy} options={OCCUPANCY_OPTIONS} onChange={(occupancy) => set({ occupancy })} />
            <Select label="Property" value={s.propertyType} options={PROPERTY_TYPE_OPTIONS} onChange={(propertyType) => set({ propertyType })} />
            <Input label="County" value={s.county ?? ''} onChange={(county) => set({ county: county || null })} placeholder="e.g. Collin" list="qq-counties" autoComplete="off" />
            <Input label="State" value={s.state} onChange={(state) => set({ state: state.toUpperCase().slice(0, 2) })} maxLength={2} />
          </FormGrid>
          {COUNTIES.length > 0 && (
            <datalist id="qq-counties">
              {COUNTIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          )}
          <ToggleChipGroup>
            <ToggleChip label="First-time buyer" pressed={s.firstTimeBuyer} onChange={(firstTimeBuyer) => set({ firstTimeBuyer })} />
            <ToggleChip label="Veteran / VA eligible" pressed={s.vaEligible} onChange={(vaEligible) => set({ vaEligible })} />
            <ToggleChip label="Show DPA options" pressed={s.showDpa} onChange={(showDpa) => set({ showDpa })} />
          </ToggleChipGroup>
        </section>

        <section className="space-y-3 border-t pt-4">
          <p className="eyebrow">Taxes &amp; insurance</p>
          <FormGrid className="lg:grid-cols-2">
            <CurrencyInput
              label="Taxes / mo"
              value={s.taxesMonthly ?? housing.taxesMonthly}
              onChange={(taxesMonthly) => set({ taxesMonthly })}
              hint={housing.taxesEstimated ? `${housing.taxRatePct}% of the ${purchase ? 'price' : 'value'}${housing.taxRateFromCounty ? ` (${s.county} County)` : ''}` : 'Typed over'}
            />
            <CurrencyInput
              label="Insurance / mo"
              value={s.insuranceMonthly ?? housing.insuranceMonthly}
              onChange={(insuranceMonthly) => set({ insuranceMonthly })}
              hint={housing.insuranceEstimated ? '$3,600 a year' : 'Typed over'}
            />
          </FormGrid>
          <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {housing.taxRateFromCounty
              ? `Taxes from the ${s.county} County rate (${housing.taxRatePct}%).`
              : `No county tax rate yet, so taxes use ${housing.taxRatePct}% of the ${purchase ? 'price' : 'value'}.`}{' '}
            Taxes &amp; insurance: <span className="font-semibold text-foreground">{formatCurrency(Math.round(housing.taxesMonthly + housing.insuranceMonthly))}/mo</span>
            {(!housing.taxesEstimated || !housing.insuranceEstimated) && (
              <button type="button" className="ml-1 text-primary underline-offset-2 hover:underline" onClick={() => set({ taxesMonthly: null, insuranceMonthly: null })}>
                Use the estimates
              </button>
            )}
          </div>
        </section>
      </div>
    </Card>
  )
}
