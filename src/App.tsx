import { createBrowserRouter, Navigate } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/components/layout/AppShell'
import { ConfirmHost } from '@/components/shared/ConfirmDialog'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { queryClient } from '@/lib/api/client'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { useAuth } from '@/lib/auth/context'
import { ComponentLibraryPage } from '@/pages/ComponentLibraryPage'
import { ContactsPage } from '@/pages/ContactsPage'
import { TodayPage } from '@/pages/TodayPage'
import { LoanFileGalleryPage } from '@/pages/LoanFileGalleryPage'
import { LendersPage } from '@/pages/LendersPage'
import { QuickLinksPage } from '@/pages/QuickLinksPage'
import { LoanPage } from '@/pages/LoanPage'
import { IntakePage } from '@/pages/IntakePage'
import { MatrixImportPage } from '@/pages/MatrixImportPage'
import { ProductUpdatePage } from '@/pages/ProductUpdatePage'
import { BusinessMetricsPage } from '@/pages/BusinessMetricsPage'
import { NurtureDashboardPage } from '@/pages/NurtureDashboardPage'
import { ClosedRegisterPage } from '@/pages/ClosedRegisterPage'
import { LoginPage } from '@/pages/LoginPage'
import { PipelinePage } from '@/pages/PipelinePage'
import { ClosingCalendarPage } from '@/pages/ClosingCalendarPage'
import { AssistantPage } from '@/pages/AssistantPage'
import { InboxPage } from '@/pages/InboxPage'
import { PipelineOverviewPage } from '@/pages/PipelineOverviewPage'
import { PipelineBoardPage } from '@/pages/PipelineBoardPage'
import { PartnersPage } from '@/pages/PartnersPage'
import { PageBuilderPage } from '@/pages/PageBuilderPage'
import { PagesPage } from '@/pages/PagesPage'
import { NewOpenHousePage } from '@/pages/NewOpenHousePage'
import { PageSubmissionsPage } from '@/pages/PageSubmissionsPage'
import { PublicPage } from '@/pages/PublicPage'
import { ProductSearchPage } from '@/pages/ProductSearchPage'
import { QuickQuotePage } from '@/pages/QuickQuotePage'
import { RefiBenchmarksPage } from '@/pages/RefiBenchmarksPage'
import { SettingsPage } from '@/pages/SettingsPage'

/** Shows the sign-in page until there's a session, then the app shell (team logins only). */
function AuthGate() {
  const { state } = useAuth()
  if (state.status === 'loading') {
    return <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">Loading…</div>
  }
  if (state.status === 'signedOut') return <LoginPage />
  // A login with no team membership (a borrower's MyHome login, or one not added to the team yet) never reaches the app.
  if (state.status === 'signedIn' && !state.user.organizationId) return <NotOnTeam />
  return <AppShell user={state.user} preview={state.status === 'preview'} />
}

function NotOnTeam() {
  const { signOut } = useAuth()
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-3 rounded-xl border bg-card p-6 text-center shadow-soft">
        <h1 className="text-lg font-bold tracking-tight">This is a MyHome account</h1>
        <p className="text-sm text-muted-foreground">MPS-HQ is for the MPS Mortgage team. To see your loan, go to MyHome.</p>
        <a href="/myhome" className="flex h-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          Go to MyHome
        </a>
        <button type="button" onClick={() => void signOut()} className="text-sm font-medium text-primary underline">
          Sign out
        </button>
        <p className="text-xs text-muted-foreground">On the team? Ask an owner or admin to add this login in Settings → Team & roles.</p>
      </div>
    </div>
  )
}

const router = createBrowserRouter([
  // Public pages need no sign-in (main.tsx normally loads PublicApp for these).
  { path: 'p/:slug', element: <PublicPage /> },
  {
    element: <AuthGate />,
    children: [
      { index: true, element: <TodayPage /> },
      { path: 'inbox', element: <InboxPage /> },
      { path: 'pipeline', element: <PipelineOverviewPage /> },
      { path: 'pipeline/purchase', element: <PipelineBoardPage /> },
      { path: 'pipeline/refinance', element: <PipelineBoardPage /> },
      { path: 'pipeline/heloc', element: <PipelineBoardPage /> },
      { path: 'pipeline/closings', element: <ClosingCalendarPage /> },
      { path: 'nurture', element: <NurtureDashboardPage /> },
      { path: 'pipeline/:pipelineId', element: <PipelinePage /> },
      { path: 'contacts', element: <ContactsPage /> },
      { path: 'partners', element: <PartnersPage /> },
      { path: 'pages', element: <PagesPage /> },
      { path: 'pages/open-house/new', element: <NewOpenHousePage /> },
      { path: 'pages/:pageId', element: <PageBuilderPage /> },
      { path: 'pages/:pageId/submissions', element: <PageSubmissionsPage /> },
      { path: 'assistant', element: <AssistantPage /> },
      { path: 'loans/:loanId', element: <LoanPage /> },
      { path: 'loans/:loanId/intake', element: <IntakePage /> },
      { path: 'product-search', element: <ProductSearchPage /> },
      { path: 'quick-quote', element: <QuickQuotePage /> },
      { path: 'quick-links', element: <QuickLinksPage /> },
      { path: 'admin/lenders', element: <LendersPage /> },
      { path: 'admin/lenders/imports/:importId', element: <MatrixImportPage /> },
      { path: 'admin/lenders/updates/:updateId', element: <ProductUpdatePage /> },
      { path: 'closed-register', element: <ClosedRegisterPage /> },
      { path: 'admin/metrics', element: <BusinessMetricsPage /> },
      { path: 'refi-watch/benchmarks', element: <RefiBenchmarksPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'dev/components', element: <ComponentLibraryPage /> },
      { path: 'dev/loan-file', element: <LoanFileGalleryPage /> },
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
          {/* An × on every message, so one that stays (the timer pauses while the pointer is over it) can be closed. */}
          <Toaster position="bottom-right" closeButton duration={5000} />
          <ConfirmHost />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
