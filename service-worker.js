const CACHE_NAME = 'felix-v3'; // ← bumped version to bust the old broken cache

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install — pre-cache all assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  // Force this SW to become active immediately, don't wait for old one to die
  self.skipWaiting();
});

// Activate — delete ALL old caches immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  // Take control of all open tabs right away
  self.clients.claim();
});

//Notification
self.addEventListener('push', function(event) {
  const data = event.data?.json() || {};

  const title = data.title || "Fintra";
  const options = {
    body: data.body || "New notification",
    icon: "./icon-192.png"
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Fetch — Network first for HTML (always get latest), cache first for assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isHTML = event.request.destination === 'document' ||
                 url.pathname.endsWith('.html') ||
                 url.pathname === '/' ||
                 url.pathname.endsWith('/');

  if (isHTML) {
    // NETWORK FIRST for HTML — always try to get the freshest index.html
    // Falls back to cache only if offline
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Update the cache with the fresh version
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // CACHE FIRST for icons, manifest, fonts etc.
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
  }
});
