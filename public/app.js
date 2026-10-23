
const $ = selector => document.querySelector(selector);

const state = {
  restaurants: [],
  selectedRestaurantId: null,
  cart: [],
  account: null,
  lastOrderId: null,
  agents: []
};

const money = amount => new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0
}).format(amount);

const isLocalDemo = ["localhost", "127.0.0.1"].includes(location.hostname);

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function showMessage(selector, message, success = false) {
  const element = $(selector);
  element.textContent = message;
  element.classList.toggle("success", success);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function setView(name) {
  document.querySelectorAll(".view").forEach(view => view.classList.add("hidden"));
  $(`#${name}View`).classList.remove("hidden");

  document.querySelectorAll("[data-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.view === name);
  });

  if (name === "dashboard" && state.account) loadDashboard();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateNavigation() {
  $("#dashboardNav").classList.toggle("hidden", !state.account);
}

function cartSubtotal() {
  return state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function renderRestaurants() {
  $("#restaurantList").innerHTML = state.restaurants.map((restaurant, index) => `
    <article class="restaurant-card">
      <div class="restaurant-banner">${index === 0 ? "🍛" : "🍲"}</div>
      <div class="restaurant-info">
        <h3>${escapeHtml(restaurant.name)}</h3>
        <p>${escapeHtml(restaurant.description)}</p>
        ${restaurant.location ? `<p class="restaurant-location">📍 ${escapeHtml(restaurant.location)}</p>` : `<p class="restaurant-location muted">📍 Campus location not added yet</p>`}
        <button class="secondary-button" data-open-menu="${escapeHtml(restaurant.id)}">
          Explore menu →
        </button>
      </div>
    </article>
  `).join("");
}

async function refreshPublicMenu() {
  try {
    const result = await api("/api/menu");
    state.restaurants = result.restaurants;
    // Keep an existing bag in sync with current item prices and availability.
    state.cart = state.cart.map(cartItem => {
      const restaurant = state.restaurants.find(r => r.id === cartItem.restaurantId);
      const current = restaurant?.items.find(item => item.id === cartItem.id);
      return current ? { ...cartItem, name: current.name, price: current.price, emoji: current.emoji } : cartItem;
    }).filter(cartItem => {
      const restaurant = state.restaurants.find(r => r.id === cartItem.restaurantId);
      const current = restaurant?.items.find(item => item.id === cartItem.id);
      return current && current.available !== false;
    });
    renderRestaurants();
    renderCart();
    if (state.selectedRestaurantId) renderMenu();
  } catch (error) {
    console.warn("Could not refresh menu:", error.message);
  }
}

function renderMenu() {
  const restaurant = state.restaurants.find(r => r.id === state.selectedRestaurantId);
  if (!restaurant) {
    $("#menuArea").innerHTML = "";
    return;
  }

  $("#menuArea").innerHTML = `
    <div class="section-heading">
      <div><span class="eyebrow">NOW SERVING</span><h2>${escapeHtml(restaurant.name)}</h2></div>
      <button class="text-button" id="closeMenu">← All restaurants</button>
    </div>
    <div class="food-grid">
      ${restaurant.items.map(item => `
        <article class="food-card ${item.available === false ? "food-sold-out" : ""}">
          <div class="food-emoji">${escapeHtml(item.emoji)}</div>
          <div class="food-info">
            <h3>${escapeHtml(item.name)}</h3>
            <span class="muted">${escapeHtml(item.category)}</span>
            <div class="food-bottom">
              <span class="price">${money(item.price)}</span>
              ${item.available === false
                ? '<span class="sold-out-label">Sold out</span>'
                : `<button class="add-button" aria-label="Add ${escapeHtml(item.name)}" data-add="${escapeHtml(item.id)}">+</button>`}
            </div>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function addToCart(itemId) {
  const restaurant = state.restaurants.find(r => r.id === state.selectedRestaurantId);
  const item = restaurant?.items.find(i => i.id === itemId);
  if (!item) return;
  if (item.available === false) return showToast("This item is currently sold out.");

  if (state.cart.length && state.cart[0].restaurantId !== restaurant.id) {
    if (!confirm("Your bag contains food from another restaurant. Clear it and start a new order?")) {
      return;
    }
    state.cart = [];
  }

  const existing = state.cart.find(i => i.id === item.id);
  if (existing) {
    if (existing.qty >= 20) return showToast("Maximum quantity is 20.");
    existing.qty += 1;
  } else {
    state.cart.push({
      id: item.id,
      name: item.name,
      price: item.price,
      emoji: item.emoji,
      qty: 1,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name
    });
  }

  renderCart();
  showToast(`${item.name} added to your bag!`);
}

function changeQuantity(itemId, amount) {
  const item = state.cart.find(i => i.id === itemId);
  if (!item) return;

  item.qty += amount;
  if (item.qty <= 0) {
    state.cart = state.cart.filter(i => i.id !== itemId);
  }
  renderCart();
}

function renderCart() {
  const count = state.cart.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = cartSubtotal();
  const delivery = state.cart.length ? 300 : 0;

  $("#cartCount").textContent = count;
  $("#cartHeadingCount").textContent = `(${count})`;
  $("#subtotal").textContent = money(subtotal);
  $("#deliveryFee").textContent = money(delivery);
  $("#grandTotal").textContent = money(subtotal + delivery);

  if (!state.cart.length) {
    $("#cartItems").innerHTML = `<p class="muted">Your bag is empty. Add something delicious!</p>`;
  } else {
    $("#cartItems").innerHTML = `
      <p class="tiny muted">From ${escapeHtml(state.cart[0].restaurantName)}</p>
      ${state.cart.map(item => `
        <div class="cart-row">
          <div>
            <h4>${escapeHtml(item.emoji)} ${escapeHtml(item.name)}</h4>
            <p>${money(item.price)} each</p>
            <strong>${money(item.price * item.qty)}</strong>
          </div>
          <div class="quantity">
            <button data-qty="${escapeHtml(item.id)}" data-delta="-1" aria-label="Decrease quantity">−</button>
            <strong>${item.qty}</strong>
            <button data-qty="${escapeHtml(item.id)}" data-delta="1" aria-label="Increase quantity">+</button>
          </div>
        </div>
      `).join("")}
    `;
  }
}

async function placeOrder(event) {
  event.preventDefault();
  if (!state.account || state.account.role !== "student") {
    showMessage("#checkoutMessage", "Please sign up or log in with a student account before ordering.");
    location.href = "/student-login.html?next=order";
    return;
  }
  if (!state.cart.length) {
    return showMessage("#checkoutMessage", "Add food to your bag first.");
  }

  const button = $("#placeOrderButton");
  button.disabled = true;
  button.textContent = "Placing order…";

  try {
    const result = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        hostel: $("#hostel").value,
        block: $("#deliveryBlock").value,
        room: $("#deliveryRoom").value,
        landmark: $("#deliveryLandmark").value,
        latitude: $("#deliveryLatitude").value === "" ? undefined : Number($("#deliveryLatitude").value),
        longitude: $("#deliveryLongitude").value === "" ? undefined : Number($("#deliveryLongitude").value),
        restaurantId: state.cart[0].restaurantId,
        items: state.cart.map(item => ({ id: item.id, qty: item.qty }))
      })
    });

    const order = result.order;
    state.lastOrderId = order.id;
    try { localStorage.setItem("coc_last_order_id", order.id); } catch {}
    state.cart = [];
    renderCart();
    $("#checkoutForm").reset();

    $("#trackId").value = order.id;
    showMessage("#checkoutMessage", `Order ${order.id} created. No payment has been made.`, true);
    showToast("Demo order created!");
    await trackOrder(order.id);
    $("#trackingSection").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showMessage("#checkoutMessage", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Place demo order →";
  }
}

