// The public side of MPS-HQ: /p/{slug} pages (Pages, 2026-11-06), /e/{token}
// shared estimates (build plan Phase 7) and /u/{token} upload links (UI pass
// Part 3). main.tsx loads this instead of the whole app for those addresses,
// so a visitor's phone downloads only what the page needs. No sign-in, no shell.
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { PublicEstimatePage } from '@/pages/PublicEstimatePage'
import { PublicPage } from '@/pages/PublicPage'
import { PublicUploadPage } from '@/pages/PublicUploadPage'

const router = createBrowserRouter([
  { path: '/p/:slug', element: <PublicPage /> },
  { path: '/e/:token', element: <PublicEstimatePage /> },
  { path: '/u/:token', element: <PublicUploadPage /> },
])

export default function PublicApp() {
  return <RouterProvider router={router} />
}
