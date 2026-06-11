/* ねだん帳 Service Worker
 * アプリのファイルを端末にキャッシュして、圏外でも開けるようにする。
 * ファイルを更新したら CACHE_VERSION の数字を上げること。
 */
const CACHE_VERSION = 'nedancho-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// キャッシュ優先(圏外でも即表示)。なければネットワークへ。
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached =>
      cached ||
      fetch(event.request).catch(() =>
        event.request.mode === 'navigate' ? caches.match('./index.html') : undefined
      )
    )
  );
});
