import { useId, useState } from 'react'
import { cn } from 'cn'
import { Input as BaseInput } from '@/components/ui/input'
import { formatNumber, parseNumber } from '@/lib/format'
import { Field, readOnlyClass, type FieldSpan } from './Field'

interface AffixedNumberInputProps {
  label: string
  value: number | null
  onChange?: (value: number | null) => void
  required?: boolean
  readOnly?: boolean
  placeholder?: string
  hint?: string
  error?: string
  span?: FieldSpan
  id?: string
  prefix?: string
  suffix?: string
  maxDecimals: number
}

/**
 * Number field that shows "1,250,000" while idle and the raw number while
 * typing. Values go in and out as numbers (or null when empty), never strings.
 */
function AffixedNumberInput({
  label,
  value,
  onChange,
  required,
  readOnly,
  placeholder,
  hint,
  error,
  span,
  id,
  prefix,
  suffix,
  maxDecimals,
}: AffixedNumberInputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? formatNumber(value, maxDecimals)

  return (
    <Field label={label} htmlFor={inputId} required={required} hint={hint} error={error} span={span}>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground">
            {prefix}
          </span>
        )}
        <BaseInput
          id={inputId}
          inputMode="decimal"
          value={shown}
          placeholder={placeholder}
          required={required}
          readOnly={readOnly}
          tabIndex={readOnly ? -1 : undefined}
          aria-invalid={error ? true : undefined}
          onFocus={() => !readOnly && setDraft(value == null ? '' : String(value))}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value)
            onChange?.(parseNumber(e.target.value))
          }}
          className={cn('tabular-nums', prefix && 'pl-6', suffix && 'pr-7', readOnly && readOnlyClass)}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </Field>
  )
}

export type CurrencyInputProps = Omit<AffixedNumberInputProps, 'prefix' | 'suffix' | 'maxDecimals'>
export type PercentInputProps = Omit<AffixedNumberInputProps, 'prefix' | 'suffix' | 'maxDecimals'> & {
  maxDecimals?: number
}

/** Dollar amount input. */
export function CurrencyInput(props: CurrencyInputProps) {
  return <AffixedNumberInput {...props} prefix="$" maxDecimals={2} />
}

/** Percent input; the value is a percent number (6.5 means 6.5%). */
export function PercentInput({ maxDecimals = 3, ...props }: PercentInputProps) {
  return <AffixedNumberInput {...props} suffix="%" maxDecimals={maxDecimals} />
}
