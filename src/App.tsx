import { createBrowserRouter, Navigate } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { BuildingIcon, SearchIcon } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { queryClient } from '@/lib/api/client'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { useAuth } from '@/lib/auth/context'
import { ComponentLibraryPage } from '@/pages/ComponentLibraryPage'
import { ContactsPage } from '@/pages/ContactsPage'
import { TodayPage } from '@/pages/TodayPage'
import { LoanPage } from '@/pages/LoanPage'
import { LoginPage } from '@/pages/LoginPage'
import { PipelinePage } from '@/pages/PipelinePage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { SettingsPage } from '@/pages/SettingsPage'

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
      { index: true, element: <TodayPage /> },
      { path: 'pipeline', element: <PipelinePage /> },
      { path: 'contacts', element: <ContactsPage /> },
      { path: 'loans/:loanId', element: <LoanPage /> },
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
      { path: 'settings', element: <SettingsPage /> },
      { path: 'dev/components', element: <ComponentLibraryPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
