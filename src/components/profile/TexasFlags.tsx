import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import { cn } from 'cn'
import type { TexasFlag } from '@/lib/calc'

const style = {
  error: { icon: CircleAlertIcon, className: 'border-destructive/30 bg-destructive/5 text-destructive' },
  warning: { icon: TriangleAlertIcon, className: 'border-amber-200 bg-amber-50 text-amber-900' },
  info: { icon: InfoIcon, className: 'border-border bg-card text-foreground' },
} as const

/** Texas §50(a)(6) home equity reminders. Shown only when the rules apply. */
export function TexasFlags({ flags }: { flags: TexasFlag[] }) {
  if (flags.length === 0) return null
  return (
    <section aria-label="Texas home equity rules" className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Texas home equity §50(a)(6)</p>
      {flags.map((flag) => {
        const { icon: Icon, className } = style[flag.severity]
        return (
          <div key={flag.code} className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm', className)}>
            <Icon className="mt-0.5 size-4 shrink-0" />
            <p>{flag.message}</p>
          </div>
        )
      })}
    </section>
  )
}
