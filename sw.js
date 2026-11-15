// سرویس‌ورکر: برنامه بعد از اولین باز شدن کاملاً آفلاین کار میکنه.
// فهرست فایل‌ها از precache.json میاد (با tools/make-precache.mjs ساخته میشه).
const PREFIX = 'tray-';
const VERSION = '7e3a2af394'; // توسط tools/make-precache.mjs به‌روز میشه تا مرورگر نسخه‌ی جدید را بشناسد

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch('./precache.json', { cache: 'no-store' });
      const { files } = await res.json();
      const cache = await caches.open(PREFIX + VERSION);
      await cache.addAll(files.map((f) => new Request(f, { cache: 'reload' })));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== PREFIX + VERSION) await caches.delete(k);
      await self.clients.claim();
      const all = await self.clients.matchAll();
      all.forEach((c) => c.postMessage({ type: 'updated' }));
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        return await fetch(req);
      } catch (e) {
        if (req.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
        return Response.error();
      }
    })()
  );
});