function renderTrackedOrder(order) {
  const items = order.items.map(item => `${item.qty} × ${escapeHtml(item.name)}`).join(", ");
  const steps = ["Awaiting payment", "Confirmed", "Preparing", "Ready for pickup", "Out for delivery", "Completed"];
  const cancelled = order.status === "Cancelled";
  const currentIndex = steps.indexOf(order.status);
  const history = Array.isArray(order.statusHistory) && order.statusHistory.length
    ? order.statusHistory
    : [{ status: order.status, at: order.updatedAt || order.createdAt, by: "system" }];
  const timeline = history.map(event => `
    <li class="tracking-event"><span class="tracking-dot"></span><div><strong>${escapeHtml(event.status)}</strong><small>${escapeHtml(new Date(event.at).toLocaleString())}</small></div></li>
  `).join("");
  $("#trackResult").innerHTML = `
    <article class="order-card tracking-card">
      <div class="order-top"><div><span class="eyebrow">ORDER REFERENCE</span><h3>${escapeHtml(order.id)}</h3></div><span class="status">${escapeHtml(order.status)}</span></div>
      <p>${escapeHtml(order.restaurantName || "Your restaurant")}</p><p class="order-items">${items}</p>
      <div class="tracking-progress" aria-label="Order progress">
        ${steps.map((step,index)=>`<div class="tracking-step ${!cancelled && currentIndex>=index ? "done" : ""} ${order.status===step ? "current" : ""}"><span>${!cancelled && currentIndex>index ? "✓" : index+1}</span><small>${escapeHtml(step)}</small></div>`).join("")}
      </div>
      ${cancelled ? '<p class="tracking-alert">This order has been cancelled. Contact the restaurant if you need help.</p>' : ""}
      <h4>Order updates</h4><ol class="tracking-timeline">${timeline}</ol>
      <p>Food subtotal: <strong>${money(order.subtotal)}</strong></p><p>Delivery fee: <strong>${money(order.deliveryFee)}</strong></p><p>Total: <strong>${money(order.total)}</strong></p>
      <p>Payment: <strong>${escapeHtml(order.paymentStatus || "Check with the restaurant")}</strong></p>
      <p class="tiny muted">Last updated: ${escapeHtml(new Date(order.updatedAt || order.createdAt).toLocaleString())}</p>
      ${isLocalDemo && order.paymentStatus === "Unpaid — demo only" ? `<button class="primary-button" data-demo-pay="${escapeHtml(order.id)}">Simulate demo payment (no money charged)</button>` : ""}
      <p class="tiny muted">Tracking refreshes automatically every 15 seconds while this page is open.</p>
      ${state.account?.role === "student" && ["Ready for pickup", "Out for delivery"].includes(order.status) ? '<section style="margin-top:18px;padding:16px;border:1px solid #dce9df;border-radius:14px;background:#f8fbf8"><h4>Temporary delivery chat</h4><p class="tiny muted">Chat with your assigned delivery agent. Messages are automatically deleted when delivery is completed or cancelled.</p><div id="customerChatMessages" aria-live="polite" style="max-height:240px;overflow:auto;display:grid;gap:8px;margin:12px 0"><p class="tiny muted">Loading chat…</p></div><form id="customerChatForm" data-chat-order="${escapeHtml(order.id)}" style="display:flex;gap:8px;flex-wrap:wrap"><input name="message" maxlength="500" required placeholder="Message your delivery agent…" style="flex:1;min-width:180px;padding:12px;border:1px solid #cbd9cf;border-radius:10px;font:inherit"><button class="primary-button" type="submit">Send</button></form><p id="customerChatStatus" class="tiny muted" role="status"></p></section>' : ""}
    </article>`;
  if (state.account?.role === "student" && ["Ready for pickup", "Out for delivery"].includes(order.status)) loadCustomerChat(order.id);
}

async function loadCustomerChat(orderId) {
  const box = $("#customerChatMessages");
  if (!box) return;
  try {
    const result = await api("/api/orders/" + encodeURIComponent(orderId) + "/chat");
    const current = $("#customerChatMessages");
    if (!current) return;
    current.innerHTML = result.messages.length ? result.messages.map(m =>
      '<div style="padding:9px 11px;border-radius:10px;background:' + (m.senderRole === "student" ? "#e5f3e9" : "#fff") + ';border:1px solid #e1eae3"><strong>' + escapeHtml(m.senderName) + '</strong><p style="margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere">' + escapeHtml(m.message) + '</p><small class="muted">' + escapeHtml(new Date(m.sentAt).toLocaleTimeString()) + '</small></div>').join("") : '<p class="tiny muted">No messages yet. Say hello to your delivery agent.</p>';
    current.scrollTop = current.scrollHeight;
  } catch (error) {
    if ($("#customerChatMessages")) $("#customerChatMessages").textContent = error.message;
  }
}

