import { useId } from 'react'
import { SearchIcon } from 'lucide-react'
import { Input as BaseInput } from '@/components/ui/input'
import { Field, type FieldSpan } from './Field'

export interface SearchInputProps {
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  span?: FieldSpan
  className?: string
}

/** Text input with a search icon, for filtering lists. */
export function SearchInput({ label = 'Search', value, onChange, placeholder, span, className }: SearchInputProps) {
  const id = useId()
  return (
    <Field label={label} htmlFor={id} span={span} className={className}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <BaseInput
          id={id}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-8"
        />
      </div>
    </Field>
  )
}
