import type * as React from 'react'
import { NavLink } from 'react-router'
import { ChevronsLeftIcon, ChevronsRightIcon, LogOutIcon, PlusIcon } from 'lucide-react'
import { cn } from 'cn'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNewLead } from '@/components/leads/new-lead-context'
import { roleLabels, useAuth, type CurrentUser } from '@/lib/auth/context'
import { BrandMark } from './BrandMark'
import { navSections } from './nav'

function initials(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase()
}

/** Shows a tooltip with the label only when the sidebar is collapsed. */
function MaybeTooltip({ label, show, children }: { label: string; show: boolean; children: React.ReactElement }) {
  if (!show) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export interface SidebarProps {
  user: CurrentUser
  collapsed: boolean
  onToggleCollapsed?: () => void
  /** Called after navigating, so the mobile drawer can close itself. */
  onNavigate?: () => void
}

export function Sidebar({ user, collapsed, onToggleCollapsed, onNavigate }: SidebarProps) {
  const { signOut } = useAuth()
  const { openNewLead } = useNewLead()

  return (
    <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn('flex h-14 items-center border-b px-3', collapsed ? 'justify-center' : 'justify-between')}>
        <BrandMark collapsed={collapsed} />
        {onToggleCollapsed && !collapsed && (
          <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} aria-label="Collapse sidebar">
            <ChevronsLeftIcon />
          </Button>
        )}
      </div>

      <div className="p-3">
        <MaybeTooltip label="New Lead" show={collapsed}>
          <Button
            className={cn('w-full', collapsed && 'px-0')}
            onClick={() => {
              onNavigate?.()
              openNewLead()
            }}
            aria-label="New Lead"
          >
            <PlusIcon />
            {!collapsed && 'New Lead'}
          </Button>
        </MaybeTooltip>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        {navSections.map((section, i) => (
          <div key={section.label ?? i} className="space-y-0.5">
            {section.label && !collapsed && (
              <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {section.label}
              </p>
            )}
            {section.items.map((item) => (
              <MaybeTooltip key={item.to} label={item.label} show={collapsed}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors',
                      collapsed && 'justify-center',
                      isActive
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" />
                  {!collapsed && item.label}
                </NavLink>
              </MaybeTooltip>
            ))}
          </div>
        ))}
      </nav>

      {onToggleCollapsed && collapsed && (
        <div className="flex justify-center pb-2">
          <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} aria-label="Expand sidebar">
            <ChevronsRightIcon />
          </Button>
        </div>
      )}

      <div className="border-t p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-muted',
                collapsed && 'justify-center',
              )}
            >
              <Avatar className="size-8">
                <AvatarFallback className="bg-accent text-xs text-accent-foreground">
                  {initials(user.fullName)}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-sm font-medium">{user.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.role ? roleLabels[user.role] : 'No organization yet'}
                  </p>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">{user.fullName}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
              {user.organizationName && <p className="text-xs text-muted-foreground">{user.organizationName}</p>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()}>
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}
