import { useId } from 'react'
import type * as React from 'react'
import { Textarea as BaseTextarea } from '@/components/ui/textarea'
import { Field, type FieldSpan } from './Field'

export interface TextAreaProps extends Omit<React.ComponentProps<'textarea'>, 'onChange' | 'value'> {
  label: string
  value: string
  onChange?: (value: string) => void
  hint?: string
  error?: string
  span?: FieldSpan
}

/** Labelled multi-line text input. */
export function TextArea({ label, value, onChange, hint, error, span, required, id, ...props }: TextAreaProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <Field label={label} htmlFor={inputId} required={required} hint={hint} error={error} span={span}>
      <BaseTextarea
        id={inputId}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        required={required}
        aria-invalid={error ? true : undefined}
        {...props}
      />
    </Field>
  )
}
