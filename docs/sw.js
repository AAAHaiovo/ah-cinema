/* AH 影视 Service Worker：缓存应用壳；视频与大文件直接走网络。 */

const CACHE_NAME = 'ah-cinema-v21';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/app.css',
  './css/player.css',
  './js/theme-boot.js',
  './js/db.js',
  './js/catalog.js',
  './js/local-library.js',
  './js/store.js',
  './js/router.js',
  './js/ui.js',
  './js/views.js',
  './js/category-tree.js',
  './js/remote-api.js',
  './js/sources.js',
  './js/remote-library.js',
  './js/sources-view.js',
  './js/sources-controller.js',
  './js/player.js',
  './js/app.js',
  './vendor/hls.min.js',
  './data/catalog.json',
  './assets/ah-mark.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(SHELL.map(async (url) => {
    try {
      /* cache: 'reload' 绕过 HTTP 缓存，避免装进旧文件。 */
      const response = await fetch(url, { cache: 'reload' });
      if (response && response.ok) await cache.put(url, response);
    } catch (error) {
      /* 单个文件失败不阻塞安装，运行时还有 network-first 兜底。 */
    }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const hadOldCache = keys.some((key) => key !== CACHE_NAME);
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
    /* 从旧版本升级时让已打开的页面自动刷新一次，立刻用上新界面。 */
    if (hadOldCache) {
      const windows = await self.clients.matchAll({ type: 'window' });
      windows.forEach((client) => {
        try {
          client.navigate(client.url).catch(() => {});
        } catch (error) {
          /* 忽略不支持 navigate 的浏览器。 */
        }
      });
    }
  })());
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);

  try {
    /* 绕过 HTTP 缓存，保证发版后能立刻拿到新的 HTML / CSS / JS。 */
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }

    return new Response('离线，而且这个页面还没有缓存。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /* 视频、跨域片源和 Range 请求不经过缓存，避免把大文件塞进 Cache Storage。 */
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (request.destination === 'video' || request.headers.has('range')) return;
  if (url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  if (url.pathname.endsWith('.json') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.destination === 'image') {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.destination === 'script' || request.destination === 'style' || request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
