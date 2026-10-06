// Dynasty Phase 0: intentionally no offline caching yet.
// A full PWA/offline strategy is deferred to the UI/integration phase.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
