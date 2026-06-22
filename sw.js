// Service Worker for 马上金融/安逸花 调解计算器 v2.0
const CACHE_NAME = 'collection-tool-v4';
const PRECACHE_URLS = [
    './',
    './index.html',
    './tailwind-output.css',
    './styles.css',
    './app.js',
    './chart.js',
    './manifest.json',
    './fonts/inter-regular.ttf',
    './fonts/inter-medium.ttf',
    './fonts/inter-semibold.ttf',
    './fonts/inter-bold.ttf'
];

// Install: precache all static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(PRECACHE_URLS).catch(err => {
                console.warn('SW precache partial failure:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: NetworkFirst for HTML, CacheFirst for static assets
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;
    
    // Skip chrome-extension and other non-http(s) requests
    if (!url.protocol.startsWith('http')) return;
    
    // HTML: NetworkFirst
    if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
        event.respondWith(networkFirst(event.request));
        return;
    }
    
    // Static assets: CacheFirst with background update
    event.respondWith(cacheFirst(event.request));
});

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
        return response;
    } catch (e) {
        const cached = await caches.match(request);
        return cached || new Response('Offline - page not cached', { status: 503 });
    }
}

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) {
        // Background update
        fetch(request).then(response => {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response));
        }).catch(() => {});
        return cached;
    }
    try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
        return response;
    } catch (e) {
        return new Response('Offline - resource not cached', { status: 503 });
    }
}