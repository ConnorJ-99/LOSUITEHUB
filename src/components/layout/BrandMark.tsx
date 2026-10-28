import { cn } from 'cn'

/** MPS Mortgage wordmark used in the sidebar and on the sign-in page; "dark" sits on the navy sidebar. */
export function BrandMark({ collapsed = false, tone = 'light', className }: { collapsed?: boolean; tone?: 'light' | 'dark'; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[11px] font-bold tracking-wide text-primary-foreground">
        MPS
      </div>
      {!collapsed && (
        <div className="leading-tight">
          <p className={cn('text-sm font-bold', tone === 'dark' && 'text-white')}>LOSuite</p>
          <p className={cn('text-[10px] font-medium tracking-[0.14em] uppercase', tone === 'dark' ? 'text-sidebar-foreground/60' : 'text-muted-foreground')}>MPS Mortgage</p>
        </div>
      )}
    </div>
  )
}
