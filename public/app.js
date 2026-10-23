
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
  $("#dashboardNav").classList.toggle("hidden", !state.account || !["admin", "restaurant", "agent"].includes(state.account.role));
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
        <button class="secondary-button" data-open-menu="${escapeHtml(restaurant.id)}">
          Explore menu →
        </button>
      </div>
    </article>
  `).join("");
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
        <article class="food-card">
          <div class="food-emoji">${escapeHtml(item.emoji)}</div>
          <div class="food-info">
            <h3>${escapeHtml(item.name)}</h3>
            <span class="muted">${escapeHtml(item.category)}</span>
            <div class="food-bottom">
              <span class="price">${money(item.price)}</span>
              <button class="add-button" aria-label="Add ${escapeHtml(item.name)}"
                data-add="${escapeHtml(item.id)}">+</button>
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
      ${state.account?.role === "student" && order.status === "Out for delivery" ? '<section style="margin-top:18px;padding:16px;border:1px solid #dce9df;border-radius:14px;background:#f8fbf8"><h4>Temporary delivery chat</h4><p class="tiny muted">Chat with your assigned delivery agent. Messages are automatically deleted when delivery is completed or cancelled.</p><div id="customerChatMessages" aria-live="polite" style="max-height:240px;overflow:auto;display:grid;gap:8px;margin:12px 0"><p class="tiny muted">Loading chat…</p></div><form id="customerChatForm" data-chat-order="${escapeHtml(order.id)}" style="display:flex;gap:8px;flex-wrap:wrap"><input name="message" maxlength="500" required placeholder="Message your delivery agent…" style="flex:1;min-width:180px;padding:12px;border:1px solid #cbd9cf;border-radius:10px;font:inherit"><button class="primary-button" type="submit">Send</button></form><p id="customerChatStatus" class="tiny muted" role="status"></p></section>' : ""}
    </article>`;
  if (state.account?.role === "student" && order.status === "Out for delivery") loadCustomerChat(order.id);
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

  return `
    <article class="order-card">
      <div class="order-top">
        <div><span class="eyebrow">${escapeHtml(order.restaurantName)}</span><h3>${escapeHtml(order.id)}</h3></div>
        <span class="status">${escapeHtml(order.status)}</span>
      </div>
      <p><strong>${escapeHtml(order.customerName)}</strong> · ${escapeHtml(order.customerPhone)}</p>
      <p>Delivery location: ${escapeHtml(order.hostel)}</p>
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

async function loadDashboard() {
  if (!state.account) { location.href = "/student-login.html"; return; }

  const account = state.account;
  $("#dashboardTitle").textContent = ({
    admin: "Admin dashboard",
    restaurant: "Restaurant orders",
    agent: "Delivery dashboard"
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
      document.querySelectorAll("[data-restaurant-chat-order]").forEach(form => loadRestaurantChat(form.dataset.restaurantChatOrder));
    } else {
      $("#dashboardContent").innerHTML = orders.length
        ? `<div class="order-list">${orders.map(renderOrderCard).join("")}</div>`
        : `<div class="empty-state">No orders here yet. New orders will appear when customers place them.</div>`;
    }

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
}

initialize();
