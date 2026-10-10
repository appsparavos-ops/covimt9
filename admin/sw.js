// ============================================================
//  SERVICE WORKER — COVIMT 9 PWA
//  Cache de archivos estáticos para funcionamiento offline
// ============================================================

const CACHE_NAME = 'covimt9-v3';
const STATIC_ASSETS = [
  // Admin App
  'index.html',
  'cooperativa.js',
  'offlineSync.js',
  'firebaseConfig.js',
  'pinos.png',
  'manifest.json',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
  'icons/icon-maskable-512x512.png',
  'icons/apple-touch-icon.png',
  // Socio App
  'socio.html',
  'socio.js',
  'manifest-socio.json',
  'icons-socio/icon-192x192.png',
  'icons-socio/icon-512x512.png',
  'icons-socio/icon-maskable-512x512.png',
  'icons-socio/apple-touch-icon.png'
];

// CDN resources (cached on first fetch)
const CDN_PATTERNS = [
  'cdn.tailwindcss.com',
  'unpkg.com/lucide',
  'gstatic.com/firebasejs',
  'cdnjs.cloudflare.com/ajax/libs/jspdf',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

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
          .filter((name) => name !== CACHE_NAME)
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

  // Skip Firebase API calls (let them go through normally)
  if (url.hostname.includes('firestore.googleapis.com') || 
      url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('www.googleapis.com/identitytoolkit')) {
    return; // Let the browser handle these natively
  }

  // For CDN resources: network-first with cache fallback
  const isCDN = CDN_PATTERNS.some(pattern => url.href.includes(pattern));
  
  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(() => {
          return cached || new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }

  // For static assets: cache-first with network fallback
  // For navigation (HTML pages): network-first with cache fallback
  const isNavigation = event.request.mode === 'navigate';

  if (isNavigation) {
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
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
