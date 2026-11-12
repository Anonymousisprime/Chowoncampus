const CACHE_NAME = "chowoncampus-pwa-v1";
const APP_SHELL = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/style.css?v=mobile-menu-1",
  "/app.js?v=mobile-menu-1",
  "/pwa.js?v=1",
  "/chowoncampus-logo.svg",
  "/chowoncampus-icon.png?v=2"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async path => {
      try {
        const response = await fetch(path, { cache: "reload" });
        if (response.ok) await cache.put(path, response);
      } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("chowoncampus-pwa-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (url.pathname === "/" && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("/", response.clone());
        }
        return response;
      } catch {
        if (url.pathname === "/") {
          const cachedHome = await caches.match("/");
          if (cachedHome) return cachedHome;
        }
        return (await caches.match("/offline.html")) || Response.error();
      }
    })());
    return;
  }

  const isStaticAsset = /\.(?:css|js|svg|png|webmanifest|woff2?)$/i.test(url.pathname);
  if (!isStaticAsset) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return Response.error();
    }
  })());
});

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "ChowOnCampus update";
  const options = {
    body: data.body || "You have a new order update.",
    icon: "/chowoncampus-icon.png?v=2",
    badge: "/chowoncampus-icon.png?v=2",
    tag: data.orderId ? "chowoncampus-order-" + data.orderId : "chowoncampus-update",
    renotify: true,
    actions: data.kind === "voice_call" ? [{ action: "answer", title: "Answer call" }, { action: "dismiss", title: "Dismiss" }] : [],\n    data: { url: data.url || "/", orderId: data.orderId || null, callId: data.callId || null, kind: data.kind || null }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const destination = new URL(event.notification.data && event.notification.data.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ("navigate" in client && client.url !== destination) await client.navigate(destination);
        return;
      }
    }
    await self.clients.openWindow(destination);
  })());
});
