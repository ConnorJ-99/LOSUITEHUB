import { createBrowserRouter, Navigate } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { BuildingIcon, KanbanIcon, SearchIcon, SettingsIcon, UsersIcon } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { useAuth } from '@/lib/auth/context'
import { ComponentLibraryPage } from '@/pages/ComponentLibraryPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { LoginPage } from '@/pages/LoginPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'

/** Shows the sign-in page until there's a session, then the app shell. */
function AuthGate() {
  const { state } = useAuth()
  if (state.status === 'loading') {
    return <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">Loading…</div>
  }
  if (state.status === 'signedOut') return <LoginPage />
  return <AppShell user={state.user} preview={state.status === 'preview'} />
}

const router = createBrowserRouter([
  {
    element: <AuthGate />,
    children: [
      { index: true, element: <DashboardPage /> },
      {
        path: 'pipeline',
        element: (
          <PlaceholderPage
            title="Pipeline"
            phase="Phase 1"
            icon={KanbanIcon}
            description="Board and list views of every lead and client by stage, with search and filters."
          />
        ),
      },
      {
        path: 'contacts',
        element: (
          <PlaceholderPage
            title="Contacts"
            phase="Phase 1"
            icon={UsersIcon}
            description="One record per person, from first contact through closing and beyond."
          />
        ),
      },
      {
        path: 'product-search',
        element: (
          <PlaceholderPage
            title="Product Search"
            phase="Phase 5"
            icon={SearchIcon}
            description="Rule-based eligibility search across your lenders' programs, with the exact reason any program is excluded."
          />
        ),
      },
      {
        path: 'admin/lenders',
        element: (
          <PlaceholderPage
            title="Lenders & Programs"
            phase="Phase 5"
            icon={BuildingIcon}
            description="Add and edit lenders, programs and eligibility matrices without code."
          />
        ),
      },
      {
        path: 'settings',
        element: (
          <PlaceholderPage
            title="Settings"
            phase="a later phase"
            icon={SettingsIcon}
            description="Organization details, team members and roles."
          />
        ),
      },
      { path: 'dev/components', element: <ComponentLibraryPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  return (
    <AuthProvider>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </AuthProvider>
  )
}
