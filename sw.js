// ════════════════════════════════════════════════════════════════
//  HEYCAT Service Worker
//  Strategy:
//    • App shell (HTML, fonts, CDN scripts) → Cache-First
//    • Supabase API / Storage               → Network-First (never cached)
//    • Google Fonts CSS                     → Stale-While-Revalidate
// ════════════════════════════════════════════════════════════════

const CACHE_NAME    = 'heycat-v1';
const RUNTIME_CACHE = 'heycat-runtime-v1';

// Files that form the app shell — cached on install
const APP_SHELL = [
  '/',
  '/index.html',
];

// CDN resources fetched at runtime — cached on first use
const CDN_ORIGINS = [
  'https://cdn.jsdelivr.net',    // supabase-js
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// These origins must NEVER be cached — always go to network
const NEVER_CACHE_ORIGINS = [
  'https://dwemfkxegzuwvlmzzfnd.supabase.co', // Supabase REST / realtime / storage
];

// ── INSTALL: pre-cache the app shell ─────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())   // activate immediately on first install
  );
});

// ── ACTIVATE: delete stale caches ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())  // take control of all open tabs
  );
});

// ── FETCH: routing logic ──────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Non-GET requests (POST/PUT/DELETE) → always network, never cache
  if (request.method !== 'GET') return;

  // 2. Supabase API / Storage → always network (live data, auth tokens)
  if (NEVER_CACHE_ORIGINS.some(o => request.url.startsWith(o))) return;

  // 3. App shell HTML → Cache-First, fall back to network
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // 4. CDN resources (supabase-js, Google Fonts) → Stale-While-Revalidate
  if (CDN_ORIGINS.some(o => request.url.startsWith(o))) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // 5. Everything else (same-origin assets) → Stale-While-Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
  // (anything else falls through to the browser's default behaviour)
});

// ════════════════════════════════════════
//  Strategy helpers
// ════════════════════════════════════════

/** Cache-First: return cached copy instantly; update in background if online */
async function cacheFirst(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline — please reconnect', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/** Stale-While-Revalidate: serve cache immediately, refresh in background */
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || await networkFetch;
}

// ════════════════════════════════════════
//  PUSH NOTIFICATIONS
// ════════════════════════════════════════

/** Fired when the push server delivers a message to this device */
self.addEventListener('push', event => {
  let data = { title: 'HEY CAT', body: 'You have a new notification', icon: '☕' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch { /* malformed payload — use defaults */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon_url  || '/icon-192.png',
      badge:   '/icon-192.png',
      tag:     data.tag       || 'heycat-notif',
      data:    { url: data.url || '/' },
      vibrate: [200, 100, 200],
    })
  );
});

/** Tapping the notification opens / focuses the app */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
