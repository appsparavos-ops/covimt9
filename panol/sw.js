// ============================================================
//  SERVICE WORKER — COVIMT 9 PWA
//  Cache de archivos estáticos para funcionamiento offline
// ============================================================

// IMPORTANTE: este prefijo es 'covimt9-panol-' y no 'covimt9-' a secas.
// Los dos clientes (admin/ y panol/) comparten el MISMO origen y el Cache Storage
// es comun a todo el origen: si los dos SW se limpian por prefijo 'covimt9-',
// el que se activa borra la cache del otro y le rompe el modo offline.
const APP_NAMESPACE = 'covimt9-panol-';
const CACHE_NAME = APP_NAMESPACE + 'v49-pin-en-login';

// Caches que esta app creo con nombres antiguos (prefijo compartido). Se listan
// una por una, a proposito: asi podemos borrar las nuestras sin tocar nunca la
// 'covimt9-v35-...' que pertenece al cliente admin/.
const LEGACY_OWN_CACHES = [
  'covimt9-v40-sets',
];
const STATIC_ASSETS = [
  // Admin App
  'index.html',
  'admin.css?v=20261015-1',
  'maquinas.css?v=20261015-5',
  'bitacora.html',
  'bitacora.css?v=20261015-1',
  'bitacora.js?v=20261015-1',
  'cooperativa.js?v=20261017-5',
  'maquinas.js?v=20261017-5',
  'offlineSync.js?v=20261016-1',
  'firebaseConfig.js',
  // Manifiesto propio de la Etapa 2 (debe coincidir con el ?v= del <link rel="manifest">)
  'manifest.json?v=20261016-1',
  'pinos.png?v=20261014-25',
  'icons/favicon.ico?v=20261016-2',
  'icons/icon-192x192.png?v=20261016-2',
  'icons/icon-512x512.png?v=20261016-2',
  'icons/icon-maskable-512x512.png?v=20261016-2',
  'icons/icon-maskable-192x192.png?v=20261016-2',
  'icons/apple-touch-icon.png?v=20261016-2',
  // Librerías locales (sin dependencia de CDN)
  'vendor/lucide-0.468.0.min.js',
  'vendor/firebase-app-compat-9.22.0.js',
  'vendor/firebase-auth-compat-9.22.0.js',
  'vendor/firebase-firestore-compat-9.22.0.js',
  'vendor/jspdf-2.5.1.umd.min.js',
  'vendor/jspdf-autotable-3.5.25.min.js',
  'vendor/fonts/outfit.css',
  'vendor/fonts/outfit-300.ttf',
  'vendor/fonts/outfit-400.ttf',
  'vendor/fonts/outfit-500.ttf',
  'vendor/fonts/outfit-600.ttf',
  'vendor/fonts/outfit-700.ttf',

];

// Las librerías se sirven desde vendor/ y se precargan durante la instalación.

// --- INSTALL: Cache static assets ---
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets (non-blocking)');
        // Cache each asset individually so one failure doesn't block all
        return Promise.allSettled(
          STATIC_ASSETS.map((asset) => 
            cache.add(asset).catch((err) => {
              console.warn('[SW] Failed to cache:', asset, err.message);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// --- ACTIVATE: Clean old caches ---
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          // Solo caches de ESTE cliente. Nunca tocar las de admin/ ni las de la app de socios.
          .filter((name) => name !== CACHE_NAME && (name.startsWith(APP_NAMESPACE) || LEGACY_OWN_CACHES.includes(name)))
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// --- FETCH: Network-first for API, Cache-first for static ---
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip non-http(s) schemes (chrome-extension, moz-extension, etc.)
  if (!url.protocol.startsWith('http')) return;

  // Skip Firebase API calls (let them go through normally)
  if (url.hostname.includes('firestore.googleapis.com') || 
      url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('www.googleapis.com/identitytoolkit')) {
    return; // Let the browser handle these natively
  }

  // For static assets: cache-first with network fallback
  // For navigation (HTML pages): network-first with cache fallback
  const isNavigation = event.request.mode === 'navigate';
  const isOwnAppCode = url.origin === self.location.origin && (
    url.pathname.endsWith('/cooperativa.js') ||
    url.pathname.endsWith('/maquinas.js') ||
    url.pathname.endsWith('/offlineSync.js') ||
    url.pathname.endsWith('/bitacora.js')
  );

  if (isNavigation || isOwnAppCode) {
    // Network-first: try server, fallback to cache if offline
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // For other assets: cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(() => {
        // Fallback for navigation requests
        if (event.request.mode === 'navigate') {
          // Try to serve the requested HTML page from cache, fallback to index.html
          return caches.match(event.request).then(r => r || caches.match('index.html'));
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// --- MESSAGE: Allow manual cache update ---
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});
