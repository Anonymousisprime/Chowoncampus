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
    data: { url: data.url || "/", orderId: data.orderId || null }
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
self.addEventListener("install", event => { self.skipWaiting(); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });
