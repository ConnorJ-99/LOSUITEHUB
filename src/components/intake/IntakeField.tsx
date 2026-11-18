import { PlusIcon, Trash2Icon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { CurrencyInput, DateInput, FormGrid, Input, NumberInput, Select, TextArea } from '@/components/shared'
import { usePartners } from '@/lib/api/partners'
import type { Field } from '@/lib/intake/sections'
import { realtorChoices } from '@/lib/messaging/templates'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const rows = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : [])
const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const numOf = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)

/** No / Yes chips, with "Details" when Yes. */
function YesNo({ field, value, onChange, readOnly }: { field: Field; value: unknown; onChange: (v: unknown) => void; readOnly: boolean }) {
  const v = obj(value)
  const answer = text(v.answer)
  return (
    <div className="sm:col-span-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-48 text-sm">{field.label}</span>
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5" role="radiogroup" aria-label={field.label}>
          {(['no', 'yes'] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={answer === a}
              disabled={readOnly}
              onClick={() => onChange({ ...v, answer: answer === a ? null : a })}
              className={cn('rounded-md px-3 py-0.5 text-sm', answer === a ? 'bg-white font-medium text-primary shadow-sm' : 'text-muted-foreground')}
            >
              {a === 'no' ? 'No' : 'Yes'}
            </button>
          ))}
        </div>
        {answer === 'yes' && (
          <div className="min-w-56 flex-1">
            <Input label={`${field.label}: details`} hideLabel placeholder="Details, dates, amounts" value={text(v.details)} onChange={(d) => onChange({ ...v, details: d })} readOnly={readOnly} />
          </div>
        )}
      </div>
    </div>
  )
}

/** A realtor from the Partner center, or a name and phone typed in. */
function Realtor({ field, value, onChange, readOnly }: { field: Field; value: unknown; onChange: (v: unknown) => void; readOnly: boolean }) {
  const partners = usePartners()
  const realtors = realtorChoices(partners.data ?? [])
  const v = obj(value)
  const picked = text(v.partnerId)
  return (
    <>
      <Select
        label={field.label}
        value={picked || null}
        placeholder={partners.isLoading ? 'Loading…' : 'Pick a realtor partner…'}
        options={realtors.map((r) => ({ value: r.id, label: [r.name, r.company].filter(Boolean).join(' · ') }))}
        onChange={(id) => {
          const r = realtors.find((x) => x.id === id)
          onChange({ partnerId: id, name: r?.name ?? '', phone: r?.phone ?? '' })
        }}
        onClear={readOnly ? undefined : () => onChange({ partnerId: null, name: '', phone: '' })}
        readOnly={readOnly}
        span={2}
      />
      {!picked && (
        <>
          <Input label="Or realtor name" value={text(v.name)} onChange={(n) => onChange({ ...v, name: n })} readOnly={readOnly} span={2} />
          <Input label="Realtor phone" type="tel" value={text(v.phone)} onChange={(p) => onChange({ ...v, phone: p })} readOnly={readOnly} span={2} />
        </>
      )}
    </>
  )
}

/** One field of the interview. */
export function IntakeField({ field, value, onChange, readOnly }: { field: Field; value: unknown; onChange: (v: unknown) => void; readOnly: boolean }) {
  const span = field.wide ? 6 : 2
  switch (field.kind) {
    case 'hint':
      return <p className="text-xs text-muted-foreground sm:col-span-6">{field.label}</p>
    case 'text':
      return <Input label={field.label} hint={field.hint} value={text(value)} onChange={onChange} readOnly={readOnly} span={span} />
    case 'textarea':
      return <TextArea label={field.label} hint={field.hint} value={text(value)} onChange={onChange} readOnly={readOnly} rows={3} span={6} />
    case 'money':
      return <CurrencyInput label={field.label} hint={field.hint} value={numOf(value)} onChange={onChange} readOnly={readOnly} span={span} />
    case 'number':
      return <NumberInput label={field.label} hint={field.hint} value={numOf(value)} onChange={onChange} readOnly={readOnly} span={span} maxDecimals={0} />
    case 'date':
      return <DateInput label={field.label} hint={field.hint} value={text(value) || null} onChange={onChange} readOnly={readOnly} span={span} />
    case 'datetime':
      return <Input label={field.label} type="datetime-local" value={text(value)} onChange={onChange} readOnly={readOnly} span={span} />
    case 'select':
      return <Select label={field.label} hint={field.hint} value={text(value) || null} options={field.options} onChange={onChange} onClear={readOnly ? undefined : () => onChange(null)} readOnly={readOnly} placeholder="Select…" span={span} />
    case 'check':
      return (
        <label className={cn('flex items-start gap-2 text-sm sm:col-span-6', !readOnly && 'cursor-pointer')}>
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={value === true} disabled={readOnly} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>
      )
    case 'yesno':
      return <YesNo field={field} value={value} onChange={onChange} readOnly={readOnly} />
    case 'realtor':
      return <Realtor field={field} value={value} onChange={onChange} readOnly={readOnly} />
    case 'funds': {
      const v = obj(value)
      return (
        <div className="sm:col-span-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{field.label}</p>
          <div className="mt-1 divide-y rounded-md border">
            {field.rows.map((r) => {
              const row = obj(v[r.value])
              return (
                <div key={r.value} className="grid items-center gap-2 px-3 py-1.5 sm:grid-cols-[10rem_10rem_minmax(0,1fr)]">
                  <span className="text-sm">{r.label}</span>
                  <CurrencyInput label={`${r.label} amount`} hideLabel value={numOf(row.amount)} onChange={(a) => onChange({ ...v, [r.value]: { ...row, amount: a } })} readOnly={readOnly} />
                  <Input label={`${r.label} source / timing`} hideLabel placeholder="Source / timing" value={text(row.source)} onChange={(s) => onChange({ ...v, [r.value]: { ...row, source: s } })} readOnly={readOnly} />
                </div>
              )
            })}
          </div>
        </div>
      )
    }
    case 'repeater': {
      const list = rows(value)
      const set = (i: number, row: Obj) => onChange(list.map((x, j) => (j === i ? row : x)))
      return (
        <div className="sm:col-span-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{field.label}</p>
          <div className="mt-1 space-y-2">
            {list.map((row, i) => {
              const typed = field.byType ? (field.byType.fields[text(row[field.byType.key])] ?? []) : field.fields
              return (
                <div key={i} className="rounded-md border bg-card p-3">
                  <FormGrid className="lg:grid-cols-6">
                    {field.byType && (
                      <Select
                        label={field.byType.label}
                        value={text(row[field.byType.key]) || null}
                        options={field.byType.options}
                        onChange={(t) => set(i, { [field.byType!.key]: t })}
                        readOnly={readOnly}
                        placeholder="Pick the kind first"
                        span={2}
                      />
                    )}
                    {typed.map((f) => (
                      <IntakeField key={f.key} field={f} value={row[f.key]} onChange={(x) => set(i, { ...row, [f.key]: x })} readOnly={readOnly} />
                    ))}
                  </FormGrid>
                  {!readOnly && (
                    <div className="mt-2 flex justify-end">
                      <Button type="button" size="xs" variant="ghost" onClick={() => onChange(list.filter((_, j) => j !== i))}>
                        <Trash2Icon />
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
            {!readOnly && (
              <Button type="button" size="sm" variant="outline" onClick={() => onChange([...list, {}])}>
                <PlusIcon />
                Add {field.itemLabel}
              </Button>
            )}
            {readOnly && list.length === 0 && <p className="text-sm text-muted-foreground">None recorded.</p>}
          </div>
        </div>
      )
    }
  }
}
