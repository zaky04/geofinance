/* ==========================================================================
   GeoFinance System — Service Worker
   Stratégie : precache complet de l'app shell + cache-first avec mise à jour
   en arrière-plan (stale-while-revalidate) pour un fonctionnement 100% hors-ligne.
   ========================================================================== */

const CACHE_VERSION = 'v78';
const CACHE_NAME = `geofinance-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/sw-register.js',
  './js/db.js',
  './js/ledger.js',
  './js/ocr.js',
  './js/auth.js',
  './js/state.js',
  './js/utils.js',
  './js/i18n.js',
  './js/charts.js',
  './js/backup.js',
  './js/firebase-config.js',
  './js/firebase-sync.js',
  './js/demo-data.js',
  './js/install-prompt.js',
  './js/notifications.js',
  './js/modules/dashboard.js',
  './js/modules/wallets.js',
  './js/modules/transactions.js',
  './js/modules/budgets.js',
  './js/modules/savings.js',
  './js/modules/investments.js',
  './js/modules/debts.js',
  './js/modules/tools.js',
  './js/modules/reports.js',
  './js/modules/reports-extras.js',
  './js/modules/shared.js',
  './js/modules/kept-accounts.js',
  './js/modules/search.js',
  './js/modules/settings.js',
  './vendor/chart.min.js',
  './vendor/jspdf.umd.min.js',
  './vendor/tesseract.min.js',
  './vendor/tesseract-worker.min.js',
  './vendor/tesseract-core-lstm.js',
  './vendor/tesseract-core-lstm.wasm',
  './vendor/fra.traineddata.gz',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];

/* ---------- Install : precache de l'app shell ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll/cache.add() échouent globalement si une seule ressource est absente
      // (ex: vendor pas encore téléchargé) -> on précache individuellement pour être
      // tolérant. On utilise fetch({cache:'reload'}) plutôt que cache.add() : GitHub
      // Pages sert tous les fichiers avec "Cache-Control: max-age=600", et cache.add()
      // respecte ce cache HTTP — un visiteur revenu dans les 10 minutes précédentes
      // se retrouverait à re-précacher ses propres fichiers déjà obsolètes au lieu
      // d'aller chercher la nouvelle version sur le réseau.
      return Promise.allSettled(
        APP_SHELL.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((response) => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return cache.put(url, response);
            })
            .catch((err) => {
              console.warn('[SW] Précache échoué pour', url, err);
            })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ---------- Activate : purge des anciens caches ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('geofinance-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ---------- Fetch : cache-first + revalidation en arrière-plan ---------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Seules les requêtes GET same-origin sont gérées par le cache applicatif.
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cached) => {
      // Cache-first strict : si la ressource est déjà précachée, on la sert
      // directement sans tenter de requête réseau concurrente (inutile ici,
      // la mise à jour se fait via CACHE_VERSION à chaque déploiement — et une
      // requête réseau systématique, y compris hors-ligne, ralentit/perturbe
      // le chargement du graphe de modules ES).
      //
      // La réponse est reconstruite explicitement (au lieu de renvoyer l'objet
      // Response de la Cache Storage API tel quel) : les scripts de module ES
      // sont chargés en mode "cors" (contrairement aux scripts classiques) et
      // certains navigateurs échouent silencieusement le chargement d'un
      // <script type="module">/import() servi par un Service Worker si la
      // Response provient directement du cache sans être reconstruite.
      if (cached) {
        const body = await cached.arrayBuffer();
        return new Response(body, { status: cached.status, statusText: cached.statusText, headers: cached.headers });
      }
      try {
        const response = await fetch(request);
        if (response && response.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return caches.match('./index.html');
      }
    })
  );
});

/* ---------- Messages : permet à app.js de forcer une mise à jour ---------- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ---------- Clic sur une notification : ramène l'app au premier plan ---------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
