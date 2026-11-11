// The public side of MPS-HQ: /p/{slug} pages (Pages, 2026-11-06) and /e/{token}
// shared estimates (build plan Phase 7). main.tsx loads this instead of the
// whole app for those addresses, so a visitor's phone downloads only what the
// page needs. No sign-in, no shell.
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { PublicEstimatePage } from '@/pages/PublicEstimatePage'
import { PublicPage } from '@/pages/PublicPage'

const router = createBrowserRouter([
  { path: '/p/:slug', element: <PublicPage /> },
  { path: '/e/:token', element: <PublicEstimatePage /> },
])

export default function PublicApp() {
  return <RouterProvider router={router} />
}
