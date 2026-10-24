import type * as React from 'react'
import { cn } from 'cn'

export interface SummaryItem {
  label: string
  value: string
  /** Highlight a figure that breaks a limit (e.g. CLTV over 80%). */
  warning?: boolean
}

export interface SummaryBarProps {
  items: SummaryItem[]
  /** The one primary action for the form, usually a Save button. */
  action?: React.ReactNode
  className?: string
}

/** Sticky bar at the bottom of long forms with key figures and one action. */
export function SummaryBar({ items, action, className }: SummaryBarProps) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-4 mt-6 border-t bg-card/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <dl className="flex flex-1 flex-wrap gap-x-6 gap-y-2">
          {items.map((item) => (
            <div key={item.label} className="min-w-20">
              <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{item.label}</dt>
              <dd className={cn('text-sm font-semibold tabular-nums', item.warning && 'text-destructive')}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
        {action}
      </div>
    </div>
  )
}
