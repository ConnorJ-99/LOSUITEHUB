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
  /** Adds a "Not set" choice that empties the field. */
  onClear?: () => void
}

const NOT_SET = '__not_set__'

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
  onClear,
}: SelectProps<T>) {
  const autoId = useId()
  const triggerId = id ?? autoId
  return (
    <Field label={label} htmlFor={triggerId} required={required} hint={hint} error={error} span={span}>
      <BaseSelect
        // A clearable field stays controlled with '' so clearing shows the placeholder again.
        value={value ?? (onClear ? '' : undefined)}
        onValueChange={(v) => (v === NOT_SET ? onClear?.() : onChange?.(v as T))}
        disabled={readOnly}
      >
        <SelectTrigger
          id={triggerId}
          aria-invalid={error ? true : undefined}
          className={cn('w-full', readOnly && cn(readOnlyClass, 'disabled:opacity-100'))}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper">
          {onClear && value !== null && (
            <SelectItem value={NOT_SET} className="text-muted-foreground">
              Not set
            </SelectItem>
          )}
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
