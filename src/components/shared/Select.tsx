import { useId } from 'react'
import { cn } from 'cn'
import {
  Select as BaseSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field, readOnlyClass, type FieldSpan } from './Field'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
}

export interface SelectProps<T extends string = string> {
  label: string
  value: T | null
  onChange?: (value: T) => void
  options: readonly SelectOption<T>[]
  placeholder?: string
  required?: boolean
  readOnly?: boolean
  hint?: string
  error?: string
  span?: FieldSpan
  id?: string
}

/** Labelled dropdown built from an options list. */
export function Select<T extends string = string>({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  required,
  readOnly,
  hint,
  error,
  span,
  id,
}: SelectProps<T>) {
  const autoId = useId()
  const triggerId = id ?? autoId
  return (
    <Field label={label} htmlFor={triggerId} required={required} hint={hint} error={error} span={span}>
      <BaseSelect value={value ?? undefined} onValueChange={(v) => onChange?.(v as T)} disabled={readOnly}>
        <SelectTrigger
          id={triggerId}
          aria-invalid={error ? true : undefined}
          className={cn('w-full', readOnly && cn(readOnlyClass, 'disabled:opacity-100'))}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </BaseSelect>
    </Field>
  )
}
