// Down payment assistance or a gift / grant on one estimate (Connor,
// 2026-11-14). Some programs allow a DPA second lien: forgivable (no monthly
// payment) or repayable (a payment from its rate and term). The funds lower
// cash to close; a DPA lien counts in CLTV. The math is in src/lib/calc/dpa.ts.
import { CurrencyInput, FormGrid, Input, NumberInput, PercentInput, Select } from '@/components/shared'
import { DPA_KINDS, dpaProblem, type Dpa, type DpaKind } from '@/lib/calc/dpa'
import { formatCurrency, formatPercent } from '@/lib/format'

const NONE = 'none'

export function DpaFields({ value, onChange, monthly, cltvPct }: { value: Dpa | null; onChange: (d: Dpa | null) => void; monthly: number; cltvPct: number | null }) {
  const on = !!value && value.amount > 0
  const kind: DpaKind | typeof NONE = value ? value.kind : NONE
  const set = (patch: Partial<Dpa>) => onChange({ kind: value?.kind ?? 'forgivable', amount: value?.amount ?? 0, ratePct: value?.ratePct ?? null, termMonths: value?.termMonths ?? null, name: value?.name ?? null, ...patch })
  const problem = dpaProblem(value)

  return (
    <div className="mt-4 border-t pt-3">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Down payment assistance / gift</p>
      <FormGrid className="mt-1 lg:grid-cols-2">
        <Select
          label="Type"
          value={kind}
          options={[{ value: NONE, label: 'None' }, ...DPA_KINDS.map((k) => ({ value: k.value, label: `${k.label} (${k.hint})` }))]}
          onChange={(v) => (v === NONE ? onChange(null) : set({ kind: v as DpaKind }))}
        />
        {value && (
          <>
            <CurrencyInput label="Amount" value={value.amount || null} onChange={(amount) => set({ amount: amount ?? 0 })} />
            <Input label="Program" value={value.name ?? ''} onChange={(name) => set({ name: name || null })} placeholder="e.g. TDHCA My First Texas Home" span={2} />
            {kind === 'repayable' && (
              <>
                <PercentInput label="Rate" value={value.ratePct} onChange={(ratePct) => set({ ratePct })} hint="0 = no interest" />
                <NumberInput label="Term (years)" value={value.termMonths ? value.termMonths / 12 : null} onChange={(y) => set({ termMonths: y ? Math.round(y * 12) : null })} maxDecimals={0} error={problem ?? undefined} />
              </>
            )}
          </>
        )}
      </FormGrid>
      {on && (
        <p className="mt-2 text-xs text-muted-foreground">
          {kind === 'repayable' ? `Monthly payment ${formatCurrency(monthly)} (in the payment above)` : kind === 'forgivable' ? 'Forgivable: no monthly payment' : 'Gift / grant: no lien, no payment'}
          {cltvPct != null && kind !== 'gift' && ` · CLTV ${formatPercent(cltvPct, 2)}`} · lowers cash to close by {formatCurrency(value!.amount)}
        </p>
      )}
    </div>
  )
}
