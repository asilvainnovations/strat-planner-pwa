// Strat Planner Pro — Service Worker
// Offline-first PWA with cache-then-network strategy

const CACHE_NAME = 'strat-planner-pro-v1.0.0';
const STATIC_CACHE = 'strat-planner-static-v1';
const DATA_CACHE = 'strat-planner-data-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Roboto+Condensed:wght@300;400;500;600;700&family=Poppins:wght@300;400;500;600;700;800;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Strat Planner Pro Service Worker');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('https://fonts')));
    }).catch((err) => {
      console.log('[SW] Cache install error:', err);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Strat Planner Pro Service Worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== STATIC_CACHE && name !== DATA_CACHE)
          .map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: Cache-first for static, network-first for API
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // API calls: network-first with cache fallback
  if (url.hostname === 'api.anthropic.com' || url.hostname.includes('api.')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(DATA_CACHE).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for HTML pages
        if (request.headers.get('accept').includes('text/html')) {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// Background sync for offline changes
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-plans') {
    event.waitUntil(syncPlans());
  }
});

async function syncPlans() {
  try {
    const db = await openDB();
    const pendingChanges = await db.getAll('pending-changes');
    for (const change of pendingChanges) {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change)
      });
      await db.delete('pending-changes', change.id);
    }
    // Notify all clients
    const clients = await self.clients.matchAll();
    clients.forEach(client => client.postMessage({ type: 'SYNC_COMPLETE' }));
  } catch (err) {
    console.log('[SW] Sync failed, will retry:', err);
  }
}

// Push notification support
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Strat Planner Pro', {
      body: data.body || 'You have a new notification',
      icon: 'https://appimize.app/assets/apps/user_1097/images/46fe704cc227_595_1097.png',
      badge: 'https://appimize.app/assets/apps/user_1097/images/46fe704cc227_595_1097.png',
      data: data.url || '/',
      actions: [
        { action: 'view', title: 'View' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action !== 'dismiss') {
    event.waitUntil(
      clients.openWindow(event.notification.data || '/')
    );
  }
});

// Message handler for manual sync
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'TRIGGER_SYNC') syncPlans();
});

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('strat-planner-db', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pending-changes')) {
        db.createObjectStore('pending-changes', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('plans')) {
        db.createObjectStore('plans', { keyPath: 'id' });
      }
    };
  });
}
