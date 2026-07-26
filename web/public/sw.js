/*
 * devsesh service worker — minimal, dependency-free.
 *
 * Purpose: make the app installable (a fetch handler is required) and give it a
 * usable offline shell. Strategy:
 *   - navigations (HTML): network-first, falling back to the cached app shell
 *     when offline, so a fresh deploy is always picked up when online;
 *   - static build assets (content-hashed under /assets/, icons): cache-first;
 *   - everything else (API, websockets): pass straight through to the network.
 *
 * Bump CACHE_VERSION on release to evict the old shell/assets.
 */
const CACHE_VERSION = "devsesh-v1"
const APP_SHELL = "/index.html"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll([APP_SHELL, "/"])).then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

function isStaticAsset(url) {
  return url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname === "/manifest.webmanifest"
}

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return

  const url = new URL(req.url)
  // Never touch API or websocket traffic.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) return
  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return

  // App-shell navigations: network-first with an offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put(APP_SHELL, copy))
          return res
        })
        .catch(() => caches.match(APP_SHELL).then((r) => r || caches.match("/")))
    )
    return
  }

  // Content-hashed build assets: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy))
          return res
        })
      )
    )
  }
})
