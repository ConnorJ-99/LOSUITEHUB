import { cn } from 'cn'

/** MPS Mortgage wordmark used in the sidebar and on the sign-in page. */
export function BrandMark({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[11px] font-bold tracking-wide text-primary-foreground">
        MPS
      </div>
      {!collapsed && (
        <div className="leading-tight">
          <p className="text-sm font-semibold">LOSuite</p>
          <p className="text-[11px] text-muted-foreground">MPS Mortgage LLC</p>
        </div>
      )}
    </div>
  )
}
