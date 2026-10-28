import type * as React from 'react'

/** Title row at the top of every page: an optional small label above ("— LENDERS"), the title, a description and actions. */
export function PageHeader({ title, description, action, eyebrow }: { title: string; description?: string; action?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="text-[28px] leading-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
