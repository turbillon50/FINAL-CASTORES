// Service Worker v4 — bulletproof network-first with aggressive cache busting.
// On install: skip waiting and take over immediately.
// On activate: delete ALL caches, ALL stored data, and force-reload all open clients.
// On fetch: ALWAYS try network first. NEVER cache HTML. Cache static assets only as offline fallback.

const SW_VERSION = 'v4';
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
