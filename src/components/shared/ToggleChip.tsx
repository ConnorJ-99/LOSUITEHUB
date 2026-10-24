import type * as React from 'react'
import { CheckIcon } from 'lucide-react'
import { cn } from 'cn'

export interface ToggleChipProps {
  label: string
  pressed: boolean
  onChange?: (pressed: boolean) => void
  disabled?: boolean
  className?: string
}

/** On/off flag shown as a pill. Used instead of checkboxes everywhere. */
export function ToggleChip({ label, pressed, onChange, disabled, className }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onChange?.(!pressed)}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors outline-none select-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground',
        className,
      )}
    >
      {pressed && <CheckIcon className="size-3.5" />}
      {label}
    </button>
  )
}

/** A wrapping row of ToggleChips. */
export function ToggleChipGroup({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex flex-wrap gap-2', className)}>{children}</div>
}