let activeTrackedOrderId = null;
let trackingRefreshTimer = null;
async function trackOrder(orderId, quiet = false) {
  const id = String(orderId || "").trim();
  if (!id) return showMessage("#trackResult", "Enter your order ID.");
  activeTrackedOrderId = id;
  if (!quiet) $("#trackResult").innerHTML = `<p class="loading">Looking up your order…</p>`;
  try {
    const result = await api(`/api/orders/${encodeURIComponent(id)}`);
    renderTrackedOrder(result.order);
  } catch (error) {
    if (!quiet) $("#trackResult").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}
function startTrackingRefresh() {
  if (trackingRefreshTimer) clearInterval(trackingRefreshTimer);
  trackingRefreshTimer = setInterval(() => {
    if (activeTrackedOrderId && document.visibilityState === "visible") trackOrder(activeTrackedOrderId, true);
  }, 15000);
}

async function simulatePayment(orderId) {
  if (!isLocalDemo) return showToast("Demo payments are available locally only.");

  if (!confirm("Simulate a payment for testing? No money will be charged.")) return;

  try {
    await api(`/api/orders/${encodeURIComponent(orderId)}/demo-payment`, {
      method: "POST",
      body: JSON.stringify({})
    });
    showToast("Demo payment simulated. No money was charged.");
    await trackOrder(orderId);
  } catch (error) {
    showToast(error.message);
  }
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
  } catch (error) {
    console.error(error);
  }
  state.account = null;
  updateNavigation();
  setView("home");
  showToast("You have signed out.");
}

function availableStatuses(order) {
  if (state.account.role === "admin") {
    return ["Awaiting payment", "Confirmed", "Preparing", "Ready for pickup", "Out for delivery", "Completed", "Cancelled"];
  }
  if (state.account.role === "restaurant") {
    return ["Confirmed", "Preparing", "Ready for pickup", "Cancelled"];
  }
  if (state.account.role === "agent") {
    return ["Out for delivery", "Completed"];
  }
  return [];
}

