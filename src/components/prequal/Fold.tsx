import { useState, type ReactNode } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from 'cn'

/** Open by default on a computer or tablet, closed on a phone (Connor, 2026-11-19: phones start with the side cards collapsed). */
const wideScreen = () => {
  try {
    return window.matchMedia('(min-width: 768px)').matches
  } catch {
    return true
  }
}

/**
 * A card whose header opens and closes it, for the 1003's side cards (Max
 * approval, Credit). `summary` shows in the header while it's closed.
 */
export function CollapsibleCard({ title, summary, children, className }: { title: ReactNode; summary?: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(wideScreen)
  return (
    <section className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-semibold">{title}</span>
          {!open && summary && <span className="truncate text-xs text-muted-foreground">{summary}</span>}
        </span>
        <ChevronDownIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  )
}

/** A row that opens to show more (closed by default), for the compact side cards on the 1003. */
export function Fold({ title, children, defaultOpen = false, className }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cn('border-b last:border-b-0', className)}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:text-foreground">
        <span className="min-w-0">{title}</span>
        <ChevronRightIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </button>
      {open && <div className="space-y-3 pb-3">{children}</div>}
    </div>
  )
}
