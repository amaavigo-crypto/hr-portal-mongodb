// Keeps the app opening with no signal. Data (API calls) is never cached, so nobody sees stale HR information.
const CACHE = 'amaavigo-shell-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg']).catch(() => undefined))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (r.mode === 'navigate') { e.respondWith(fetch(r).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put('/', c)); return res; }).catch(() => caches.match('/'))); return; }
  // Built files have a new name each release, so keeping a copy is safe.
  if (u.pathname.startsWith('/assets/') || u.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put(r, c)); return res; })));
  }
});
