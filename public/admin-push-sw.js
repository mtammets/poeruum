// This worker handles notifications only; admin pages and API responses are never cached.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('push', (event) => {
  let notice = {}
  try { notice = event.data?.json() ?? {} } catch { /* Still display a visible notification. */ }
  event.waitUntil(self.registration.showNotification(notice.title || 'Poeruum', {
    body: notice.body || 'Adminis on uut infot.',
    icon: '/images/admin-icon-192.png',
    tag: notice.tag || 'poeruum-admin',
    data: { url: '/admin' },
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const admin = windows.find((client) => {
      const url = new URL(client.url)
      return url.origin === self.location.origin && (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))
    })
    if (admin) {
      await admin.navigate('/admin')
      return admin.focus()
    }
    return self.clients.openWindow('/admin')
  })())
})
