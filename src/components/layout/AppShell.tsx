import { useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { MenuIcon, TriangleAlertIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { NewLeadContext, type NewLeadPreset } from '@/components/leads/new-lead-context'
import { NewLeadDialog } from '@/components/leads/NewLeadDialog'
import { useNewMessageAlerts } from '@/components/messages/useNewMessageAlerts'
import { FileTextsHost } from '@/components/messaging/FileTextsHost'
import { MobileAssistantButton } from '@/components/assistant/FileAssistant'
import { FEATURES } from '@/lib/features'
import { NotificationsBell } from '@/components/notifications/NotificationsBell'
import { useMessagesLive } from '@/lib/api/messages'
import { useNotificationsLive } from '@/lib/api/notifications'
import type { CurrentUser } from '@/lib/auth/context'
import { BrandMark } from './BrandMark'
import { Sidebar } from './Sidebar'

const COLLAPSED_KEY = 'losuite.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // Storage blocked (private window etc.): the sidebar just won't remember.
  }
}

export function AppShell({ user, preview }: { user: CurrentUser; preview: boolean }) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  // The pipeline overview and boards use the whole width (Connor, 2026-11-13); the closing calendar keeps the usual page.
  const { pathname } = useLocation()
  const fullWidth = /^\/pipeline(\/(purchase|refinance|heloc))?\/?$/.test(pathname)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [newLeadPreset, setNewLeadPreset] = useState<NewLeadPreset | null>(null)
  // A pop-up for each text or email that comes in while LOSuite is open.
  useNewMessageAlerts()
  // Message lists, unread counts and pop-ups update the moment a message is saved.
  useMessagesLive()
  // The bell's count and list update the moment a notification is made.
  useNotificationsLive()

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      writeCollapsed(!value)
      return !value
    })
  }

  return (
    <NewLeadContext.Provider value={{ openNewLead: (preset) => (setNewLeadPreset(preset ?? null), setNewLeadOpen(true)) }}>
      <div className="flex min-h-svh">
        {/* Desktop sidebar */}
        <div
          className={cn(
            'sticky top-0 hidden h-svh shrink-0 transition-[width] duration-200 md:block',
            collapsed ? 'w-16' : 'w-60',
          )}
        >
          <Sidebar user={user} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 bg-black/30"
              onClick={() => setMobileOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-64 shadow-xl">
              <Sidebar user={user} collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-4 md:hidden">
            <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <MenuIcon />
            </Button>
            <BrandMark />
            <div className="ml-auto flex items-center">
              {FEATURES.assistant && <MobileAssistantButton />}
              <NotificationsBell tone="bar" />
            </div>
          </header>

          {preview && (
            <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 md:px-6">
              <TriangleAlertIcon className="size-3.5 shrink-0" />
              Preview mode: not connected to Supabase yet. Add the dev project keys to .env.local to enable sign-in and saving.
            </div>
          )}

          <main className={fullWidth ? "flex-1 px-4 py-4" : "flex-1 px-4 py-6 md:px-6"}>
            <div className={fullWidth ? "" : "mx-auto max-w-7xl"}>
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      {!preview && <NewLeadDialog open={newLeadOpen} onOpenChange={setNewLeadOpen} preset={newLeadPreset} />}
      {!preview && <FileTextsHost />}
    </NewLeadContext.Provider>
  )
}
