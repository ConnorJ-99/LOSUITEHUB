import { cn } from 'cn'
import logo from '@/assets/mps-hq-logo.webp'

/** The MPS HQ mark (rising bars under a roof line); the roof is white on the navy sidebar. */
function Mark({ tone, className }: { tone: 'light' | 'dark'; className?: string }) {
  return (
    <svg viewBox="150 140 370 380" aria-hidden className={className}>
      <path d="M200 378 L204 304 L466 186 L440 494" fill="none" stroke={tone === 'dark' ? '#FFFFFF' : '#0C1D36'} strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M168 412 L236 402 L240 500 L166 500 Z M252 354 L326 344 L330 500 L250 500 Z M338 296 L414 286 L418 500 L334 500 Z" fill={tone === 'dark' ? '#5AA9E6' : '#1670BE'} />
    </svg>
  )
}

/** MPS HQ logo used in the sidebar, the phone top bar and on the sign-in page; "dark" sits on the navy sidebar. */
export function BrandMark({ collapsed = false, tone = 'light', className }: { collapsed?: boolean; tone?: 'light' | 'dark'; className?: string }) {
  if (tone === 'light' && !collapsed) {
    return (
      <div className={cn('flex items-center', className)}>
        <img src={logo} alt="MPS HQ" className="h-9 w-auto" />
      </div>
    )
  }
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Mark tone={tone} className="size-8 shrink-0" />
      {!collapsed && (
        <div className="leading-tight">
          <p className={cn('text-sm font-bold', tone === 'dark' && 'text-white')}>
            MPS <span className={tone === 'dark' ? 'text-sky-300' : 'text-primary'}>HQ</span>
          </p>
          <p className={cn('text-[10px] font-medium tracking-[0.14em] uppercase', tone === 'dark' ? 'text-sidebar-foreground/60' : 'text-muted-foreground')}>MPS Mortgage</p>
        </div>
      )}
    </div>
  )
}
