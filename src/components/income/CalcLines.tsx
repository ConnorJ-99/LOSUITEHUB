import { TriangleAlertIcon } from 'lucide-react'
import { cn } from 'cn'
import type { IncomeLine } from '@/lib/calc'
import { formatCurrency } from '@/lib/format'

/** A worksheet's math, one line per step, so the LO can explain the figure. */
export function CalcLines({ lines, className }: { lines: IncomeLine[]; className?: string }) {
  return (
    <dl className={cn('divide-y rounded-lg border text-sm', className)}>
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            'flex items-baseline justify-between gap-3 px-3 py-1.5',
            line.kind === 'subtotal' && 'bg-muted/40 font-medium',
            line.kind === 'result' && 'bg-accent font-semibold text-accent-foreground',
          )}
        >
          <dt className={cn('min-w-0', (line.kind === 'add' || line.kind === 'subtract') && 'pl-3 text-muted-foreground')}>
            {line.kind === 'add' && '+ '}
            {line.label}
          </dt>
          <dd className={cn('shrink-0 tabular-nums', line.amount < 0 && 'text-destructive')}>{formatCurrency(line.amount)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      {warnings.map((w) => (
        <li key={w} className="flex gap-2">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
          {w}
        </li>
      ))}
    </ul>
  )
}
