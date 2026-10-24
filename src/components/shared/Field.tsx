import type * as React from 'react'
import { cn } from 'cn'
import { Label } from '@/components/ui/label'

/** Column span inside a FormGrid (the grid is up to 6 columns wide). */
export type FieldSpan = 1 | 2 | 3 | 4 | 5 | 6

const spanClass: Record<FieldSpan, string> = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'sm:col-span-2 lg:col-span-3',
  4: 'sm:col-span-2 lg:col-span-4',
  5: 'sm:col-span-2 lg:col-span-5',
  6: 'sm:col-span-2 lg:col-span-6',
}

/** Responsive form grid: 1 column on phones, 2 on tablets, 6 on desktop. */
export function FormGrid({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-6', className)} {...props} />
}

export interface FieldProps {
  label: string
  htmlFor?: string
  required?: boolean
  hint?: string
  error?: string
  span?: FieldSpan
  className?: string
  children: React.ReactNode
}

/** Label + control + hint/error. Required fields get a red asterisk. */
export function Field({ label, htmlFor, required, hint, error, span = 1, className, children }: FieldProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', spanClass[span], className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

/** Shared styles for calculated, read-only inputs: greyed out and skipped by Tab. */
export const readOnlyClass = 'bg-muted text-muted-foreground cursor-default focus-visible:ring-0 focus-visible:border-input'
