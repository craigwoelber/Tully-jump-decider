/* ===================================================
   Tully Jump Decider — service-worker.js
   Cache-first for app shell; network-first for APIs
   =================================================== */

'use strict';

const CACHE_NAME = 'tully-jump-v1';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg',
];

const API_ORIGINS = [
  'https://api.weather.gov',
  'https://aviationweather.gov',
];

// ---- Install: pre-cache the app shell ----

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL);
    }).then(() => {
      // Activate immediately without waiting for old tabs to close
      return self.skipWaiting();
    })
  );
});

// ---- Activate: clean up old caches ----

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// ---- Fetch: route requests ----

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-first for weather API calls — never serve stale weather data
  const isApiCall = API_ORIGINS.some(origin => event.request.url.startsWith(origin));

  if (isApiCall) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Cache-first for app shell assets
  if (event.request.method === 'GET') {
    event.respondWith(cacheFirst(event.request));
    return;
  }
});

// ---- Strategies ----

/**
 * Cache-first: serve from cache if available, else fetch and cache.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Offline and not in cache — return a simple offline page for navigation
    if (request.mode === 'navigate') {
      const offlineCache = await caches.match('./index.html');
      if (offlineCache) return offlineCache;
    }
    return new Response('Network error — app is offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/**
 * Network-first: try network, fall back to cache if offline.
 * Weather data is never served from cache (we want fresh data or an error).
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (err) {
    // Network failed — don't serve cached weather, let app handle the error
    return new Response(
      JSON.stringify({ error: 'offline', message: 'Weather data unavailable offline' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
