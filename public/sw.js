// MPS HQ service worker (Inbox fully live, Phase 2c). It only shows push
// notifications and opens MPS HQ when one is clicked. It caches nothing, so
// the app always loads fresh from the site.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const link = typeof data.link === 'string' && data.link.startsWith('/') && !data.link.startsWith('//') ? data.link : '/'
  event.waitUntil(
    self.registration.showNotification(data.title || 'MPS HQ', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { link },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'
  const url = new URL(link, self.location.origin).href
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of open) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus()
          if ('navigate' in c) await c.navigate(url)
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
