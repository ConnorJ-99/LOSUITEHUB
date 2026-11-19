import { useId } from 'react'
import { cn } from 'cn'
import { Input as BaseInput } from '@/components/ui/input'
import { Field, readOnlyClass, type FieldSpan } from './Field'

export interface DateInputProps {
  /** AI Fill: the 1003 key this field saves to (shows the AI tag while AI-filled). */
  aiKey?: string
  label: string
  /** YYYY-MM-DD or null. */
  value: string | null
  onChange?: (value: string | null) => void
  required?: boolean
  readOnly?: boolean
  hint?: string
  error?: string
  span?: FieldSpan
  className?: string
}

/** Calendar date field using the device's native date picker (works well on phones). */
export function DateInput({ label, aiKey, value, onChange, required, readOnly, hint, error, span, className }: DateInputProps) {
  const id = useId()
  return (
    <Field aiKey={aiKey} label={label} htmlFor={id} required={required} hint={hint} error={error} span={span} className={className}>
      <BaseInput
        id={id}
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value || null)}
        required={required}
        readOnly={readOnly}
        tabIndex={readOnly ? -1 : undefined}
        aria-invalid={error ? true : undefined}
        className={cn('tabular-nums', readOnly && readOnlyClass)}
      />
    </Field>
  )
}
