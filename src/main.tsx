import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// The service worker only shows push notifications (public/sw.js); it caches nothing.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // No push on this browser; everything else works.
    })
  })
}

// A public page (/p/{slug}) or shared estimates (/e/{token}) loads only the page, not the whole app.
const isPublicPage = /^\/[pe]\/[^/]+\/?$/.test(window.location.pathname)
const root = createRoot(document.getElementById('root')!)
void (isPublicPage ? import('./PublicApp.tsx') : import('./App.tsx')).then(({ default: Root }) =>
  root.render(
    <StrictMode>
      <Root />
    </StrictMode>,
  ),
)
