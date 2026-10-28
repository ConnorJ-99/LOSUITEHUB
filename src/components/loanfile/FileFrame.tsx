import type * as React from 'react'
import { Link } from 'react-router'
import { ArrowLeftIcon, CheckCircle2Icon, ChevronDownIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, type LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'

// The frame around a loan file: the sticky header and the left file
// navigation (a scrolling tab bar on phones). Presentational only.

export interface FileHeaderProps {
  borrowerName: string
  /** Small chip after the name, e.g. the Arive loan number. */
  fileNumber?: string | null
  statusLabel: string
  /** Accent chip, e.g. "Send disclosures · Loan Officer · 3d". */
  nextStep?: string | null
  updatedLabel?: string
  detailsOpen: boolean
  onToggleDetails: () => void
  onSave?: () => void
  saveDisabled?: boolean
  onChangeStatus?: () => void
  backTo?: string
  /** Extra buttons on the second line (e.g. Edit and the stage menu). */
  actions?: React.ReactNode
  /** A full-width notice under the chips, e.g. why the file was lost. */
  notice?: React.ReactNode
  /** Metrics strip, milestone stepper and team row, shown when details are open. */
  children?: React.ReactNode
}

/** Header on every borrower page: name, chips and actions stay pinned at the top; the details (metrics, milestones, team) sit below and scroll with the page. */
export function FileHeader({ borrowerName, fileNumber, statusLabel, nextStep, updatedLabel, detailsOpen, onToggleDetails, onSave, saveDisabled, onChangeStatus, backTo = '/pipeline', actions, notice, children }: FileHeaderProps) {
  return (
    <>
      <header className="sticky top-0 z-20 -mx-4 space-y-2 border-b bg-card/95 px-4 pt-3 pb-2.5 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="size-4" />
            Pipeline
          </Link>
          <h1 className="text-2xl leading-tight">{borrowerName}</h1>
          {fileNumber && <span className="rounded border px-1.5 py-0.5 font-mono text-[0.7rem] text-muted-foreground">{fileNumber}</span>}
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">{statusLabel}</span>
          {nextStep && <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{nextStep}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {updatedLabel && <span>{updatedLabel}</span>}
          <button type="button" onClick={onToggleDetails} aria-expanded={detailsOpen} className="inline-flex items-center gap-1 hover:text-foreground">
            {detailsOpen ? 'Hide details' : 'Show details'}
            <ChevronDownIcon className={cn('size-3.5 transition-transform', detailsOpen && 'rotate-180')} />
          </button>
          <div className="ml-auto flex gap-2">
            {actions}
            {onSave && (
              <Button size="sm" onClick={onSave} disabled={saveDisabled}>
                Save
              </Button>
            )}
            {onChangeStatus && (
              <Button size="sm" variant="outline" onClick={onChangeStatus}>
                Change status
              </Button>
            )}
          </div>
        </div>
      </header>
      {(notice || (detailsOpen && children)) && (
        <div className="-mx-4 space-y-3 border-b bg-card px-4 py-3 md:-mx-6 md:px-6">
          {notice}
          {detailsOpen && children}
        </div>
      )}
    </>
  )
}

export interface FileNavItem {
  id: string
  label: string
  icon: LucideIcon
  /** Greyed out with this note (e.g. "Coming in Phase 8") until the section exists. */
  disabledNote?: string
  /** Red count for missing items, green check when complete, amber dot when something needs review. */
  marker?: { type: 'count'; value: number } | { type: 'complete' } | { type: 'review' }
}

function Marker({ marker }: { marker: FileNavItem['marker'] }) {
  if (!marker) return null
  if (marker.type === 'count')
    return marker.value > 0 ? <span className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-600 px-1 text-[0.65rem] font-semibold text-white tabular-nums">{marker.value}</span> : null
  if (marker.type === 'complete') return <CheckCircle2Icon className="ml-auto size-4 text-emerald-600" aria-label="Complete" />
  return <span className="ml-auto size-2 rounded-full bg-amber-500" aria-label="Needs review" />
}

/**
 * The loan file's sections. On desktop a left list (collapsible to icons);
 * on phones a horizontally scrolling tab bar under the header.
 */
export function FileNav({ items, active, onSelect, collapsed, onToggleCollapsed }: { items: FileNavItem[]; active: string; onSelect: (id: string) => void; collapsed?: boolean; onToggleCollapsed?: () => void }) {
  return (
    <>
      <nav aria-label="File sections" className="-mx-4 overflow-x-auto border-b px-4 md:hidden">
        <ul className="flex min-w-max gap-1 py-1.5">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                disabled={!!it.disabledNote}
                title={it.disabledNote}
                onClick={() => onSelect(it.id)}
                className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap disabled:opacity-40', active === it.id ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground')}
              >
                {it.label}
                <Marker marker={it.marker} />
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="File sections" className={cn('hidden shrink-0 md:block', collapsed ? 'w-12' : 'w-52')}>
        <div className="sticky top-4 space-y-0.5">
          {onToggleCollapsed && (
            <div className={cn('flex pb-1', collapsed ? 'justify-center' : 'justify-end')}>
              <Button size="icon-sm" variant="ghost" onClick={onToggleCollapsed} aria-label={collapsed ? 'Show file navigation' : 'Hide file navigation'}>
                {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
              </Button>
            </div>
          )}
          {items.map((it) => {
            const Icon = it.icon
            return (
              <button
                key={it.id}
                type="button"
                title={it.disabledNote ?? (collapsed ? it.label : undefined)}
                disabled={!!it.disabledNote}
                onClick={() => onSelect(it.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40',
                  active === it.id ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  collapsed && 'justify-center px-0',
                )}
              >
                <span className="relative">
                  <Icon className="size-4" />
                  {collapsed && it.marker && it.marker.type !== 'complete' && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-red-600" />}
                </span>
                {!collapsed && (
                  <>
                    {it.label}
                    <Marker marker={it.marker} />
                  </>
                )}
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}
