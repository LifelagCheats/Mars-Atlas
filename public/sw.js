/* Service worker de Mars Atlas: funcionamiento sin conexión.
 *  - Teselas de NASA (*.nasa.gov): primero caché, luego red (y se guardan al descargarse).
 *  - /jezero/* (DTM y datos opcionales): primero red, caché como respaldo sin conexión.
 *    NUNCA se guarda ni se sirve una respuesta text/html aquí: Vite devuelve index.html (200) cuando el archivo no existe
 *    y cachearlo envenenaría el DTM (la app lo leería como JSON y fallaría).
 * La caché 'mars-tiles-v1' también la llena el botón «Guardar zona sin conexión» de la pestaña EVA. */
const CACHE = 'mars-tiles-v1';
const html = r => !!r && (r.headers.get('content-type') || '').toLowerCase().includes('text/html');
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url), tile = u.hostname.endsWith('nasa.gov'), local = u.origin === self.location.origin && u.pathname.startsWith('/jezero/');
  if (!tile && !local) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (tile) {
      const hit = await cache.match(req); if (hit) return hit;
      try { const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r; } catch { return new Response('', { status: 504 }); }
    }
    try { const r = await fetch(req); if (r.ok && !html(r)) cache.put(req, r.clone()); return r; }
    catch { const hit = await cache.match(req); return hit && !html(hit) ? hit : new Response('', { status: 504 }); }
  })());
});
