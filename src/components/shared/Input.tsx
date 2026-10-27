import { useId } from 'react'
import type * as React from 'react'
import { cn } from 'cn'
import { Input as BaseInput } from '@/components/ui/input'
import { Field, readOnlyClass, type FieldSpan } from './Field'

export interface InputProps extends Omit<React.ComponentProps<'input'>, 'onChange' | 'value'> {
  label: string
  value: string
  onChange?: (value: string) => void
  hint?: string
  error?: string
  span?: FieldSpan
  /** Keep the label for screen readers only (e.g. inside a table). */
  hideLabel?: boolean
}

/** Labelled text input. Pass `readOnly` for calculated values. */
export function Input({ label, value, onChange, hint, error, span, hideLabel, required, readOnly, className, id, ...props }: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <Field label={label} htmlFor={inputId} required={required} hint={hint} error={error} span={span} hideLabel={hideLabel}>
      <BaseInput
        id={inputId}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        required={required}
        readOnly={readOnly}
        tabIndex={readOnly ? -1 : undefined}
        aria-invalid={error ? true : undefined}
        className={cn(readOnly && readOnlyClass, className)}
        {...props}
      />
    </Field>
  )
}
