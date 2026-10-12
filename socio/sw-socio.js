// ============================================================
//  SERVICE WORKER — COVIMT 9 PORTAL DE SOCIOS
//  Scope: /socio/ (independiente del admin)
// ============================================================

const CACHE_NAME = 'covimt9-socio-v18-horas-comprometidas';
const STATIC_ASSETS = [
  'socio.html',
  'socio.js?v=20261012-18',
  'manifest-socio.json',
  'firebaseConfig.js',
  'pinos.png',
  'icons-socio/icon-192x192.png',
  'icons-socio/icon-512x512.png',
  'icons-socio/icon-maskable-512x512.png',
  'icons-socio/apple-touch-icon.png',
  // Librerías locales (sin dependencia de CDN)
  'vendor/tailwindcss-3.4.17.js',
  'vendor/lucide-0.468.0.min.js',
  'vendor/firebase-app-compat-9.22.0.js',
  'vendor/firebase-auth-compat-9.22.0.js',
  'vendor/firebase-firestore-compat-9.22.0.js',
  'vendor/fonts/outfit.css',
  'vendor/fonts/outfit-300.ttf',
  'vendor/fonts/outfit-400.ttf',
  'vendor/fonts/outfit-500.ttf',
  'vendor/fonts/outfit-600.ttf',
  'vendor/fonts/outfit-700.ttf'
];

// Las librerías se sirven desde vendor/ y se precargan durante la instalación.

// --- INSTALL ---
self.addEventListener('install', (event) => {
  console.log('[SW-Socio] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return Promise.allSettled(
          STATIC_ASSETS.map((asset) =>
            cache.add(asset).catch((err) => {
              console.warn('[SW-Socio] Failed to cache:', asset, err.message);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// --- ACTIVATE ---
self.addEventListener('activate', (event) => {
  console.log('[SW-Socio] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('covimt9-socio') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// --- FETCH ---
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  // Skip Firebase API calls
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('www.googleapis.com/identitytoolkit')) {
    return;
  }

  // HTML y código propio: red primero para publicar cambios inmediatamente.
  const isOwnAppCode = url.origin === self.location.origin && url.pathname.endsWith('/socio.js');
  if (event.request.mode === 'navigate' || isOwnAppCode) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Other assets: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => new Response('Offline', { status: 503 }));
    })
  );
});

// --- MESSAGE: Allow manual cache update ---
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});
