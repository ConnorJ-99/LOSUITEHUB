// The public side of MPS-HQ: /p/{slug} pages (Pages, 2026-11-06). main.tsx
// loads this instead of the whole app when the address is a page, so a
// visitor's phone downloads only what the page needs. No sign-in, no shell.
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { PublicPage } from '@/pages/PublicPage'

const router = createBrowserRouter([{ path: '/p/:slug', element: <PublicPage /> }])

export default function PublicApp() {
  return <RouterProvider router={router} />
}
