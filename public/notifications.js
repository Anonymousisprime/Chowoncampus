(() => {
  const toggle = document.getElementById("notificationToggle");
  const panel = document.getElementById("notificationPanel");
  const list = document.getElementById("notificationList");
  const count = document.getElementById("notificationCount");
  if (!toggle || !panel || !list || !count) return;
  let loggedIn = false;
  let busy = false;
  let currentAccount = null;
  let currentAccountKey = "";
  let knownNotificationIds = null;
  let audioContext = null;
  let soundEnabled = false;
  function enableNotificationSound() {
    soundEnabled = true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass && !audioContext) audioContext = new AudioContextClass();
      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
    } catch {}
  }
  async function testNotificationSound() {
    enableNotificationSound();
    try {
      if (audioContext && audioContext.state === "suspended") await audioContext.resume();
    } catch {}
    playNotificationDing();
  }
  function playNotificationDing() {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioContext) audioContext = new AudioContextClass();
      if (audioContext.state === "suspended") audioContext.resume();
      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, now);
      oscillator.frequency.setValueAtTime(1174.66, now + 0.11);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.44);
    } catch {}
  }
  function showSystemNotification(item) {
    if (document.visibilityState === "visible" || !("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const notice = new Notification(item.title || "ChowOnCampus update", {
        body: item.message || "You have a new order update.",
        tag: "chowoncampus-" + String(item.id || ""),
        icon: "/favicon.svg"
      });
      notice.onclick = () => { window.focus(); notice.close(); };
    } catch {}
  }

  let serviceWorkerRegistration = null;
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const raw = atob((base64String + padding).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }
  function setPushStatus(message, isError = false) {
    const status = document.getElementById("pushSetupStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("error", isError);
  }
  async function enableBackgroundPush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      throw new Error("This browser does not support background push. On iPhone, use Safari and add ChowOnCampus to your Home Screen first.");
    }
    if (Notification.permission !== "granted") {
      throw new Error(Notification.permission === "denied"
        ? "Notifications are blocked for this site in your browser settings. Allow them there, then try again."
        : "Tap Enable background alerts and allow notifications when your browser asks.");
    }
    serviceWorkerRegistration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
    await serviceWorkerRegistration.update().catch(() => {});
    await navigator.serviceWorker.ready;
    const keyResponse = await request("/api/push/public-key");
    if (!keyResponse.configured || !keyResponse.publicKey) throw new Error("Background push is not configured on the server. Contact ChowOnCampus support.");
    let subscription = await serviceWorkerRegistration.pushManager.getSubscription();
    if (subscription) {
      const existingKey = subscription.options?.applicationServerKey;
      if (existingKey) {
        const bytes = new Uint8Array(existingKey);
        const existingBase64 = btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
        if (existingBase64 !== keyResponse.publicKey.replace(/=/g, "")) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
    }
    if (!subscription) {
      subscription = await serviceWorkerRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyResponse.publicKey)
      });
    }
    await request("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ subscription: subscription.toJSON() })
    });
    const status = await request("/api/push/status");
    setPushStatus("Background alerts are enabled on this device. Registered device(s): " + status.subscribedDevices + ".");
    return status;
  }
  async function refreshPushStatus() {
    try {
      const status = await request("/api/push/status");
      if (!status.configured) setPushStatus("The server's background notification keys are missing.", true);
      else if (Notification.permission === "denied") setPushStatus("Notifications are blocked in this browser. Allow them in site settings, then enable alerts again.", true);
      else if (status.subscribedDevices > 0) setPushStatus("Background alerts are registered for " + status.subscribedDevices + " device(s). Send a test alert to confirm delivery.");
      else setPushStatus("This account has no registered devices. Tap Enable background alerts on this device.");
    } catch (error) {
      setPushStatus(error.message || "Could not check notification setup.", true);
    }
  }

  const accountKey = account => account ? JSON.stringify([
    account.role || "",
    String(account.username || "").trim().toLowerCase(),
    String(account.restaurantId || ""),
    String(account.agentId || "")
  ]) : "";
  function clearNotifications(message = "Sign in to see your notifications.") {
    count.textContent = "0";
    count.classList.add("hidden");
    list.innerHTML = '<div class="notification-empty">' + esc(message) + '</div>';
  }
  async function syncAccount() {
    const result = await request("/api/me");
    const nextAccount = result.account || null;
    const nextKey = accountKey(nextAccount);
    if (nextKey !== currentAccountKey) {
      // Never leave the previous account's notifications visible after an account switch.
      currentAccount = nextAccount;
      currentAccountKey = nextKey;
      knownNotificationIds = null;
      clearNotifications(nextAccount ? "Loading your notifications…" : "Sign in to see your notifications.");
    }
    loggedIn = Boolean(nextAccount);
    toggle.classList.toggle("hidden", !loggedIn);
    if (!loggedIn) {
      panel.classList.add("hidden");
      toggle.setAttribute("aria-expanded", "false");
    }
    return nextKey;
  }
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
    if (busy) return;
    busy = true;
    try {
      const key = await syncAccount();
      if (!key || !loggedIn) {
        clearNotifications();
        return;
      }
      const data = await request("/api/notifications");
      // The account may have changed while the request was in flight.
      if (key !== currentAccountKey || !loggedIn) return;
      const visibleNotifications = (Array.isArray(data.notifications) ? data.notifications : []).filter(belongsToCurrentAccount);
      const currentIds = new Set(visibleNotifications.map(item => String(item.id)));
      if (knownNotificationIds === null) {
        // Establish a baseline on page load/account switch; don't ding for old notifications.
        knownNotificationIds = currentIds;
      } else {
        const arrived = visibleNotifications.filter(item => !knownNotificationIds.has(String(item.id)));
        if (arrived.length) {
          playNotificationDing();
          showSystemNotification(arrived[0]);
        }
        knownNotificationIds = currentIds;
      }
      count.textContent = visibleNotifications.filter(item => !item.read).length;
      count.classList.toggle("hidden", !visibleNotifications.some(item => !item.read));
      if (!visibleNotifications.length) {
        list.innerHTML = '<div class="notification-empty">You’re all caught up. New order updates will appear here.</div>';
      } else {
        list.innerHTML = visibleNotifications.map(item => `<article class="notification-item ${item.read ? "" : "unread"}" data-notification-id="${esc(item.id)}" data-order-id="${esc(item.orderId || "")}"><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${esc(new Date(item.createdAt).toLocaleString())}</small></article>`).join("");
      }
    } catch (error) {
      if (panel.classList.contains("hidden")) return;
      clearNotifications("Notifications could not be loaded. Try again shortly.");
    } finally { busy = false; }
  }
  async function init() {
    try {
      await syncAccount();
      if (loggedIn) await refresh();
    } catch {
      currentAccount = null;
      currentAccountKey = "";
      loggedIn = false;
      toggle.classList.add("hidden");
      clearNotifications();
    }
  }
  async function requestPushPermissionAndSubscribe() {
    if (!loggedIn) {
      setPushStatus("Sign in with your restaurant or delivery-agent account first.", true);
      return;
    }
    try {
      if (!("Notification" in window)) throw new Error("This browser does not support system notifications.");
      if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("Notification permission was not granted. Allow notifications in your browser settings and try again.");
      }
      if (Notification.permission !== "granted") {
        throw new Error("Notifications are blocked for this site. Change the permission in your browser/site settings, then try again.");
      }
      await enableBackgroundPush();
    } catch (error) {
      console.info("ChowOnCampus push setup:", error.message);
      setPushStatus(error.message || "Could not enable background notifications.", true);
    }
  }
  toggle.addEventListener("click", async () => {
    await testNotificationSound();
    const open = panel.classList.toggle("hidden") === false;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      await refresh();
      await refreshPushStatus();
      if ("Notification" in window && Notification.permission === "granted" && loggedIn) {
        try { await enableBackgroundPush(); } catch (error) { setPushStatus(error.message || "Could not enable background notifications.", true); }
      }
    }
  });
  document.getElementById("notificationEnablePush")?.addEventListener("click", requestPushPermissionAndSubscribe);
  document.getElementById("notificationPushTest")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Sending test…";
    try {
      await requestPushPermissionAndSubscribe();
      const result = await request("/api/push/test", { method: "POST", body: "{}" });
      setPushStatus(result.message + " Check the notification shade. If the site is open, you may also need to minimize it to see the system alert.");
    } catch (error) {
      setPushStatus(error.message || "The test notification failed.", true);
    } finally {
      button.disabled = false;
      button.textContent = "Send test alert";
    }
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
  setInterval(refresh, 5000);
})();