// Minimal service worker — satisfies Chrome/Edge PWA install criteria
// (must have a registered fetch handler). We do NOT cache anything: the
// app is an always-live radio stream + dynamic now-playing data, and
// stale assets would be worse than no caching.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally pass-through. Do not intercept.
});
