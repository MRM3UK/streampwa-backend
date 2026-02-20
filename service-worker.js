const CACHE_NAME = 'streampwa-v1.0.0';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    'https://cdn.jsdelivr.net/npm/hls.js@latest',
    'https://cdn.dashjs.org/latest/dash.all.min.js',
    'https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
            .catch((err) => console.error('[SW] Cache error:', err))
    );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event - network first, then cache
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip caching for API requests and video streams
    if (url.pathname.startsWith('/api/') || 
        url.hostname.includes('gofile') ||
        event.request.method !== 'GET') {
        return event.respondWith(fetch(event.request));
    }

    event.respondWith(
        // Try network first
        fetch(event.request)
            .then((response) => {
                // Clone the response
                const responseToCache = response.clone();
                
                // Cache successful responses
                if (response.ok) {
                    caches.open(CACHE_NAME)
                        .then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                }
                
                return response;
            })
            .catch(() => {
                // If network fails, try cache
                return caches.match(event.request)
                    .then((cachedResponse) => {
                        if (cachedResponse) {
                            return cachedResponse;
                        }
                        
                        // Return offline page for navigation requests
                        if (event.request.mode === 'navigate') {
                            return caches.match('/index.html');
                        }
                        
                        // Return a simple offline response
                        return new Response('Offline', {
                            status: 503,
                            statusText: 'Service Unavailable',
                            headers: new Headers({
                                'Content-Type': 'text/plain'
                            })
                        });
                    });
            })
    );
});

// Handle background sync (optional)
self.addEventListener('sync', (event) => {
    console.log('[SW] Background sync:', event.tag);
});

// Handle push notifications (optional)
self.addEventListener('push', (event) => {
    if (event.data) {
        const data = event.data.json();
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon || '/icon-192.png'
        });
    }
});
