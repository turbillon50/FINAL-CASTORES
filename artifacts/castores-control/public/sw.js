// Service Worker v4 — bulletproof network-first with aggressive cache busting.
// On install: skip waiting and take over immediately.
// On activate: delete ALL caches, ALL stored data, and force-reload all open clients.
// On fetch: ALWAYS try network first. NEVER cache HTML. Cache static assets only as offline fallback.

const SW_VERSION = 'v6';
const ASSET_CACHE = `castores-assets-${SW_VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));

    await self.clients.claim();

    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      try {
        client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION });
      } catch (e) {}
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;
  if (!req.url.startsWith('http')) return;

  const isHTML =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .catch(() => {
          return caches.match(req).then((cached) => {
            if (cached) return cached;
            return new Response(
              '<html><body style="font-family:system-ui;text-align:center;padding:40px;background:#0d0d0d;color:#fff"><h2>Sin conexión</h2><p>Verifica tu conexión a internet.</p><button onclick="location.reload()" style="padding:12px 24px;font-size:16px;background:#F59E0B;border:none;color:#000;border-radius:8px;cursor:pointer">Reintentar</button></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          });
        })
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((response) => {
        const url = new URL(req.url);
        const isCacheableAsset = /\.(js|css|png|jpg|jpeg|svg|ico|woff2?|webp)$/.test(url.pathname);
        if (isCacheableAsset && response.status === 200 && url.origin === self.location.origin) {
          const cloned = response.clone();
          caches.open(ASSET_CACHE).then((cache) => cache.put(req, cloned)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(req).then((cached) => cached || Response.error()))
  );
});

// ───── Web Push ──────────────────────────────────────────────────────────────
// El backend envía un JSON {title, body, url, tag, icon}. Si el payload no
// es JSON válido caemos a un texto genérico para no perder la notificación.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: 'Castores', body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'Castores Control';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/notificaciones' },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Click en la notificación: enfocar una pestaña abierta o abrir una nueva
// directo en la URL que el backend mandó.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/notificaciones';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      try {
        const url = new URL(client.url);
        if (url.origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) {
            try { await client.navigate(targetUrl); } catch {}
          }
          return;
        }
      } catch {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
