(() => {
  const toggle = document.getElementById("notificationToggle");
  const panel = document.getElementById("notificationPanel");
  const list = document.getElementById("notificationList");
  const count = document.getElementById("notificationCount");
  if (!toggle || !panel || !list || !count) return;
  let loggedIn = false;
  let busy = false;
  let currentAccount = null;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  // Defense in depth: never render a notification for another role or account.
  function belongsToCurrentAccount(item) {
    if (!currentAccount || !item || item.role !== currentAccount.role) return false;
    if (currentAccount.role === "admin") return true;
    if (currentAccount.role === "student") return Boolean(currentAccount.username && item.username === currentAccount.username);
    if (currentAccount.role === "restaurant") return Boolean(currentAccount.restaurantId && item.restaurantId === currentAccount.restaurantId);
    if (currentAccount.role === "agent") return Boolean(currentAccount.agentId && item.agentId === currentAccount.agentId);
    return false;
  }
  async function request(url, options = {}) {
    const response = await fetch(url, { credentials:"same-origin", ...options, headers:{ ...(options.body ? {"Content-Type":"application/json"} : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not load notifications.");
    return data;
  }
  async function refresh() {
    if (!loggedIn || busy) return;
    busy = true;
    try {
      const data = await request("/api/notifications");
      const visibleNotifications = (Array.isArray(data.notifications) ? data.notifications : []).filter(belongsToCurrentAccount);
      count.textContent = visibleNotifications.filter(item => !item.read).length;
      count.classList.toggle("hidden", !visibleNotifications.some(item => !item.read));
      if (!visibleNotifications.length) {
        list.innerHTML = '<div class="notification-empty">You’re all caught up. New order updates will appear here.</div>';
      } else {
        list.innerHTML = visibleNotifications.map(item => `<article class="notification-item ${item.read ? "" : "unread"}" data-notification-id="${esc(item.id)}" data-order-id="${esc(item.orderId || "")}"><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${esc(new Date(item.createdAt).toLocaleString())}</small></article>`).join("");
      }
    } catch (error) {
      if (panel.classList.contains("hidden")) return;
      list.innerHTML = '<div class="notification-empty">Notifications could not be loaded. Try again shortly.</div>';
    } finally { busy = false; }
  }
  async function init() {
    try {
      const result = await request("/api/me");
      currentAccount = result.account || null;
      loggedIn = Boolean(currentAccount);
      toggle.classList.toggle("hidden", !loggedIn);
      if (loggedIn) await refresh();
    } catch {}
  }
  toggle.addEventListener("click", async () => {
    const open = panel.classList.toggle("hidden") === false;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) await refresh();
  });
  document.getElementById("notificationClose")?.addEventListener("click", () => {
    panel.classList.add("hidden"); toggle.setAttribute("aria-expanded", "false");
  });
  list.addEventListener("click", async event => {
    const item = event.target.closest("[data-notification-id]");
    if (!item) return;
    try {
      await request("/api/notifications/" + encodeURIComponent(item.dataset.notificationId) + "/read", { method:"PATCH", body:"{}" });
      await refresh();
      if (item.dataset.orderId) {
        const tracking = document.getElementById("trackId");
        if (tracking) { tracking.value = item.dataset.orderId; document.getElementById("trackForm")?.requestSubmit(); panel.classList.add("hidden"); }
      }
    } catch {}
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  init();
  setInterval(refresh, 20000);
})();