import { ArrowRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CurrencyInput, FormGrid, Input, NumberInput, PercentInput, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { formatPercent } from '@/lib/format'
import { ratios } from '@/lib/products/engine'
import { downPayment, withDownAmount, withDownPct, withPrice } from '@/lib/products/scenarioForm'
import { CITIZENSHIPS, DOC_TYPES, FEATURES, LENDER_STATUSES, LIENS, MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, OCCUPANCIES, PRODUCT_FAMILIES, type Feature, type LenderStatus, type MatrixPropertyType } from '@/lib/products/taxonomy'
import type { Scenario } from '@/lib/products/types'

/** Features offered as must-haves on the form (mockup 01). */
const MUST_HAVES: Feature[] = ['dpa', 'itin', 'foreign_national', 'interest_only', 'non_warrantable_condo', 'manufactured', 'buydown', 'recent_credit_event', 'llc_vesting', 'first_time_investor', 'str_income', 'homeready_possible']
export const SHOWN_STATUSES: LenderStatus[] = ['approved', 'pending', 'not_signed_up']
const options = <T extends string>(l: { values: T[]; label: Record<T, string> }) => l.values.map((v) => ({ value: v, label: l.label[v] }))
const UNIT_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((u) => ({ value: u, label: u }))
/** The property type that goes with a number of units: 2–4 units, 5+ units, or back to a house from either. */
const typeForUnits = (units: number, type: MatrixPropertyType): MatrixPropertyType => (units >= 5 ? 'five_plus' : units > 1 ? 'two_to_four' : type === 'two_to_four' || type === 'five_plus' ? 'sfr_pud' : type)

interface Props {
  scenario: Scenario
  onChange: (s: Scenario) => void
  statuses: LenderStatus[]
  onStatuses: (s: LenderStatus[]) => void
  /** Programs of this type the search would look at. */
  typeCount: number
  missing: string[]
  onSearch: () => void
}

/** Search by parameters: step 1 the kind of loan (only that type is searched), step 2 the scenario, then search. */
export function SearchForm({ scenario: s, onChange, statuses, onStatuses, typeCount, missing, onSearch }: Props) {
  const set = <K extends keyof Scenario>(key: K) => (value: Scenario[K]) => onChange({ ...s, [key]: value })
  const { ltv, cltv } = ratios(s)
  const down = downPayment(s)
  const isPurchase = s.purpose === 'purchase'
  const second = s.lien !== 'first'
  const toggleFeature = (f: Feature, on: boolean) => set('features')(on ? [...s.features, f] : s.features.filter((x) => x !== f))
  const familyLabel = s.family === 'any' ? 'every product family' : PRODUCT_FAMILIES.label[s.family]

  return (
    <div className="space-y-4">
      <Card title="1 · What kind of loan?" action={<span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">Only programs of this type are searched</span>}>
        <div className="space-y-3">
          <ChipRow label="Lien">
            {LIENS.values.map((l) => (
              <ToggleChip key={l} label={LIENS.label[l]} pressed={s.lien === l} onChange={() => onChange({ ...s, lien: l, firstLienBalance: l === 'first' ? 0 : s.firstLienBalance, purpose: l !== 'first' && s.purpose === 'purchase' ? 'cash_out' : s.purpose, purchasePrice: l === 'first' ? s.purchasePrice : null })} />
            ))}
          </ChipRow>
          <ChipRow label="Product family">
            {PRODUCT_FAMILIES.values.map((f) => (
              <ToggleChip key={f} label={PRODUCT_FAMILIES.label[f]} pressed={s.family === f} onChange={() => set('family')(f)} />
            ))}
            <ToggleChip label="Any" pressed={s.family === 'any'} onChange={() => set('family')('any')} />
          </ChipRow>
          <ChipRow label="Income documentation">
            {DOC_TYPES.values.map((d) => (
              <ToggleChip key={d} label={DOC_TYPES.label[d]} pressed={s.docType === d} onChange={() => set('docType')(d)} />
            ))}
          </ChipRow>
          <ChipRow label="Must have (optional)">
            {MUST_HAVES.map((f) => (
              <ToggleChip key={f} label={FEATURES.label[f]} pressed={s.features.includes(f)} onChange={(on) => toggleFeature(f, on)} />
            ))}
          </ChipRow>
        </div>
      </Card>

      <Card title="2 · Scenario">
        <FormGrid>
          <Select label="Purpose" required value={s.purpose} options={options(MATRIX_PURPOSES).filter((p) => !second || p.value !== 'purchase')} onChange={(purpose) => onChange({ ...s, purpose, purchasePrice: purpose === 'purchase' ? s.purchasePrice : null })} />
          <Select label="Occupancy" required value={s.occupancy} options={options(OCCUPANCIES)} onChange={set('occupancy')} />
          <Select label="Property type" required value={s.propertyType} options={options(MATRIX_PROPERTY_TYPES)} onChange={(t) => onChange({ ...s, propertyType: t, units: t === 'two_to_four' ? Math.min(4, Math.max(2, s.units)) : t === 'five_plus' ? Math.max(5, s.units) : 1 })} />
          <Select label="Units" value={String(s.units)} options={UNIT_OPTIONS} onChange={(u) => onChange({ ...s, units: Number(u), propertyType: typeForUnits(Number(u), s.propertyType) })} />
          <Input label="State" required value={s.state} onChange={(v) => set('state')(v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))} />
          <Input label="County" value={s.county ?? ''} onChange={(v) => set('county')(v || null)} />

          {isPurchase && !second ? (
            <>
              <CurrencyInput label="Price" required value={s.purchasePrice} onChange={(v) => onChange(withPrice(s, v))} hint="A TBD price is fine" />
              <PercentInput label="Down payment %" value={down?.pct ?? null} onChange={(v) => onChange(withDownPct(s, v ?? 0))} maxDecimals={3} />
              <CurrencyInput label="Down payment $" value={down?.amount ?? null} onChange={(v) => onChange(withDownAmount(s, v ?? 0))} />
              <CurrencyInput label="Loan amount" value={s.loanAmount || null} readOnly />
              <CurrencyInput label="Appraised value" value={s.value || null} onChange={(v) => set('value')(v ?? 0)} hint="Blank = the price" />
            </>
          ) : (
            <>
              <CurrencyInput label="Value" required value={s.value || null} onChange={(v) => set('value')(v ?? 0)} />
              {second && <CurrencyInput label="1st lien balance" required value={s.firstLienBalance || null} onChange={(v) => set('firstLienBalance')(v ?? 0)} />}
              <CurrencyInput label={second ? (s.lien === 'heloc' ? 'HELOC amount' : '2nd lien amount') : 'Loan amount'} required value={s.loanAmount || null} onChange={(v) => set('loanAmount')(v ?? 0)} />
            </>
          )}
          <Input label={second ? 'CLTV' : 'LTV / CLTV'} value={Number.isFinite(ltv) ? (second ? formatPercent(cltv, 2) : `${formatPercent(ltv, 2)} / ${formatPercent(cltv, 2)}`) : '—'} readOnly />

          <NumberInput label="Credit score" required value={s.fico} onChange={set('fico')} maxDecimals={0} />
          <PercentInput label="DTI" value={s.dti} onChange={set('dti')} maxDecimals={2} />
          <NumberInput label="Reserves (months)" value={s.reservesMonths} onChange={set('reservesMonths')} maxDecimals={1} />
          {s.docType === 'dscr' && <NumberInput label="DSCR" value={s.dscr} onChange={set('dscr')} maxDecimals={2} hint="Rent ÷ PITIA" />}
          <Select label="Citizenship" value={s.citizenship} options={options(CITIZENSHIPS)} onChange={set('citizenship')} />
          <NumberInput label="Mortgage lates (12 mo)" value={s.mortgageLates12} onChange={set('mortgageLates12')} maxDecimals={0} hint="Blank = not known" />
          <SeasoningInput label="Months since bankruptcy" value={s.bkSeasoningMonths} onChange={set('bkSeasoningMonths')} />
          <SeasoningInput label="Months since FC / SS / DIL" value={s.fcSeasoningMonths} onChange={set('fcSeasoningMonths')} />
          <NumberInput label="Years self-employed" value={s.selfEmployedYears} onChange={set('selfEmployedYears')} maxDecimals={1} />
          <PercentInput label="Income vs area median" value={s.incomeVsAmiPct} onChange={set('incomeVsAmiPct')} maxDecimals={2} hint="For income-limited programs" />
        </FormGrid>
        <ToggleChipGroup className="mt-4">
          <ToggleChip label="First-time buyer" pressed={s.firstTimeBuyer} onChange={set('firstTimeBuyer')} />
          {s.state === 'TX' && <ToggleChip label="Texas homestead" pressed={s.homestead} onChange={set('homestead')} />}
        </ToggleChipGroup>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              Search {typeCount} {familyLabel} {LIENS.label[s.lien].toLowerCase()} program{typeCount === 1 ? '' : 's'} ({DOC_TYPES.label[s.docType]})
            </p>
            <p className="text-sm text-muted-foreground">{missing.length ? `Add the ${missing.join(', ')} first.` : 'Rule-based match against your saved matrices. No AI is used.'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Lenders</span>
            {SHOWN_STATUSES.map((st) => (
              <ToggleChip key={st} label={LENDER_STATUSES.label[st]} pressed={statuses.includes(st)} onChange={(on) => onStatuses(on ? [...statuses, st] : statuses.filter((x) => x !== st))} />
            ))}
          </div>
          <Button onClick={onSearch} disabled={missing.length > 0}>
            Search programs
            <ArrowRightIcon />
          </Button>
        </div>
      </Card>
    </div>
  )
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <ToggleChipGroup>{children}</ToggleChipGroup>
    </div>
  )
}

/** Months since an event: blank = none; an event with no date shows as "date unknown". */
function SeasoningInput({ label, value, onChange }: { label: string; value: number | 'unknown' | null; onChange: (v: number | null) => void }) {
  return <NumberInput label={label} value={value === 'unknown' ? null : value} onChange={onChange} maxDecimals={0} hint={value === 'unknown' ? 'Event on file, date unknown (shows as Verify)' : 'Blank = none'} />
}
