const CACHE_NAME = 'onesports-management-v6-20260828';
const APP_SHELL = [
  '/',
  '/index.html',
  '/admin.html',
  '/assets/styles.css',
  '/assets/common.js',
  '/assets/data.js',
  '/assets/viewer.js',
  '/assets/admin.js',
  '/assets/onesports-logo.png',
  '/config.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function shouldUseNetworkFirst(url, request) {
  if (request.mode === 'navigate') return true;
  return ['.html', '.js', '.css', '.json', '.webmanifest'].some((extension) => url.pathname.endsWith(extension));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (shouldUseNetworkFirst(url, request)) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || (request.mode === 'navigate' ? caches.match('/index.html') : undefined)))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
