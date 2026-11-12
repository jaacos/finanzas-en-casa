// Cambia CACHE en cada actualización de ficheros para que los móviles descarguen la versión nueva.
const CACHE = 'finanzas-v1.1.0';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/ui.js', 'js/config.js', 'js/seed.js', 'js/classify.js', 'js/parsers.js', 'js/importer.js', 'js/analysis.js', 'js/projects.js',
  'vendor/supabase.js', 'vendor/591.supabase.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Solo se cachean ficheros de la propia app. Los datos (Supabase) siempre van a la red.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && /\/vendor\//.test(url.pathname)) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