function renderOrderCard(order) {
  const statuses = availableStatuses(order);
  const canAssign = state.account.role === "admin" && order.status !== "Completed";
  const canChangeStatus = statuses.length > 0 && !(order.status === "Completed");
  const canContactAgent = state.account.role === "restaurant" && order.assignedAgentId && ["Ready for pickup", "Out for delivery"].includes(order.status);
  const canDeliveryChat = ["Ready for pickup", "Out for delivery"].includes(order.status) && ((state.account.role === "restaurant" && order.assignedAgentId) || (state.account.role === "agent" && state.account.agentId === order.assignedAgentId));

  return `
    <article class="order-card">
      <div class="order-top">
        <div><span class="eyebrow">${escapeHtml(order.restaurantName)}</span><h3>${escapeHtml(order.id)}</h3></div>
        <span class="status">${escapeHtml(order.status)}</span>
      </div>
      <p><strong>${escapeHtml(order.customerName)}</strong> · ${escapeHtml(order.customerPhone)}</p>
      <p>Delivery location: ${escapeHtml(order.hostel)}</p>
      ${order.deliveryLocation?.latitude != null && order.deliveryLocation?.longitude != null ? `<p><a class="secondary-button map-link" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${encodeURIComponent(`${order.deliveryLocation.latitude},${order.deliveryLocation.longitude}`)}">📍 Open student pin in Maps</a></p>` : `<p><a class="secondary-button map-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.hostel)}">📍 Search delivery location in Maps</a></p>`}
      ${order.restaurantLocation ? `<p>Restaurant pickup: ${escapeHtml(order.restaurantLocation)} <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.restaurantLocation)}">Open map</a></p>` : ""}
      <p class="order-items">${order.items.map(item => `${item.qty} × ${escapeHtml(item.name)}`).join(", ")}</p>
      <p>Total: <strong>${money(order.total)}</strong> · Payment: ${escapeHtml(order.paymentStatus)}</p>
      ${order.assignedAgentId ? `<p>Assigned agent: <strong>${escapeHtml(order.assignedAgentId)}</strong></p>` : ""}
      ${canAssign ? `
        <div class="order-actions">
          <label>Assign agent
            <select data-agent-order="${escapeHtml(order.id)}">
              <option value="">Choose agent</option>
              ${state.agents.map(agent => `
                <option value="${escapeHtml(agent.id)}" ${order.assignedAgentId === agent.id ? "selected" : ""}>
                  ${escapeHtml(agent.name)}
                </option>
              `).join("")}
            </select>
          </label>
        </div>
      ` : ""}
      ${canContactAgent ? `
        <section class="agent-contact">
          <div><span class="eyebrow">PICKUP COORDINATION</span><strong>Assigned delivery agent: ${escapeHtml(order.assignedAgentId)}</strong><p class="tiny muted">Use this temporary chat to tell the agent when the order is ready. Messages are deleted when the order is completed or cancelled.</p></div>
          <div id="restaurantChatMessages-${escapeHtml(order.id)}" class="dashboard-chat-messages" aria-live="polite">Loading messages…</div>
          <form class="dashboard-chat-form" data-restaurant-chat-order="${escapeHtml(order.id)}"><input name="message" maxlength="500" required placeholder="Message the delivery agent…"><button class="primary-button" type="submit">Send</button></form>
          <p class="tiny muted" data-restaurant-chat-status="${escapeHtml(order.id)}" role="status"></p>
        </section>
      ` : ""}
      ${canDeliveryChat && state.account.role === "agent" ? `
        <section class="agent-contact">
          <div><span class="eyebrow">TEMPORARY DELIVERY CHAT</span><strong>Student order conversation</strong><p class="tiny muted">Coordinate pickup and delivery with the student. Messages are removed when the order is completed or cancelled.</p></div>
          <div id="agentChatMessages-${escapeHtml(order.id)}" class="dashboard-chat-messages" aria-live="polite">Loading messages…</div>
          <form class="dashboard-chat-form" data-agent-chat-order="${escapeHtml(order.id)}"><input name="message" maxlength="500" required placeholder="Message the student…"><button class="primary-button" type="submit">Send</button></form>
          <p class="tiny muted" data-agent-chat-status="${escapeHtml(order.id)}" role="status"></p>
        </section>
      ` : ""}
      ${canChangeStatus ? `
        <div class="order-actions">
          <label>Update status
            <select data-status-order="${escapeHtml(order.id)}">
              ${statuses.map(status => `
                <option value="${escapeHtml(status)}" ${order.status === status ? "selected" : ""}>
                  ${escapeHtml(status)}
                </option>
              `).join("")}
            </select>
          </label>
          <button class="secondary-button" data-save-status="${escapeHtml(order.id)}">Save status</button>
        </div>
      ` : ""}
    </article>
  `;
}

function renderMenuRow(item = {}) {
  return `<div class="menu-editor-row" data-menu-row>
    <input type="hidden" name="id" value="${escapeHtml(item.id || "")}">
    <label>Item name<input name="name" required minlength="2" maxlength="80" value="${escapeHtml(item.name || "")}" placeholder="e.g. Jollof rice"></label>
    <label>Price (₦)<input name="price" required type="number" min="1" max="1000000" step="1" value="${Number(item.price) || ""}" placeholder="2500"></label>
    <label>Category<input name="category" maxlength="40" value="${escapeHtml(item.category || "Meals")}" placeholder="Meals, Drinks…"></label>
    <label class="menu-available"><input name="available" type="checkbox" ${item.available === false ? "" : "checked"}> Available</label>
    <button class="menu-remove" type="button" data-remove-menu-item aria-label="Remove item">Remove</button>
  </div>`;
}

function renderMenuManagerAfterSave() {
  const old = document.querySelector(".restaurant-menu-manager");
  if (old) old.remove();
  renderRestaurantMenuManager();
}

function renderRestaurantMenuManager() {
  if (!state.account || state.account.role !== "restaurant") return;
  const restaurant = state.restaurants.find(item => item.id === state.account.restaurantId);
  if (!restaurant) return;
  const container = document.createElement("section");
  container.className = "restaurant-menu-manager";
  container.innerHTML = `
    <section class="restaurant-location-manager">
      <div class="dashboard-section-heading"><div><span class="eyebrow">PICKUP POINT</span><h2>Edit restaurant location</h2><p>Tell students and delivery agents where to find your restaurant.</p></div></div>
      <form id="restaurantLocationForm">
        <label for="restaurantLocationInput">Restaurant location / pickup instructions</label>
        <input id="restaurantLocationInput" name="location" maxlength="180" value="${escapeHtml(restaurant.location || "")}" placeholder="e.g. Student Centre, Block B, beside the library">
        <div class="menu-editor-actions"><button type="submit" class="primary-button" id="saveRestaurantLocation">Save location</button><span id="restaurantLocationMessage" class="muted" role="status"></span></div>
      </form>
    </section>
    <div class="dashboard-section-heading"><div><span class="eyebrow">YOUR MENU</span><h2>Manage food and prices</h2><p>Add up to 70 items and mark anything unavailable as sold out.</p></div><span class="count-pill" id="menuItemCount">${restaurant.items.length}/70 items</span></div>
    <form id="restaurantMenuForm">
      <div id="restaurantMenuRows">${restaurant.items.map(item => renderMenuRow(item)).join("")}</div>
      <div class="menu-editor-actions"><button type="button" class="secondary-button" id="addMenuItem" ${restaurant.items.length >= 70 ? "disabled" : ""}>＋ Add item</button><button type="submit" class="primary-button" id="saveRestaurantMenu">Save menu</button></div>
      <p id="restaurantMenuMessage" class="muted" role="status"></p>
    </form>`;
  $("#dashboardContent").prepend(container);
}

async function loadDashboard() {
  if (!state.account) { location.href = "/student-login.html"; return; }

  const account = state.account;
  $("#dashboardTitle").textContent = ({
    admin: "Admin dashboard",
    restaurant: "Restaurant orders",
    agent: "Delivery dashboard",
    student: "Student account"
  })[account.role] || "Dashboard";
  $("#accountLabel").textContent = `Signed in as ${account.name} · ${account.role}`;

  $("#earningsPanel").innerHTML = "";
  $("#dashboardContent").innerHTML = `<p class="loading">Loading your workspace…</p>`;

  try {
    if (account.role === "admin") {
      const result = await api("/api/agents");
      state.agents = result.agents;
    } else {
      state.agents = [];
    }

    const { orders } = await api("/api/orders");
    if (account.role === "restaurant") {
      const incoming = orders.filter(order => ["Awaiting payment", "Confirmed"].includes(order.status));
      const preparing = orders.filter(order => order.status === "Preparing");
      const pickup = orders.filter(order => ["Ready for pickup", "Out for delivery"].includes(order.status));
      const completed = orders.filter(order => ["Completed", "Cancelled"].includes(order.status));
      const section = (title, subtitle, list, key) => `
        <section class="dashboard-order-section">
          <div class="dashboard-section-heading"><div><h2>${title}</h2><p>${subtitle}</p></div><span class="count-pill">${list.length}</span></div>
          ${list.length ? `<div class="order-list">${list.map(renderOrderCard).join("")}</div>` : `<div class="empty-state compact-empty">No ${key} orders right now.</div>`}
        </section>`;
      const totalSales = orders.filter(order => order.status === "Completed").reduce((sum, order) => sum + Number(order.total || 0), 0);
      $("#dashboardContent").innerHTML = `
        <div class="restaurant-welcome"><div><span class="eyebrow">RESTAURANT WORKSPACE</span><h2>Let's get orders moving.</h2><p>Review incoming orders, prepare meals and coordinate pickup with your delivery agent.</p></div><button class="secondary-button" id="refreshRestaurantOrders" type="button">↻ Refresh orders</button></div>
        <div class="restaurant-metrics">
          <article><span>Incoming</span><strong>${incoming.length}</strong><small>Awaiting action</small></article>
          <article><span>Preparing</span><strong>${preparing.length}</strong><small>In the kitchen</small></article>
          <article><span>Pickup / delivery</span><strong>${pickup.length}</strong><small>Agent coordination</small></article>
          <article><span>Completed sales</span><strong>${money(totalSales)}</strong><small>${completed.filter(o => o.status === "Completed").length} completed orders</small></article>
        </div>
        ${section("Incoming orders", "New orders that need your attention", incoming, "incoming")}
        ${section("In the kitchen", "Orders currently being prepared", preparing, "preparing")}
        ${section("Ready for pickup & delivery", "Contact your assigned agent and coordinate handoff", pickup, "pickup")}
        ${section("Order history", "Completed and cancelled orders", completed, "completed")}`;
      renderRestaurantMenuManager();
      document.querySelectorAll("[data-restaurant-chat-order]").forEach(form => loadRestaurantChat(form.dataset.restaurantChatOrder));
      document.querySelectorAll("[data-agent-chat-order]").forEach(form => loadAgentChat(form.dataset.agentChatOrder));
    } else if (account.role === "admin") {
      const [restaurantResult, studentResult] = await Promise.all([
        api("/api/admin/restaurants"),
        api("/api/admin/students")
      ]);
      const studentRows = studentResult.students.map(student => `
        <tr>
          <td>${escapeHtml(student.name)}</td>
          <td>${escapeHtml(student.phone)}</td>
          <td><span class="status">${student.verifiedPhone ? "Verified" : "Not verified"}</span></td>
          <td><span class="status">${student.banned ? "Banned" : "Active"}</span></td>
          <td>${student.createdAt ? escapeHtml(new Date(student.createdAt).toLocaleString()) : "—"}</td>
          <td><button type="button" class="${student.banned ? "secondary-button" : "danger-button"}" data-toggle-student-ban="${escapeHtml(student.id)}" data-student-name="${escapeHtml(student.name)}" data-student-banned="${student.banned ? "true" : "false"}">${student.banned ? "Unban student" : "Ban student"}</button></td>
        </tr>
      `).join("");
      const restaurantRows = restaurantResult.restaurants.map(restaurant => `
        <article class="order-card">
          <div class="order-top"><div><span class="eyebrow">RESTAURANT PARTNER</span><h3>${escapeHtml(restaurant.name)}</h3></div><span class="status">${restaurant.itemCount} items</span></div>
          <p>${escapeHtml(restaurant.description || "No description")}</p>
          <p>📍 Location: ${escapeHtml(restaurant.location || "Not added yet")}</p>
          <p>Login username: <strong>${escapeHtml(restaurant.username)}</strong></p>
          <div class="order-actions"><button type="button" class="danger-button" data-delete-restaurant="${escapeHtml(restaurant.id)}" data-restaurant-name="${escapeHtml(restaurant.name)}">Delete restaurant</button></div>
        </article>
      `).join("");
      $("#dashboardContent").innerHTML = `
        <section class="dashboard-order-section" aria-label="Admin management shortcuts">
          <div class="dashboard-section-heading"><div><h2>Quick management</h2><p>Jump straight to account controls and restaurant management.</p></div></div>
          <div class="order-actions" style="display:flex;gap:10px;flex-wrap:wrap">
            <button type="button" class="secondary-button" data-admin-jump="adminStudentAccounts">Manage students · Ban / Unban</button>
            <button type="button" class="secondary-button" data-admin-jump="adminRestaurantPartners">Manage restaurants · Delete</button>
          </div>
        </section>
        <section class="dashboard-order-section">
          <div class="dashboard-section-heading"><div><h2>Add restaurant</h2><p>Create a partner login and add the first menu item.</p></div></div>
          <form id="adminAddRestaurantForm" class="order-card">
            <label>Restaurant name<input name="name" required minlength="2" maxlength="100" placeholder="e.g. Chow House"></label>
            <label>Description<input name="description" maxlength="240" placeholder="Fresh meals for campus students"></label>
            <label>Restaurant location / pickup point<input name="location" maxlength="180" placeholder="e.g. Student Centre, Block B"></label>
            <label>Login username<input name="username" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9._-]+" placeholder="chowhouse"></label>
            <label>Temporary password<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="At least 10 characters"></label>
            <h3>First menu item</h3>
            <label>Item name<input name="firstItemName" required minlength="2" maxlength="80" placeholder="Jollof rice"></label>
            <label>Price (₦)<input name="firstItemPrice" type="number" required min="1" max="1000000" step="1" placeholder="2500"></label>
            <button class="primary-button" type="submit">＋ Add restaurant</button>
            <p id="adminAddRestaurantMessage" class="muted" role="status"></p>
          </form>
        </section>
        <section class="dashboard-order-section">
          <div class="dashboard-section-heading"><div><h2>Add delivery agent</h2><p>Create a delivery login for a new agent.</p></div></div>
          <form id="adminAddAgentForm" class="order-card">
            <label>Agent full name<input name="name" required minlength="2" maxlength="100" placeholder="Full name"></label>
            <label>Login username<input name="username" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9._-]+" placeholder="agentname"></label>
            <label>Temporary password<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="At least 10 characters"></label>
            <button class="primary-button" type="submit">＋ Add delivery agent</button>
            <p id="adminAddAgentMessage" class="muted" role="status"></p>
          </form>
        </section>
        <section class="dashboard-order-section" id="adminStudentAccounts">
          <div class="dashboard-section-heading"><div><h2>Student accounts</h2><p>${studentResult.students.length} registered student account(s). Passwords are never displayed.</p></div><button class="secondary-button" id="refreshAdminStudents" type="button">↻ Refresh students</button></div>
          ${studentResult.students.length ? `
            <div style="overflow-x:auto">
              <table class="admin-student-table" style="width:100%;border-collapse:collapse;text-align:left">
                <thead><tr><th style="padding:10px">Student name</th><th style="padding:10px">Phone / username</th><th style="padding:10px">Phone status</th><th style="padding:10px">Account status</th><th style="padding:10px">Created</th><th style="padding:10px">Action</th></tr></thead>
                <tbody>${studentRows}</tbody>
              </table>
            </div>
          ` : '<div class="empty-state">No student accounts registered yet.</div>'}
        </section>
        <section class="dashboard-order-section" id="adminRestaurantPartners">
          <div class="dashboard-section-heading"><div><h2>Restaurant partners</h2><p>Current restaurants registered in ChowOnCampus.</p></div></div>
          ${restaurantRows || '<div class="empty-state">No restaurant partners found.</div>'}
        </section>
        <section class="dashboard-order-section">
          <div class="dashboard-section-heading"><div><h2>Orders</h2><p>Manage orders and assign delivery agents.</p></div><span class="count-pill">${orders.length}</span></div>
          ${orders.length ? `<div class="order-list">${orders.map(renderOrderCard).join("")}</div>` : '<div class="empty-state">No orders here yet. New orders will appear when customers place them.</div>'}
        </section>`;
    } else {
      $("#dashboardContent").innerHTML = orders.length
        ? `<div class="order-list">${orders.map(renderOrderCard).join("")}</div>`
        : `<div class="empty-state">No orders here yet. New orders will appear when customers place them.</div>`;
    }

    const securityPanel = document.createElement("section");
    securityPanel.className = "dashboard-order-section";
    securityPanel.innerHTML = `
      <div class="dashboard-section-heading"><div><span class="eyebrow">ACCOUNT SECURITY</span><h2>Change password</h2><p>Use your current password to set a new one (10–128 characters). You will need to log in again after changing it.</p></div></div>
      <form id="changePasswordForm" class="order-card">
        <label>Current password<input name="currentPassword" type="password" required autocomplete="current-password"></label>
        <label>New password<input name="newPassword" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label>
        <label>Confirm new password<input name="confirmPassword" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label>
        <button class="primary-button" type="submit" id="changePasswordButton">Change password</button>
        <p id="changePasswordMessage" class="muted" role="status"></p>
      </form>`;
    $("#dashboardContent").appendChild(securityPanel);

    if (account.role === "admin" || account.role === "agent") {
      const result = await api("/api/earnings");
      $("#earningsPanel").innerHTML = `
        <div class="earnings-card">
          <span class="eyebrow">${escapeHtml(result.month)} · COMPLETED DELIVERIES</span>
          <strong>${money(result.earned)}</strong>
          <p>${result.completedDeliveries} completed deliveries at ₦100 each</p>
          <p class="tiny muted">${escapeHtml(result.note)}</p>
        </div>
      `;
    }
  } catch (error) {
    $("#dashboardContent").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function loadRestaurantChat(orderId) {
  const box = document.querySelector("#restaurantChatMessages-" + CSS.escape(orderId));
  if (!box) return;
  try {
    const result = await api("/api/orders/" + encodeURIComponent(orderId) + "/chat");
    const current = document.querySelector("#restaurantChatMessages-" + CSS.escape(orderId));
    if (!current) return;
    current.innerHTML = result.messages.length ? result.messages.map(m =>
      '<div class="dashboard-chat-message"><strong>' + escapeHtml(m.senderName) + '</strong><p>' + escapeHtml(m.message) + '</p><small>' + escapeHtml(new Date(m.sentAt).toLocaleTimeString()) + '</small></div>'
    ).join("") : '<p class="tiny muted">No messages yet. Send a pickup note to your agent.</p>';
    current.scrollTop = current.scrollHeight;
  } catch (error) {
    if (box) box.textContent = error.message;
  }
}

async function loadAgentChat(orderId) {
  const selector = "#agentChatMessages-" + CSS.escape(orderId);
  const box = document.querySelector(selector);
  if (!box) return;
  try {
    const result = await api("/api/orders/" + encodeURIComponent(orderId) + "/chat");
    const current = document.querySelector(selector);
    if (!current) return;
    current.innerHTML = result.messages.length ? result.messages.map(m =>
      '<div class="dashboard-chat-message"><strong>' + escapeHtml(m.senderName) + '</strong><p>' + escapeHtml(m.message) + '</p><small>' + escapeHtml(new Date(m.sentAt).toLocaleTimeString()) + '</small></div>'
    ).join("") : '<p class="tiny muted">No messages yet. Send a note to the student.</p>';
    current.scrollTop = current.scrollHeight;
  } catch (error) {
    box.textContent = error.message;
  }
}

async function saveStatus(orderId) {
  const select = document.querySelector(`[data-status-order="${CSS.escape(orderId)}"]`);
  if (!select) return;

  try {
    await api(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: select.value })
    });
    showToast("Order status updated.");
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  }
}

async function assignAgent(orderId) {
  const select = document.querySelector(`[data-agent-order="${CSS.escape(orderId)}"]`);
  if (!select?.value) return showToast("Choose a delivery agent first.");

  try {
    await api(`/api/orders/${encodeURIComponent(orderId)}/assign`, {
      method: "PATCH",
      body: JSON.stringify({ agentId: select.value })
    });
    showToast("Delivery agent assigned.");
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  }
}

async function initialize() {
  $("#year").textContent = new Date().getFullYear();

  try {
    const result = await api("/api/menu");
    state.restaurants = result.restaurants;
    renderRestaurants();
  } catch (error) {
    $("#restaurantList").innerHTML = `<div class="empty-state">Could not load the menu. Please refresh the page.</div>`;
  }

  renderCart();
  updateNavigation();

  try {
    const result = await api("/api/me");
    state.account = result.account;
    updateNavigation();
  } catch (error) {
    console.error(error);
  }

  document.addEventListener("click", async event => {
    const gpsButton = event.target.closest("#useMyLocation");
    if (gpsButton) {
      const message = $("#locationMessage");
      if (!navigator.geolocation) { message.textContent = "GPS is not supported by this browser. Please enter your location manually."; return; }
      gpsButton.disabled = true;
      message.textContent = "Requesting your location permission…";
      navigator.geolocation.getCurrentPosition(position => {
        $("#deliveryLatitude").value = position.coords.latitude;
        $("#deliveryLongitude").value = position.coords.longitude;
        message.textContent = "GPS pin added. Your delivery agent can open it in Maps.";
        gpsButton.disabled = false;
      }, error => {
        message.textContent = error.code === 1 ? "Location permission was denied. Enter your hostel and landmark manually, or allow location in browser settings." : "Could not get GPS location. Check device location settings or enter your address manually.";
        gpsButton.disabled = false;
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
      return;
    }
    const viewButton = event.target.closest("[data-view]");
    if (viewButton && viewButton.dataset.view !== "login") setView(viewButton.dataset.view);

    const openMenu = event.target.closest("[data-open-menu]");
    if (openMenu) {
      state.selectedRestaurantId = openMenu.dataset.openMenu;
      renderMenu();
      $("#menuArea").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    const addButton = event.target.closest("[data-add]");
    if (addButton) addToCart(addButton.dataset.add);

    if (event.target.closest("#addMenuItem")) {
      const rows = $("#restaurantMenuRows");
      if (rows && rows.querySelectorAll("[data-menu-row]").length < 70) {
        rows.insertAdjacentHTML("beforeend", renderMenuRow());
        const count = rows.querySelectorAll("[data-menu-row]").length;
        $("#menuItemCount").textContent = count + "/70 items";
        $("#addMenuItem").disabled = count >= 70;
      }
    }
    const removeMenuItem = event.target.closest("[data-remove-menu-item]");
    if (removeMenuItem) {
      const rows = $("#restaurantMenuRows");
      if (rows && rows.querySelectorAll("[data-menu-row]").length > 1) {
        removeMenuItem.closest("[data-menu-row]").remove();
        $("#menuItemCount").textContent = rows.querySelectorAll("[data-menu-row]").length + "/70 items";
        $("#addMenuItem").disabled = false;
      } else {
        showToast("Keep at least one menu item.");
      }
    }

    const quantityButton = event.target.closest("[data-qty]");
    if (quantityButton) {
      changeQuantity(quantityButton.dataset.qty, Number(quantityButton.dataset.delta));
    }

    if (event.target.closest("#closeMenu")) {
      state.selectedRestaurantId = null;
      renderMenu();
    }

    if (event.target.closest("#exploreButton")) {
      $("#menuSection").scrollIntoView({ behavior: "smooth" });
    }

    if (event.target.closest("#cartJump")) {
      $("#cartSection").scrollIntoView({ behavior: "smooth" });
    }

    if (event.target.closest("#clearCart")) {
      state.cart = [];
      renderCart();
    }

    if (event.target.closest("#logoutButton")) await logout();

    if (event.target.closest("#refreshAdminStudents")) {
      await loadDashboard();
      return;
    }

    if (event.target.closest("#refreshRestaurantOrders")) {
      await loadDashboard();
      return;
    }

    const adminJumpButton = event.target.closest("[data-admin-jump]");
    if (adminJumpButton) {
      document.getElementById(adminJumpButton.dataset.adminJump)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const studentBanButton = event.target.closest("[data-toggle-student-ban]");
    if (studentBanButton) {
      const studentId = studentBanButton.dataset.toggleStudentBan;
      const studentName = studentBanButton.dataset.studentName || "this student";
      const isBanned = studentBanButton.dataset.studentBanned === "true";
      const nextBanned = !isBanned;
      const action = nextBanned ? "ban" : "unban";
      if (!confirm((nextBanned ? "Ban " : "Unban ") + studentName + "? " + (nextBanned ? "They will be signed out and won't be able to log in." : "They will be able to log in again."))) return;
      studentBanButton.disabled = true;
      studentBanButton.textContent = nextBanned ? "Banning…" : "Unbanning…";
      try {
        const result = await api("/api/admin/students/" + encodeURIComponent(studentId) + "/ban", {
          method: "PATCH",
          body: JSON.stringify({ banned: nextBanned })
        });
        showToast(result.message || ("Student " + action + "ned."));
        await loadDashboard();
      } catch (error) {
        showToast(error.message);
        studentBanButton.disabled = false;
        studentBanButton.textContent = isBanned ? "Unban student" : "Ban student";
      }
      return;
    }

    const deleteRestaurantButton = event.target.closest("[data-delete-restaurant]");
    if (deleteRestaurantButton) {
      const restaurantId = deleteRestaurantButton.dataset.deleteRestaurant;
      const restaurantName = deleteRestaurantButton.dataset.restaurantName || "this restaurant";
      if (!confirm("Delete " + restaurantName + "? It will disappear from the student menu and its login will be disabled. Completed order history will be kept. Restaurants with active orders cannot be deleted.")) return;
      deleteRestaurantButton.disabled = true;
      deleteRestaurantButton.textContent = "Deleting…";
      try {
        const result = await api("/api/admin/restaurants/" + encodeURIComponent(restaurantId), { method: "DELETE" });
        showToast(result.message || "Restaurant deleted.");
        await refreshPublicMenu();
        await loadDashboard();
      } catch (error) {
        showToast(error.message);
        deleteRestaurantButton.disabled = false;
        deleteRestaurantButton.textContent = "Delete restaurant";
      }
      return;
    }

    const statusButton = event.target.closest("[data-save-status]");
    if (statusButton) await saveStatus(statusButton.dataset.saveStatus);

    const assignSelect = event.target.closest("[data-agent-order]");
    if (assignSelect) {
      // Assignment is saved by the adjacent button below.
      const orderId = assignSelect.dataset.agentOrder;
      const existing = document.querySelector(`[data-save-agent="${CSS.escape(orderId)}"]`);
      if (!existing) {
        const button = document.createElement("button");
        button.className = "secondary-button";
        button.textContent = "Assign";
        button.dataset.saveAgent = orderId;
        assignSelect.parentElement.parentElement.appendChild(button);
      }
    }

    const assignButton = event.target.closest("[data-save-agent]");
    if (assignButton) await assignAgent(assignButton.dataset.saveAgent);

    const demoPayButton = event.target.closest("[data-demo-pay]");
    if (demoPayButton) await simulatePayment(demoPayButton.dataset.demoPay);

    if (event.target.closest("#brandHome")) {
      state.selectedRestaurantId = null;
      renderMenu();
      setView("home");
    }
  });

  $("#checkoutForm").addEventListener("submit", placeOrder);

  $("#trackForm").addEventListener("submit", event => {
    event.preventDefault();
    trackOrder($("#trackId").value);
  });
  document.addEventListener("submit", async event => {
    const passwordForm = event.target.closest("#changePasswordForm");
    if (passwordForm) {
      event.preventDefault();
      const message = $("#changePasswordMessage");
      const button = $("#changePasswordButton");
      const values = Object.fromEntries(new FormData(passwordForm).entries());
      if (values.newPassword !== values.confirmPassword) { message.textContent = "New password and confirmation do not match."; return; }
      button.disabled = true;
      message.textContent = "Changing password…";
      try {
        const result = await api("/api/account/change-password", { method: "POST", body: JSON.stringify(values) });
        message.textContent = result.message;
        message.classList.add("success");
        const role = state.account?.role;
        state.account = null;
        updateNavigation();
        setTimeout(() => { location.href = role === "student" ? "/student-login.html" : role === "restaurant" ? "/restaurant-login.html" : role === "agent" ? "/agent-login.html" : "/admin-login.html"; }, 700);
      } catch (error) {
        message.textContent = error.message;
        message.classList.remove("success");
        button.disabled = false;
      }
      return;
    }
    const locationForm = event.target.closest("#restaurantLocationForm");
    if (locationForm) {
      event.preventDefault();
      const button = $("#saveRestaurantLocation");
      const message = $("#restaurantLocationMessage");
      button.disabled = true;
      message.textContent = "Saving location…";
      try {
        const result = await api("/api/restaurant/location", { method: "PUT", body: JSON.stringify({ location: $("#restaurantLocationInput").value.trim() }) });
        const restaurant = state.restaurants.find(item => item.id === state.account.restaurantId);
        if (restaurant) restaurant.location = result.location;
        message.textContent = "Location saved successfully.";
        message.classList.add("success");
        await refreshPublicMenu();
        showToast("Restaurant location updated.");
      } catch (error) {
        message.textContent = error.message;
        message.classList.remove("success");
      } finally { button.disabled = false; }
      return;
    }
    const menuForm = event.target.closest("#restaurantMenuForm");
    if (menuForm) {
      event.preventDefault();
      const message = $("#restaurantMenuMessage");
      const saveButton = $("#saveRestaurantMenu");
      const rows = [...menuForm.querySelectorAll("[data-menu-row]")];
      if (rows.length < 1 || rows.length > 70) return showToast("Your menu must have 1–70 items.");
      const items = rows.map(row => ({
        id: row.querySelector('[name="id"]').value,
        name: row.querySelector('[name="name"]').value.trim(),
        price: Number(row.querySelector('[name="price"]').value),
        category: row.querySelector('[name="category"]').value.trim() || "Meals",
        available: row.querySelector('[name="available"]').checked
      }));
      saveButton.disabled = true;
      message.textContent = "Saving menu…";
      try {
        const result = await api("/api/restaurant/menu", { method: "PUT", body: JSON.stringify({ items }) });
        const restaurant = state.restaurants.find(item => item.id === state.account.restaurantId);
        if (restaurant) restaurant.items = result.items;
        result.items.forEach((item, index) => {
          const idInput = menuForm.querySelectorAll('[name="id"]')[index];
          if (idInput) idInput.value = item.id;
        });
        message.textContent = "Menu saved. Customers will now see the updated prices and availability.";
        $("#menuItemCount").textContent = result.items.length + "/70 items";
        $("#addMenuItem").disabled = result.items.length >= 70;
      } catch (error) { message.textContent = error.message; }
      finally { saveButton.disabled = false; }
      return;
    }
    const addRestaurantForm = event.target.closest("#adminAddRestaurantForm");
    if (addRestaurantForm) {
      event.preventDefault();
      const message = $("#adminAddRestaurantMessage");
      const button = addRestaurantForm.querySelector('button[type="submit"]');
      const values = Object.fromEntries(new FormData(addRestaurantForm).entries());
      values.firstItemPrice = Number(values.firstItemPrice);
      button.disabled = true;
      message.textContent = "Creating restaurant…";
      try {
        const result = await api("/api/admin/restaurants", { method: "POST", body: JSON.stringify(values) });
        message.textContent = result.message + " Restaurant ID: " + result.restaurant.id;
        message.classList.add("success");
        addRestaurantForm.reset();
        await loadDashboard();
        showToast("Restaurant added successfully.");
      } catch (error) {
        message.textContent = error.message;
        message.classList.remove("success");
      } finally { button.disabled = false; }
      return;
    }
    const addAgentForm = event.target.closest("#adminAddAgentForm");
    if (addAgentForm) {
      event.preventDefault();
      const message = $("#adminAddAgentMessage");
      const button = addAgentForm.querySelector('button[type="submit"]');
      const values = Object.fromEntries(new FormData(addAgentForm).entries());
      button.disabled = true;
      message.textContent = "Creating delivery agent…";
      try {
        const result = await api("/api/admin/agents", { method: "POST", body: JSON.stringify(values) });
        message.textContent = result.message + " Agent ID: " + result.agent.id;
        message.classList.add("success");
        addAgentForm.reset();
        await loadDashboard();
        showToast("Delivery agent added successfully.");
      } catch (error) {
        message.textContent = error.message;
        message.classList.remove("success");
      } finally { button.disabled = false; }
      return;
    }
    const restaurantForm = event.target.closest("[data-restaurant-chat-order]");
    if (restaurantForm) {
      event.preventDefault();
      const orderId = restaurantForm.dataset.restaurantChatOrder;
      const input = restaurantForm.elements.message;
      const message = input.value.trim();
      if (!message) return;
      const button = restaurantForm.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        await api("/api/orders/" + encodeURIComponent(orderId) + "/chat", { method: "POST", body: JSON.stringify({ message }) });
        input.value = "";
        const status = document.querySelector('[data-restaurant-chat-status="' + CSS.escape(orderId) + '"]');
        if (status) status.textContent = "Message sent to the delivery agent.";
        await loadRestaurantChat(orderId);
      } catch (error) {
        const status = document.querySelector('[data-restaurant-chat-status="' + CSS.escape(orderId) + '"]');
        if (status) status.textContent = error.message;
      } finally { button.disabled = false; }
      return;
    }
    const agentForm = event.target.closest("[data-agent-chat-order]");
    if (agentForm) {
      event.preventDefault();
      const orderId = agentForm.dataset.agentChatOrder;
      const input = agentForm.elements.message;
      const message = input.value.trim();
      if (!message) return;
      const button = agentForm.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        await api("/api/orders/" + encodeURIComponent(orderId) + "/chat", { method: "POST", body: JSON.stringify({ message }) });
        input.value = "";
        const status = document.querySelector('[data-agent-chat-status="' + CSS.escape(orderId) + '"]');
        if (status) status.textContent = "Message sent to the student.";
        await loadAgentChat(orderId);
      } catch (error) {
        const status = document.querySelector('[data-agent-chat-status="' + CSS.escape(orderId) + '"]');
        if (status) status.textContent = error.message;
      } finally { button.disabled = false; }
      return;
    }
    const form = event.target.closest("#customerChatForm");
    if (!form) return;
    event.preventDefault();
    const input = form.elements.message;
    const message = input.value.trim();
    if (!message) return;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await api("/api/orders/" + encodeURIComponent(form.dataset.chatOrder) + "/chat", { method: "POST", body: JSON.stringify({ message }) });
      input.value = "";
      $("#customerChatStatus").textContent = "Message sent.";
      await loadCustomerChat(form.dataset.chatOrder);
    } catch (error) { $("#customerChatStatus").textContent = error.message; }
    finally { button.disabled = false; }
  });
  try {
    const savedOrderId = localStorage.getItem("coc_last_order_id");
    if (savedOrderId) {
      $("#trackId").value = savedOrderId;
      trackOrder(savedOrderId, true);
    }
  } catch {}
  startTrackingRefresh();
  // Keep student prices and sold-out status current even when the portal stays open.
  window.addEventListener("focus", refreshPublicMenu);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshPublicMenu();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") refreshPublicMenu();
  }, 20000);
}

initialize();
