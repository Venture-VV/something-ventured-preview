/* library live · member app service worker
   - app shell: network first, cached copy when offline (so updates land on the next open)
   - images: cache first
   - the API is never cached */
const VERSION = 'sv-app-v3';
const SHELL = [
  './', './index.html', './app.css', './app.js', './manifest.webmanifest',
  '../shared/core.js', '../shared/api.js', '../shared/ui.js', '../shared/plan.js', '../shared/plan.css',
  './icons/icon-192.png', './icons/apple-touch-icon.png', '../assets/img/favicon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  if (/\.(woff2|png|jpg|svg)$/.test(url.pathname)) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })));
    return;
  }
  event.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
