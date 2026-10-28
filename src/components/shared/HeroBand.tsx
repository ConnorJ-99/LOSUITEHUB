import type * as React from 'react'
import { Link } from 'react-router'
import { ArrowRightIcon, type LucideIcon } from 'lucide-react'
import { cn } from 'cn'

/** The navy band at the top of a home page: a small label, a large greeting (one part in the accent blue), a line under it and actions. */
export function HeroBand({ eyebrow, title, highlight, subtitle, action }: { eyebrow: string; title: string; highlight?: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="relative mb-5 overflow-hidden rounded-2xl bg-navy px-6 py-7 text-navy-foreground shadow-soft">
      {/* A faint grid, like drafting paper. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:32px_32px]" />
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary/30 blur-3xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-sky-300">{eyebrow}</p>
          <h1 className="mt-2 text-3xl leading-tight md:text-4xl">
            {title}
            {highlight && <span className="text-sky-400"> {highlight}</span>}
          </h1>
          {subtitle && <div className="mt-2 text-sm text-white/70">{subtitle}</div>}
        </div>
        {action && <div className="flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  )
}

/** A wide shortcut card: an icon tile, a title, one line and an arrow. Goes to a page or runs an action. */
export function QuickAction({ icon: Icon, title, description, to, onClick, tone = 'blue' }: { icon: LucideIcon; title: string; description: string; to?: string; onClick?: () => void; tone?: 'blue' | 'green' }) {
  const body = (
    <>
      <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm', tone === 'green' ? 'bg-emerald-600' : 'bg-primary')}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <ArrowRightIcon className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
    </>
  )
  const className = cn(
    'group flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left shadow-soft transition-colors',
    tone === 'green' ? 'border-emerald-200 bg-emerald-50/70 hover:bg-emerald-50' : 'border-sky-200 bg-sky-50/70 hover:bg-sky-50',
  )
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  )
}

/** A section title with a small label above it and one word in the accent blue ("Pipeline snapshot"). */
export function SectionTitle({ eyebrow, title, highlight, action }: { eyebrow?: string; title: string; highlight?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-2">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="mt-1 text-lg font-bold tracking-tight">
          {title}
          {highlight && <span className="text-primary"> {highlight}</span>}
        </h2>
      </div>
      {action}
    </div>
  )
}
