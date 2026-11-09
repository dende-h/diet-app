// ホーム画面に追加して使うための最小限のService Worker。
// デプロイ後すぐに新しい版が出るよう、ページ本体はネットワーク優先にする。
const CACHE = 'herulog-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// ---- 通知（夜のまとめ） ----
// サーバーが送る本文は { title, body, date }。記録の中身は入っていない

self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    // 本文が読めなくても、通知は出す（iPhoneでは出さないと購読を止められることがある）
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'へるログ', {
      body: message.body || '',
      icon: '/icons/icon-192.png',
      lang: 'ja',
      tag: message.date ? `review-${message.date}` : 'herulog',
      data: { date: message.date || null },
    }),
  )
})

// 通知を押したら、開いているアプリを前に出してその日を表示する（開いていなければ開く）
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const date = event.notification.data && event.notification.data.date
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (open) {
        if (date) open.postMessage({ type: 'open-date', date })
        return open.focus()
      }
      return self.clients.openWindow(date ? `/?date=${date}` : '/')
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  // ビルド成果物はファイル名にハッシュが付くのでキャッシュ優先
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone()
            if (res.ok) void caches.open(CACHE).then((c) => c.put(req, copy))
            return res
          }),
      ),
    )
    return
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          if (res.ok) void caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    )
  }
})
