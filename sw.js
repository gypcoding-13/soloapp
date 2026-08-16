const VERSION = 'soloapp-v1.0.0';

const RESSOURCES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './ui/app.js',
  './ui/kit.js',
  './ui/fiches.js',
  './ui/documents.js',
  './core/db.js',
  './core/money.js',
  './core/totals.js',
  './core/numbering.js',
  './core/documents.js',
  './core/activation.js',
  './core/codes.js',
  './core/pdf.js',
  './vendor/pdf-lib.esm.min.js',
  './vendor/fontkit.es.min.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/fonts/archivo.woff2',
  './assets/fonts/archivo-bold.woff2',
  './assets/fonts/mono.woff2',
  './assets/fonts/archivo.ttf',
  './assets/fonts/archivo-bold.ttf',
  './assets/fonts/mono.ttf',
  './assets/fonts/mono-bold.ttf',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(RESSOURCES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

// Cache d'abord : l'application doit demarrer identique avec ou sans reseau.
// Le reseau ne sert qu'a rafraichir en arriere-plan.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then((enCache) => {
      const reseau = fetch(e.request)
        .then((reponse) => {
          if (reponse.ok) {
            const copie = reponse.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copie));
          }
          return reponse;
        })
        .catch(() => enCache ?? caches.match('./index.html'));
      return enCache ?? reseau;
    }),
  );
});
