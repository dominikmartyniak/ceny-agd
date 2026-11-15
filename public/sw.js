// Service worker: szybki start i działanie interfejsu offline. Dane (API) zawsze z sieci.
const VERSION = 'v5';
const SHELL = ['./', 'index.html', 'app.js', 'backend.js', 'photo-browser.js', 'style.css', 'lib/plate.js', 'lib/promos.js', 'lib/offers.js', 'lib/pricing.js', 'lib/honesty.js', 'lib/need.js', 'lib/specs.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/') || /config\.json|stores\.json/.test(url.pathname)) return; // dane bez cache
  // network-first: zawsze najnowsza wersja, cache tylko gdy brak sieci
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./'))));
});
