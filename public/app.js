
const $ = selector => document.querySelector(selector);

const state = {
  restaurants: [],
  selectedRestaurantId: null,
  cart: [],
  account: null,
  lastOrderId: null,
  pendingOrderRequestId: null,
  agents: [],
  availableAgents: [],
  catalogSearchQuery: "",
  deliveryQuote: null
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

const TAKEAWAY_FEE = 200;

function cartSubtotal() {
  const foodSubtotal = state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  return foodSubtotal + (state.cart.length ? TAKEAWAY_FEE : 0);
}

function renderRestaurants() {
  if (!$("#restaurantList")) return;
  const query = state.catalogSearchQuery.trim().toLocaleLowerCase();
  const matches = state.restaurants.map(restaurant => {
    const matchingItems = (restaurant.items || []).filter(item =>
      [item.name, item.category, item.description].some(value => String(value || "").toLocaleLowerCase().includes(query))
    );
    const restaurantMatches = !query || [restaurant.name, restaurant.description, restaurant.location]
      .some(value => String(value || "").toLocaleLowerCase().includes(query));
    return { restaurant, matchingItems, matches: restaurantMatches || matchingItems.length > 0 };
  }).filter(entry => entry.matches);

  const summary = $("#catalogSearchSummary");
  if (summary) {
    summary.textContent = query
      ? `${matches.length} restaurant${matches.length === 1 ? "" : "s"} found for “${state.catalogSearchQuery.trim()}”. Food matches are shown on each card.`
      : `Browse ${state.restaurants.length} restaurant${state.restaurants.length === 1 ? "" : "s"}, or search by restaurant name, meal, or category.`;
  }

  $("#restaurantList").innerHTML = matches.length ? matches.map(({ restaurant, matchingItems }, index) => `
    <article class="restaurant-card">
      <div class="restaurant-banner">${index === 0 ? "🍛" : "🍲"}</div>
      <div class="restaurant-info">
        <h3>${escapeHtml(restaurant.name)}</h3>
        <p>${escapeHtml(restaurant.description)}</p>
        <p class="public-rating">${restaurant.ratingAverage == null ? "☆ Not rated yet" : "★ " + restaurant.ratingAverage + "/5"} <span class="muted">(${restaurant.ratingCount || 0} rating(s))</span></p>
        ${restaurant.location ? `<p class="restaurant-location">📍 ${escapeHtml(restaurant.location)}</p>` : `<p class="restaurant-location muted">📍 Campus location not added yet</p>`}
        ${query && matchingItems.length ? `<p class="search-food-matches"><strong>Matching food:</strong> ${matchingItems.slice(0, 5).map(item => escapeHtml(item.name)).join(", ")}${matchingItems.length > 5 ? ` and ${matchingItems.length - 5} more` : ""}</p>` : ""}
        <button class="secondary-button" data-open-menu="${escapeHtml(restaurant.id)}">Explore menu →</button>
      </div>
    </article>
  `).join("") : `<div class="empty-state catalog-empty"><strong>No matches found.</strong><p>Try another food name, restaurant name, or category.</p></div>`;
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
  if (!$("#menuArea")) return;
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
            <p class="public-rating food-public-rating">${item.ratingAverage == null ? "☆ Not rated yet" : "★ " + item.ratingAverage + "/5"} <span class="muted">(${item.ratingCount || 0})</span></p>
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
  state.pendingOrderRequestId = null;

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
  state.pendingOrderRequestId = null;

  item.qty += amount;
  if (item.qty <= 0) {
    state.cart = state.cart.filter(i => i.id !== itemId);
  }
  renderCart();
}

function renderCart() {
  try { localStorage.setItem("coc_cart", JSON.stringify(state.cart)); } catch {}
  const count = state.cart.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = cartSubtotal();
  const quoteMatchesCart = state.deliveryQuote &&
    state.cart.length && state.deliveryQuote.restaurantId === state.cart[0].restaurantId;
  const delivery = state.cart.length ? 300 : 0;
  const paymentFee = state.cart.length ? Math.round((subtotal + delivery) * 0.01) : 0;

  $("#cartCount").textContent = count;
  $("#cartHeadingCount").textContent = `(${count})`;
  $("#subtotal").textContent = money(subtotal);
  $("#deliveryFee").textContent = money(delivery);
  $("#paymentFee").textContent = money(paymentFee);
  $("#grandTotal").textContent = money(subtotal + delivery + paymentFee);

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
      <div class="cart-row mandatory-cart-item">
        <div>
          <h4>🛍️ Takeaway packaging <span class="muted">(required)</span></h4>
          <p>One-time packaging fee</p>
          <strong>${money(TAKEAWAY_FEE)}</strong>
        </div>
        <span class="tiny muted">Required</span>
      </div>
    `;
  }
  refreshDeliveryQuote();
}

let deliveryMap = null;
let deliveryMarker = null;
let deliveryMapReady = false;
let deliveryQuoteRequestId = 0;

function updateDeliveryQuoteDisplay(quote) {
  const feeElement = $("#deliveryFee");
  const totalElement = $("#grandTotal");
  const estimateElement = $("#deliveryEstimate");
  if (!state.cart.length) {
    if (feeElement) feeElement.textContent = money(0);
    if ($("#paymentFee")) $("#paymentFee").textContent = money(0);
    if (totalElement) totalElement.textContent = money(0);
    if (estimateElement) estimateElement.textContent = "Add food and set a delivery pin to estimate your delivery fee.";
    return;
  }
  const fee = 300;
  const subtotal = cartSubtotal();
  const paymentFee = Math.round((subtotal + fee) * 0.01);
  if (feeElement) feeElement.textContent = money(fee);
  if ($("#paymentFee")) $("#paymentFee").textContent = money(paymentFee);
  if (totalElement) totalElement.textContent = money(subtotal + fee + paymentFee);
  if (estimateElement) {
    estimateElement.textContent = "Fixed delivery fee: ₦300 for every order.";
  }
}

async function refreshDeliveryQuote() {
  const requestId = ++deliveryQuoteRequestId;
  if (!state.cart.length) {
    state.deliveryQuote = null;
    updateDeliveryQuoteDisplay(null);
    return;
  }
  const restaurantId = state.cart[0].restaurantId;
  const latValue = $("#deliveryLatitude")?.value ?? "";
  const lonValue = $("#deliveryLongitude")?.value ?? "";
  updateDeliveryQuoteDisplay(null);
  try {
    const quote = await api("/api/delivery/quote", {
      method: "POST",
      body: JSON.stringify({
        restaurantId,
        latitude: latValue === "" ? undefined : Number(latValue),
        longitude: lonValue === "" ? undefined : Number(lonValue)
      })
    });
    if (requestId !== deliveryQuoteRequestId || !state.cart.length || state.cart[0].restaurantId !== restaurantId) return;
    state.deliveryQuote = { ...quote, restaurantId };
    updateDeliveryQuoteDisplay(state.deliveryQuote);
  } catch (error) {
    if (requestId !== deliveryQuoteRequestId) return;
    state.deliveryQuote = { deliveryFee: 300, restaurantId, distanceBased: false, message: "Fixed delivery fee: ₦300 for every order." };
    updateDeliveryQuoteDisplay(state.deliveryQuote);
  }
}

function isWithinNigeria(latitude, longitude) {
  const lat = Number(latitude), lon = Number(longitude);
  // ChowOnCampus is a Nigeria campus-delivery service; reject stale or mislocated pins such as Portugal.
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 4 && lat <= 14 && lon >= 2 && lon <= 15;
}

function setDeliveryPin(latitude, longitude, zoom = 17, message = "Delivery pin selected.") {
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  if (!isWithinNigeria(lat, lon)) {
    const status = $("#locationMessage");
    if (status) status.textContent = "That pin is outside Nigeria. Please use GPS again or choose your delivery point on the Nigeria map.";
    return;
  }
  $("#deliveryLatitude").value = lat.toFixed(6);
  $("#deliveryLongitude").value = lon.toFixed(6);
  const status = $("#locationMessage");
  if (status) status.textContent = message + " (" + lat.toFixed(5) + ", " + lon.toFixed(5) + ")";
  if (deliveryMapReady && deliveryMap) {
    const point = [lat, lon];
    if (!deliveryMarker) deliveryMarker = window.L.marker(point).addTo(deliveryMap);
    else deliveryMarker.setLatLng(point);
    deliveryMap.setView(point, zoom);
  }
  refreshDeliveryQuote();
}

async function initDeliveryMap() {
  const mapElement = $("#deliveryLocationMap");
  if (!mapElement || deliveryMapReady) return;
  const savedLat = $("#deliveryLatitude").value;
  const savedLon = $("#deliveryLongitude").value;
  const savedPinIsValid = savedLat !== "" && savedLon !== "" && isWithinNigeria(savedLat, savedLon);
  // Never use restaurant pickup coordinates as the student's delivery location.
  // Start over Nigeria-wide unless the student has chosen a valid Nigerian delivery pin.
  if (savedLat !== "" && savedLon !== "" && !savedPinIsValid) {
    $("#deliveryLatitude").value = "";
    $("#deliveryLongitude").value = "";
  }
  const start = savedPinIsValid ? [Number(savedLat), Number(savedLon)] : [9.0820, 8.6753];
  const zoom = savedPinIsValid ? 15 : 6;
  try {
    await loadLeaflet();
    if (!$("#deliveryLocationMap")) return;
    deliveryMap = window.L.map("deliveryLocationMap").setView(start, zoom);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(deliveryMap);
    deliveryMap.on("click", event => setDeliveryPin(event.latlng.lat, event.latlng.lng, 17, "Map pin selected."));
    deliveryMapReady = true;
    if (hasSavedPin) deliveryMarker = window.L.marker(start).addTo(deliveryMap);
    setTimeout(() => deliveryMap?.invalidateSize(), 150);
  } catch (error) {
    const status = $("#locationMessage");
    if (status) status.textContent = "Map could not load. You can still use GPS or enter the address manually.";
  }
}

async function placeOrder(event) {
  event.preventDefault();
  if (!state.account || state.account.role !== "student") {
    showMessage("#checkoutMessage", "Please sign up or log in with a student account before ordering.");
    location.href = "/student-login.html?next=order";
    return;
  }
  if (!state.cart.length) return showMessage("#checkoutMessage", "Add food to your bag first.");
  const emailInput = $("#paymentEmail");
  if (!isLocalDemo && (!emailInput || !emailInput.value.trim() || !emailInput.validity.valid)) {
    emailInput?.focus();
    return showMessage("#checkoutMessage", "Enter a valid email address to receive your payment receipt.");
  }
  if (!state.pendingOrderRequestId) {
    state.pendingOrderRequestId = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : "coc-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }
  const button = $("#placeOrderButton");
  button.disabled = true;
  button.textContent = isLocalDemo ? "Creating demo order…" : "Preparing secure checkout…";
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
        items: state.cart.map(item => ({ id: item.id, qty: item.qty })),
        requestId: state.pendingOrderRequestId
      })
    });
    const order = result.order;
    if (!isLocalDemo) {
      const payment = await api("/api/orders/" + encodeURIComponent(order.id) + "/paystack/initialize", {
        method: "POST",
        body: JSON.stringify({ email: emailInput.value.trim() })
      });
      state.pendingOrderRequestId = null;
      state.lastOrderId = order.id;
      try { localStorage.setItem("coc_last_order_id", order.id); } catch {}
      showMessage("#checkoutMessage", "Order " + order.id + " is ready. Redirecting you to Paystack to pay " + money(order.total) + ".", true);
      location.href = payment.authorizationUrl;
      return;
    }

    state.pendingOrderRequestId = null;
    state.lastOrderId = order.id;
    try { localStorage.setItem("coc_last_order_id", order.id); } catch {}
    state.cart = [];
    renderCart();
    const checkoutForm = $("#checkoutForm");
    if (checkoutForm) checkoutForm.reset();
    if (deliveryMarker && deliveryMap) { deliveryMap.removeLayer(deliveryMarker); deliveryMarker = null; }
    deliveryQuoteRequestId++;
    state.deliveryQuote = null;
    if ($("#locationMessage")) $("#locationMessage").textContent = "Enter your location manually, use GPS, or click the map to choose a delivery pin.";
    if ($("#deliveryLatitude")) $("#deliveryLatitude").value = "";
    if ($("#deliveryLongitude")) $("#deliveryLongitude").value = "";
    $("#trackId").value = order.id;
    showMessage("#checkoutMessage", "Demo order " + order.id + " created. No payment has been made.", true);
    showToast("Demo order created!");
    await trackOrder(order.id);
    $("#trackingSection").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showMessage("#checkoutMessage", error.message);
  } finally {
    button.disabled = false;
    button.textContent = isLocalDemo ? "Place demo order →" : "Continue to secure payment →";
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
      <p>Food and packaging: <strong>${money(order.subtotal)}</strong></p><p>Delivery fee: <strong>${money(order.deliveryFee)}</strong></p><p>Payment fee (1%): <strong>${money(order.paymentFee || 0)}</strong></p><p>Total paid/payable: <strong>${money(order.total)}</strong></p>
      <p>Payment: <strong>${escapeHtml(order.paymentStatus || "Check with the restaurant")}</strong></p>
      <p class="tiny muted">Last updated: ${escapeHtml(new Date(order.updatedAt || order.createdAt).toLocaleString())}</p>
      ${isLocalDemo && order.paymentStatus === "Unpaid — demo only" ? `<button class="primary-button" data-demo-pay="${escapeHtml(order.id)}">Simulate demo payment (no money charged)</button>` : ""}
      ${state.account?.role === "student" && !isLocalDemo && !["Paid — Paystack verified", "Paid — demo verified"].includes(order.paymentStatus) && order.status !== "Cancelled" ? `<button class="primary-button" data-pay-order="${escapeHtml(order.id)}">Continue secure payment</button>` : ""}
      <p class="tiny muted">Tracking refreshes automatically every 15 seconds while this page is open.</p>
      ${state.account?.role === "student" && (["Ready for pickup", "Out for delivery"].includes(order.status) || (order.status === "Completed" && Date.now() - new Date(order.deliveredAt || order.completedAt || 0).getTime() < 120000)) ? '<section class="temporary-chat-preview"><div><h4>Temporary delivery chat</h4><p class="tiny muted">Chat with your assigned delivery agent. The chat closes two minutes after delivery.</p></div><button type="button" class="primary-button" data-open-temp-chat="${escapeHtml(order.id)}" data-chat-title="Delivery agent">Open full-page chat ↗</button></section>' : ""}
    </article>`;
  if (state.account?.role === "student" && (["Ready for pickup", "Out for delivery"].includes(order.status) || (order.status === "Completed" && Date.now() - new Date(order.deliveredAt || order.completedAt || 0).getTime() < 120000))) loadCustomerChat(order.id);
}

let activeFullPageChatOrderId = null;
let fullPageChatPollTimer = null;
function closeFullPageChat() {
  const page = $("#temporaryChatPage");
  if (page) page.classList.add("hidden");
  document.body.classList.remove("chat-page-open");
  activeFullPageChatOrderId = null;
  if (fullPageChatPollTimer) clearInterval(fullPageChatPollTimer);
  fullPageChatPollTimer = null;
}
async function refreshFullPageChat(orderId = activeFullPageChatOrderId) {
  if (!orderId || orderId !== activeFullPageChatOrderId) return;
  const messagesBox = $("#fullPageChatMessages");
  if (!messagesBox) return;
  try {
    const result = await api("/api/orders/" + encodeURIComponent(orderId) + "/chat");
    if (orderId !== activeFullPageChatOrderId) return;
    messagesBox.innerHTML = result.messages.length ? result.messages.map(m =>
      '<article class="full-chat-message ' + (m.senderRole === state.account?.role ? "mine" : "theirs") + '"><div class="full-chat-message-meta"><strong>' + escapeHtml(m.senderName) + '</strong><time>' + escapeHtml(new Date(m.sentAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})) + '</time></div><p>' + escapeHtml(m.message) + '</p></article>'
    ).join("") : '<div class="full-chat-empty"><span>👋</span><strong>Start the conversation</strong><p>Send a message to coordinate this delivery.</p></div>';
    messagesBox.scrollTop = messagesBox.scrollHeight;
    const note = $("#fullPageChatNotice");
    if (note) note.textContent = result.expiresAt ? "Chat closes at " + new Date(result.expiresAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) + "." : "Messages are available during delivery and for two minutes after completion.";
  } catch (error) {
    const isOrderMissing = /could not be found by the chat service|order not found/i.test(error.message);
    messagesBox.innerHTML = '<div class="full-chat-error"><p>' + escapeHtml(error.message) + '</p>' +
      (isOrderMissing ? '<button type="button" class="secondary-button" id="retryFullPageChat">↻ Retry chat</button>' : '') +
      '</div>';
    const input = $("#fullPageChatForm")?.elements.message;
    if (input) input.disabled = isOrderMissing;
    const send = $("#fullPageChatForm")?.querySelector('button[type="submit"]');
    if (send) send.disabled = isOrderMissing;
  }
}
function openFullPageChat(orderId, title = "Delivery chat") {
  const page = $("#temporaryChatPage");
  if (!page) return showToast("Chat screen is unavailable. Refresh the page and try again.");
  activeFullPageChatOrderId = orderId;
  $("#fullPageChatTitle").textContent = title;
  $("#fullPageChatOrderRef").textContent = "Order " + orderId;
  $("#fullPageChatMessages").innerHTML = '<p class="muted">Loading messages…</p>';
  $("#fullPageChatNotice").textContent = "Connecting to your delivery chat…";
  $("#fullPageChatForm").elements.message.disabled = false;
  $("#fullPageChatForm").querySelector('button[type="submit"]').disabled = false;
  page.classList.remove("hidden");
  document.body.classList.add("chat-page-open");
  refreshFullPageChat(orderId);
  if (fullPageChatPollTimer) clearInterval(fullPageChatPollTimer);
  fullPageChatPollTimer = setInterval(() => refreshFullPageChat(orderId), 4000);
  $("#fullPageChatInput").focus({preventScroll:true});
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


function renderStudentRating(order) {
  if (!state.account || state.account.role !== "student" || order.status !== "Completed") return "";
  if (order.rating) return '<section class="rating-panel"><strong>✓ You rated this order</strong><p class="muted">Thanks for sharing your feedback.</p></section>';
  const options = '<option value="">Choose stars</option><option value="5">★★★★★ — Excellent</option><option value="4">★★★★ — Good</option><option value="3">★★★ — Okay</option><option value="2">★★ — Poor</option><option value="1">★ — Very poor</option>';
  const food = order.items.map(item => '<label>' + escapeHtml(item.name) + ' rating<select name="food-' + escapeHtml(item.id) + '" required>' + options + '</select></label>').join("");
  return '<section class="rating-panel"><div class="dashboard-section-heading"><div><span class="eyebrow">YOUR FEEDBACK</span><h3>Rate this order</h3><p>Choose 1–5 stars for the food and service.</p></div></div>' +
    '<form data-order-rating="' + escapeHtml(order.id) + '">' +
    '<label>Restaurant rating<select name="restaurantRating" required>' + options + '</select></label>' +
    (order.assignedAgentId ? '<label>Delivery agent rating<select name="agentRating" required>' + options + '</select></label>' : '') +
    '<div class="rating-food-list">' + food + '</div>' +
    '<label>Comment (optional)<textarea name="comment" maxlength="500" rows="2" placeholder="Tell us what went well or what we can improve"></textarea></label>' +
    '<button type="submit" class="primary-button">Submit rating</button><p class="muted" role="status" data-rating-message></p></form></section>';
}

function renderOrderCard(order) {
  const statuses = availableStatuses(order);
  const canAssign = state.account.role === "admin" && order.status !== "Completed";
  const canShowAvailableAgents = state.account.role === "restaurant" && order.status === "Ready for pickup" && !order.assignedAgentId;
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
      ${order.status === "Completed" ? `<p class="muted">Delivered: ${escapeHtml(order.deliveredAt || order.completedAt ? new Date(order.deliveredAt || order.completedAt).toLocaleString() : "Time not recorded")}</p>` : ""}
      ${order.assignedAgentId ? `<p>Assigned agent: <strong>${escapeHtml(state.agents.find(agent => agent.id === order.assignedAgentId)?.name || order.assignedAgentId)}</strong></p>` : ""}
      ${canShowAvailableAgents ? `
        <section class="agent-contact" aria-live="polite">
          <strong>Available delivery agents</strong>
          ${state.availableAgents.length ? `<ul>${state.availableAgents.map(agent => `<li>${escapeHtml(agent.name)} — online and available</li>`).join("")}</ul><p class="tiny muted">The system assigns an available agent automatically. Refresh orders after an agent comes online.</p>` : '<p class="tiny muted">No agents are online and available right now. This order will wait until an agent comes online.</p>'}
        </section>
      ` : ""}
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
          <div><span class="eyebrow">PICKUP COORDINATION</span><strong>Assigned delivery agent: ${escapeHtml(order.assignedAgentId)}</strong><p class="tiny muted">Open a dedicated full-page chat to coordinate pickup and delivery.</p></div>
          <button type="button" class="primary-button" data-open-temp-chat="${escapeHtml(order.id)}" data-chat-title="Delivery agent">Open full-page chat ↗</button>
        </section>
      ` : ""}
      ${canDeliveryChat && state.account.role === "agent" ? `
        <section class="agent-contact">
          <div><span class="eyebrow">TEMPORARY DELIVERY CHAT</span><strong>Student order conversation</strong><p class="tiny muted">Coordinate pickup and delivery with the student in a dedicated full-page chat.</p></div>
          <button type="button" class="primary-button" data-open-temp-chat="${escapeHtml(order.id)}" data-chat-title="Student">Open full-page chat ↗</button>
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
      ${renderStudentRating(order)}
    </article>
  `;
}

async function loadRestaurantRatings() {
  const summary = $("#restaurantRatingsSummary"), reviews = $("#restaurantRecentReviews");
  if (!summary || !reviews) return;
  try {
    const data = await api("/api/ratings/summary");
    const restaurant = (data.restaurants || [])[0];
    summary.innerHTML = '<article><span>Restaurant rating</span><strong>' + (restaurant && restaurant.average != null ? '★ ' + Number(restaurant.average).toFixed(1) + '/5' : 'Not rated yet') + '</strong><small>' + Number(restaurant?.count || 0) + ' student review(s)</small></article><article><span>Rated orders</span><strong>' + Number(data.totalReviews || 0) + '</strong><small>Completed orders reviewed</small></article>';
    const recent = (data.reviews || []).slice(0, 10);
    reviews.innerHTML = recent.length ? recent.map(review => '<article class="order-card"><strong>' + escapeHtml(review.restaurantName || 'Restaurant') + ' · ' + (review.restaurantRating ? '★ ' + review.restaurantRating + '/5' : 'No restaurant score') + '</strong><p class="muted">Student: ' + escapeHtml(review.studentName || 'Student') + ' · Order ' + escapeHtml(review.orderId || '—') + '</p>' + (review.agentRating ? '<p>Delivery agent rating: ★ ' + escapeHtml(review.agentRating) + '/5</p>' : '') + ((review.foodRatings || []).length ? '<p>Food: ' + review.foodRatings.map(food => escapeHtml(food.itemName) + ' ★ ' + escapeHtml(food.rating) + '/5').join(' · ') + '</p>' : '') + (review.comment ? '<p>' + escapeHtml(review.comment) + '</p>' : '') + '<small class="muted">Delivered: ' + escapeHtml(review.deliveredAt ? new Date(review.deliveredAt).toLocaleString() : 'Time not recorded') + ' · Rated: ' + escapeHtml(review.ratedAt ? new Date(review.ratedAt).toLocaleString() : '—') + '</small></article>').join('') : '<div class="empty-state compact-empty">No student ratings yet. Ratings appear here after students review completed orders.</div>';
  } catch (error) { summary.innerHTML = '<p class="muted">' + escapeHtml(error.message || 'Could not load ratings.') + '</p>'; }
}
document.addEventListener("click", event => { if (event.target.closest("#refreshRestaurantRatings")) loadRestaurantRatings(); });

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

let restaurantPickupMap = null;
let restaurantPickupMarker = null;
let restaurantPickupMapReady = false;

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (window.__cocLeafletPromise) return window.__cocLeafletPromise;
  window.__cocLeafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-coc-leaflet]')) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      css.dataset.cocLeaflet = "1";
      document.head.appendChild(css);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Map could not load. Check your internet connection and try again."));
    document.head.appendChild(script);
  });
  return window.__cocLeafletPromise;
}

function setRestaurantPickupPin(latitude, longitude, zoom = 17) {
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  $("#restaurantPickupLatitude").value = lat.toFixed(6);
  $("#restaurantPickupLongitude").value = lon.toFixed(6);
  $("#restaurantPickupCoordinates").textContent = lat.toFixed(6) + ", " + lon.toFixed(6);
  if (restaurantPickupMapReady && restaurantPickupMap) {
    const point = [lat, lon];
    if (!restaurantPickupMarker) restaurantPickupMarker = window.L.marker(point).addTo(restaurantPickupMap);
    else restaurantPickupMarker.setLatLng(point);
    restaurantPickupMap.setView(point, zoom);
  }
}

async function initRestaurantPickupMap(restaurant) {
  const mapElement = $("#restaurantPickupMap");
  if (!mapElement) return;
  const initialLat = Number(restaurant.latitude);
  const initialLon = Number(restaurant.longitude);
  const hasPin = restaurant.latitude !== null && restaurant.latitude !== undefined &&
    restaurant.longitude !== null && restaurant.longitude !== undefined &&
    Number.isFinite(initialLat) && Number.isFinite(initialLon);
  try {
    await loadLeaflet();
    if (!$("#restaurantPickupMap")) return;
    restaurantPickupMap = window.L.map("restaurantPickupMap").setView(
      hasPin ? [initialLat, initialLon] : [9.0820, 8.6753], hasPin ? 16 : 6
    );
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(restaurantPickupMap);
    restaurantPickupMap.on("click", event => setRestaurantPickupPin(event.latlng.lat, event.latlng.lng, 17));
    restaurantPickupMapReady = true;
    if (hasPin) setRestaurantPickupPin(initialLat, initialLon, 16);
    setTimeout(() => restaurantPickupMap && restaurantPickupMap.invalidateSize(), 100);
  } catch (error) {
    const status = $("#restaurantPickupMapMessage");
    if (status) status.textContent = error.message;
  }
}

function showRestaurantDashboardPanel(targetId) {
  const dashboard = document.getElementById("dashboardContent");
  if (!dashboard || state.account?.role !== "restaurant") return;
  dashboard.querySelectorAll(".restaurant-view-panel").forEach(panel => {
    panel.hidden = panel.id !== targetId;
  });
  const target = document.getElementById(targetId);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderRestaurantMenuManager() {
  if (!state.account || state.account.role !== "restaurant") return;
  const restaurant = state.restaurants.find(item => item.id === state.account.restaurantId);
  if (!restaurant) return;
  const container = document.createElement("section");
  container.className = "restaurant-menu-manager restaurant-view-panel";
  container.hidden = true;
  container.id = "restaurantMenuManager";
  container.innerHTML = `
    <section class="restaurant-location-manager">
      <div class="dashboard-section-heading"><div><span class="eyebrow">PICKUP POINT</span><h2>Restaurant location</h2><p>Save written pickup instructions and set the exact GPS pin so the nearest available agent can find your restaurant.</p></div></div>
      <form id="restaurantLocationForm">
        <label for="restaurantLocationInput">Restaurant location / pickup instructions</label>
        <input id="restaurantLocationInput" name="location" maxlength="180" value="${escapeHtml(restaurant.location || "")}" placeholder="e.g. Student Centre, Block B, beside the library">
        <div class="menu-editor-actions"><button type="submit" class="primary-button" id="saveRestaurantLocation">Save address</button><span id="restaurantLocationMessage" class="muted" role="status"></span></div>
      </form>
      <div class="pickup-gps-tools">
        <h3>Exact pickup GPS</h3>
        <p class="muted">Tap Use my GPS while standing at the restaurant, or click anywhere on the map to place or adjust the pickup pin.</p>
        <div id="restaurantPickupMap" class="restaurant-pickup-map" role="application" aria-label="Click the map to choose the restaurant pickup point"></div>
        <input type="hidden" id="restaurantPickupLatitude" value="${restaurant.latitude ?? ""}">
        <input type="hidden" id="restaurantPickupLongitude" value="${restaurant.longitude ?? ""}">
        <p class="muted">Selected coordinates: <strong id="restaurantPickupCoordinates">${restaurant.latitude != null && restaurant.longitude != null ? escapeHtml(Number(restaurant.latitude).toFixed(6)+", "+Number(restaurant.longitude).toFixed(6)) : "No pickup pin saved yet"}</strong></p>
        <div class="menu-editor-actions"><button type="button" class="secondary-button" id="restaurantUseGps">Use my GPS</button><button type="button" class="primary-button" id="saveRestaurantPickupPin">Save pickup pin</button><span id="restaurantPickupMapMessage" class="muted" role="status"></span></div>
      </div>
    </section>
    <div id="restaurantMenuEditor" hidden>
      <div class="dashboard-section-heading"><div><span class="eyebrow">YOUR MENU</span><h2>Manage food and prices</h2><p>Add up to 70 items and mark anything unavailable as sold out.</p></div><span class="count-pill" id="menuItemCount">${restaurant.items.length}/70 items</span></div>
      <form id="restaurantMenuForm" tabindex="-1" aria-label="Add and edit food items">
        <div id="restaurantMenuRows">${restaurant.items.map(item => renderMenuRow(item)).join("")}</div>
        <div class="menu-editor-actions"><button type="button" class="secondary-button" id="addMenuItem" ${restaurant.items.length >= 70 ? "disabled" : ""}>＋ Add item</button><button type="submit" class="primary-button" id="saveRestaurantMenu">Save menu</button></div>
        <p id="restaurantMenuMessage" class="muted" role="status"></p>
      </form>
    </div>`;
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
      state.availableAgents = result.agents.filter(agent => agent.online && !agent.activeOrderId);
    } else if (account.role === "restaurant") {
      const result = await api("/api/agents/available");
      state.availableAgents = result.agents;
      state.agents = [];
    } else {
      state.agents = [];
      state.availableAgents = [];
    }

    const { orders } = await api("/api/orders");
    if (account.role === "restaurant") {
      const incoming = orders.filter(order => ["Awaiting payment", "Confirmed"].includes(order.status));
      const preparing = orders.filter(order => order.status === "Preparing");
      const pickup = orders.filter(order => ["Ready for pickup", "Out for delivery"].includes(order.status));
      const completed = orders.filter(order => ["Completed", "Cancelled"].includes(order.status));
      const section = (title, subtitle, list, key) => `
        <section class="dashboard-order-section restaurant-view-panel" id="restaurant-section-${key}" hidden>
          <div class="dashboard-section-heading"><div><h2>${title}</h2><p>${subtitle}</p></div><span class="count-pill">${list.length}</span></div>
          ${list.length ? `<div class="order-list">${list.map(renderOrderCard).join("")}</div>` : `<div class="empty-state compact-empty">No ${key} orders right now.</div>`}
        </section>`;
      const totalSales = orders.filter(order => order.status === "Completed").reduce((sum, order) => sum + Number(order.total || 0), 0);
      $("#dashboardContent").innerHTML = `
        <div class="restaurant-welcome"><div><span class="eyebrow">RESTAURANT WORKSPACE</span><h2>Welcome, ${escapeHtml(account.name)}!</h2><p>Let's get orders moving. Review incoming orders, prepare meals and coordinate pickup with your delivery agent.</p></div><button class="secondary-button" id="refreshRestaurantOrders" type="button">↻ Refresh orders</button></div>
        <nav class="restaurant-quick-actions" aria-label="Restaurant dashboard shortcuts">
          <button type="button" class="secondary-button" data-restaurant-jump="restaurant-section-incoming">📥 Incoming orders</button>
          <button type="button" class="secondary-button" data-restaurant-jump="restaurant-section-preparing">🍳 In the kitchen</button>
          <button type="button" class="secondary-button" data-restaurant-jump="restaurant-section-pickup">🛵 Pickup & delivery</button>
          <button type="button" class="secondary-button" data-restaurant-jump="restaurant-section-completed">📋 Order history</button>
          <button type="button" class="secondary-button" data-show-menu-editor>➕ Add / Edit food items</button>
          <button type="button" class="secondary-button" data-restaurant-jump="restaurantMenuManager">📍 Manage menu & location</button>
          <button type="button" class="secondary-button" data-restaurant-jump="restaurantRatingsPanel">⭐ Customer ratings</button>
          <button type="button" class="secondary-button" data-show-password-form>🔐 Change password</button>
        </nav>
        <div class="restaurant-metrics">
          <article><span>Incoming</span><strong>${incoming.length}</strong><small>Awaiting action</small></article>
          <article><span>Preparing</span><strong>${preparing.length}</strong><small>In the kitchen</small></article>
          <article><span>Pickup / delivery</span><strong>${pickup.length}</strong><small>Agent coordination</small></article>
          <article><span>Completed sales</span><strong>${money(totalSales)}</strong><small>${completed.filter(o => o.status === "Completed").length} completed orders</small></article>
        </div>
        ${section("Incoming orders", "New orders that need your attention", incoming, "incoming")}
        ${section("In the kitchen", "Orders currently being prepared", preparing, "preparing")}
        ${section("Ready for pickup & delivery", "Contact your assigned agent and coordinate handoff", pickup, "pickup")}
        ${section("Order history", "Completed and cancelled orders", completed, "completed")}<section class="dashboard-order-section restaurant-view-panel" id="restaurantRatingsPanel" hidden><div class="dashboard-section-heading"><div><h2>Customer ratings &amp; feedback</h2><p>Student ratings for your restaurant and delivery experience.</p></div><button class="secondary-button" id="refreshRestaurantRatings" type="button">Refresh ratings</button></div><div id="restaurantRatingsSummary" class="restaurant-metrics"><p class="muted">Loading customer ratings…</p></div><div id="restaurantRecentReviews" class="order-list"></div></section>`;
      loadRestaurantRatings();
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
            <button type="button" class="secondary-button" data-admin-jump="adminRestaurantPartners">View / delete restaurants</button>
          </div>
        </section>
        <section class="dashboard-order-section" id="adminRestaurantPartners">
          <div class="dashboard-section-heading"><div><h2>Restaurant partners · Delete</h2><p>Delete controls are shown here for each registered restaurant. Restaurants with active orders cannot be deleted.</p></div></div>
          ${restaurantRows || '<div class="empty-state">No restaurant partners found.</div>'}
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
        <section class="dashboard-order-section">
          <div class="dashboard-section-heading"><div><h2>Orders</h2><p>Manage orders and assign delivery agents.</p></div><span class="count-pill">${orders.length}</span></div>
          ${orders.length ? `<div class="order-list">${orders.map(renderOrderCard).join("")}</div>` : '<div class="empty-state">No orders here yet. New orders will appear when customers place them.</div>'}
        </section>`;
    } else if (account.role === "agent") {
      const activeDeliveryOrders = orders.filter(order =>
        order.assignedAgentId === account.agentId && ["Ready for pickup", "Out for delivery"].includes(order.status)
      );
      const completedDeliveryOrders = orders.filter(order => order.assignedAgentId === account.agentId && order.status === "Completed");
      $("#dashboardContent").innerHTML = `
        <div class="restaurant-welcome">
          <div><span class="eyebrow">DELIVERY AGENT WORKSPACE</span><h2>Welcome, ${escapeHtml(account.name)}!</h2><p>Manage your assigned deliveries here. Open the full-page student chat on an active order to coordinate pickup and delivery.</p></div>
          <div class="student-dashboard-actions"><button class="secondary-button" type="button" id="refreshAgentOrders">↻ Refresh deliveries</button></div>
        </div>
        <section class="dashboard-order-section">
          <div class="dashboard-section-heading"><div><h2>Active deliveries</h2><p>Use the full-page chat while the order is ready for pickup or out for delivery.</p></div><span class="count-pill">${activeDeliveryOrders.length}</span></div>
          ${activeDeliveryOrders.length ? `<div class="order-list">${activeDeliveryOrders.map(renderOrderCard).join("")}</div>` : `<div class="empty-state">You have no active deliveries right now. New assignments will appear here.</div>`}
        </section>
        <section class="dashboard-order-section">
          <div class="dashboard-section-heading"><div><h2>Completed deliveries</h2><p>Your recent completed orders.</p></div><span class="count-pill">${completedDeliveryOrders.length}</span></div>
          ${completedDeliveryOrders.length ? `<div class="order-list">${completedDeliveryOrders.slice(0,10).map(renderOrderCard).join("")}</div>` : `<div class="empty-state">No completed deliveries yet.</div>`}
        </section>`;
    } else {
      $("#dashboardContent").innerHTML = `
        <div class="restaurant-welcome">
          <div><span class="eyebrow">STUDENT WORKSPACE</span><h2>Welcome, ${escapeHtml(account.name)}!</h2><p>Ready for your next meal? Check your orders below or head back to the menu to find something delicious.</p></div>
          <div class="student-dashboard-actions"><button class="secondary-button" type="button" data-view="home">Browse food</button><button class="secondary-button" type="button" data-show-password-form>🔐 Change password</button></div>
        </div>
        ${orders.length
          ? `<div class="order-list">${orders.map(renderOrderCard).join("")}</div>`
          : `<div class="empty-state">You have no orders yet. Browse the menu and place your first order!</div>`}`;
    }


    if (["admin", "restaurant", "agent"].includes(account.role)) {
      try {
        const ratingResult = await api("/api/ratings/summary");
        const ratingList = (items, title) => '<div class="rating-summary-group"><h3>' + title + '</h3>' +
          (items.length ? items.map(item => '<article class="rating-summary-row"><div><strong>' + escapeHtml(item.name) + '</strong><p class="muted">' + item.count + ' review(s)</p></div><span class="rating-average">' + (item.average == null ? '—' : '★ ' + item.average + '/5') + '</span></article>').join('') : '<p class="muted">No ratings yet.</p>') + '</div>';
        const reviewRows = ratingResult.reviews.slice(0, 15).map(review =>
          '<article class="rating-review-row"><div><strong>' + escapeHtml(review.restaurantName) + '</strong><span class="muted"> · Order ' + escapeHtml(review.orderId) + '</span></div><p class="muted">Review from ' + escapeHtml(review.studentName || "Student") + '</p>' +
          '<p>Restaurant: ★ ' + review.restaurantRating + '/5' + (review.agentRating ? ' · Agent: ★ ' + review.agentRating + '/5' : '') + '</p>' +
          '<p class="muted">' + (review.foodRatings || []).map(food => escapeHtml(food.itemName) + ' ★ ' + food.rating + '/5').join(' · ') + '</p>' +
          (review.comment ? '<p>' + escapeHtml(review.comment) + '</p>' : '') +
          '<small class="muted">' + (review.ratedAt ? escapeHtml(new Date(review.ratedAt).toLocaleDateString()) : '') + '</small></article>').join('');
        const ratingPanel = document.createElement("section");
        ratingPanel.className = "dashboard-order-section ratings-dashboard";
        const ratingHeading = account.role === "admin" ? "All ratings & reviews" : account.role === "restaurant" ? "Your restaurant ratings & reviews" : "Your delivery ratings & reviews";
        const ratingDescription = account.role === "admin" ? "Review customer feedback across every restaurant, food item and delivery agent." : account.role === "restaurant" ? "See ratings for your restaurant and menu items. Only your restaurant's reviews are shown." : "See customer ratings for deliveries assigned to you. Only your delivery feedback is shown.";
        ratingPanel.innerHTML = '<div class="dashboard-section-heading"><div><span class="eyebrow">CUSTOMER FEEDBACK</span><h2>' + ratingHeading + '</h2><p>' + ratingDescription + ' ' + ratingResult.totalReviews + ' review(s) available.</p></div></div>' +
          '<div class="ratings-summary-grid">' + ratingList(ratingResult.restaurants, 'Restaurant ratings') + ratingList(ratingResult.food, 'Food ratings') + ratingList(ratingResult.agents, 'Delivery-agent ratings') + '</div>' +
          '<div class="rating-reviews"><h3>Recent reviews</h3>' + (reviewRows || '<p class="muted">Reviews will appear here after students rate completed orders.</p>') + '</div>';
        $("#dashboardContent").appendChild(ratingPanel);
      } catch (error) { console.error("Could not load rating summary:", error); }
    }

    const securityPanel = document.createElement("section");
    securityPanel.className = "dashboard-order-section" + (account.role === "restaurant" ? " restaurant-view-panel" : "");
    securityPanel.hidden = account.role === "restaurant";
    const canTogglePasswordForm = ["student", "restaurant"].includes(account.role);
    securityPanel.id = "accountSecurityPanel";
    securityPanel.innerHTML = `
      <div class="dashboard-section-heading"><div><span class="eyebrow">ACCOUNT SECURITY</span><h2>Change password</h2><p>Use your current password to set a new one (10–128 characters). You will need to log in again after changing it.</p></div></div>
      ${canTogglePasswordForm ? `<button type="button" class="secondary-button password-toggle-button" id="togglePasswordForm" aria-expanded="false">🔐 Change password</button>` : ""}
      <form id="changePasswordForm" class="order-card" ${canTogglePasswordForm ? "hidden" : ""}>
        <label>Current password<input name="currentPassword" type="password" required autocomplete="current-password"></label>
        <label>New password<input name="newPassword" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label>
        <label>Confirm new password<input name="confirmPassword" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label>
        <button class="primary-button" type="submit" id="changePasswordButton">Change password</button>
        <p id="changePasswordMessage" class="muted" role="status"></p>
      </form>`;
    $("#dashboardContent").appendChild(securityPanel);

    if (account.role === "admin" || account.role === "agent") {
      await loadEarningsPanel();
    }
  } catch (error) {
    $("#dashboardContent").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function loadEarningsPanel(selectedMonth = "") {
  const panel = $("#earningsPanel");
  if (!panel || !state.account || !["admin", "agent"].includes(state.account.role)) return;
  panel.innerHTML = '<div class="earnings-card"><p class="loading">Loading monthly earnings and payment records…</p></div>';
  try {
    const queryMonth = selectedMonth || "";
    const result = await api("/api/earnings" + (queryMonth ? "?month=" + encodeURIComponent(queryMonth) : ""));
    const month = result.month;
    const paymentRows = (result.payments || []).map(payment => {
      const paidDate = payment.paidAt ? new Date(payment.paidAt).toLocaleString() : "—";
      return '<tr><td>' + escapeHtml(paidDate) + '</td>' +
        (state.account.role === "admin" ? '<td>' + escapeHtml(payment.agentName || "Delivery agent") + '</td>' : '') +
        '<td><strong>' + money(payment.amount) + '</strong></td>' +
        '<td>' + escapeHtml(payment.reference || "—") + '</td>' +
        '<td>' + escapeHtml(payment.note || "—") + '</td>' +
        (state.account.role === "admin" ? '<td>' + escapeHtml(payment.paidBy || "—") + '</td>' : '') +
        '</tr>';
    }).join("");
    const historyTable = '<div style="overflow-x:auto"><table class="admin-student-table" style="width:100%;border-collapse:collapse;text-align:left"><thead><tr><th style="padding:10px">Paid date</th>' +
      (state.account.role === "admin" ? '<th style="padding:10px">Agent</th>' : '') +
      '<th style="padding:10px">Amount</th><th style="padding:10px">Transfer reference</th><th style="padding:10px">Note</th>' +
      (state.account.role === "admin" ? '<th style="padding:10px">Recorded by</th>' : '') +
      '</tr></thead><tbody>' + (paymentRows || '<tr><td colspan="' + (state.account.role === "admin" ? 6 : 4) + '" style="padding:12px">No payment records for this month.</td></tr>') + '</tbody></table></div>';

    if (state.account.role === "agent") {
      const agent = result.agent || { completedDeliveries: 0, earned: 0, paid: 0, outstanding: 0 };
      panel.innerHTML = `
        <section class="earnings-card">
          <div class="dashboard-section-heading"><div><span class="eyebrow">${escapeHtml(month)} · YOUR MONTHLY EARNINGS</span><h2>${money(agent.earned)}</h2><p>${agent.completedDeliveries} completed deliveries × delivery earnings rate</p></div></div>
          <div class="restaurant-metrics">
            <article><span>Earned</span><strong>${money(agent.earned)}</strong><small>Completed deliveries</small></article>
            <article><span>Paid</span><strong>${money(agent.paid)}</strong><small>Recorded payouts</small></article>
            <article><span>Outstanding</span><strong>${money(agent.outstanding)}</strong><small>Still to be paid</small></article>
          </div>
          <div class="order-actions" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-top:14px">
            <label>View month<input id="agentEarningsMonth" type="month" value="${escapeHtml(month)}" max="${escapeHtml(new Date().toISOString().slice(0,7))}"></label>
            <button type="button" class="secondary-button" data-refresh-earnings="agent">View month</button>
          </div>
          <p class="tiny muted">${escapeHtml(result.note || "Monthly delivery earnings and recorded payouts.")}</p>
        </section>
        <section class="dashboard-order-section"><div class="dashboard-section-heading"><div><h3>Monthly payment records</h3><p>Only payments recorded by an administrator appear here.</p></div></div>${historyTable}</section>`;
      return;
    }

    const agents = result.agents || [];
    const agentRows = agents.map(agent => {
      const noBalance = Number(agent.outstanding) <= 0;
      return '<tr>' +
        '<td style="padding:10px"><strong>' + escapeHtml(agent.name) + '</strong><br><small>' + escapeHtml(agent.username || agent.id) + '</small></td>' +
        '<td style="padding:10px">' + agent.completedDeliveries + '</td>' +
        '<td style="padding:10px">' + money(agent.earned) + '</td>' +
        '<td style="padding:10px">' + money(agent.paid) + '</td>' +
        '<td style="padding:10px"><strong>' + money(agent.outstanding) + '</strong></td>' +
        '<td style="padding:10px;min-width:260px">' +
          '<form data-agent-payment-form="' + escapeHtml(agent.id) + '" style="display:grid;gap:7px">' +
            '<label>Amount (₦)<input name="amount" type="number" min="1" max="' + Math.max(0, Number(agent.outstanding) || 0) + '" step="1" value="' + Math.max(0, Number(agent.outstanding) || 0) + '" required ' + (noBalance ? 'disabled' : '') + '></label>' +
            '<label>Transfer reference (optional)<input name="reference" maxlength="120" placeholder="Bank transfer reference" ' + (noBalance ? 'disabled' : '') + '></label>' +
            '<label>Note (optional)<input name="note" maxlength="300" placeholder="Payment note" ' + (noBalance ? 'disabled' : '') + '></label>' +
            '<button class="primary-button" type="submit" ' + (noBalance ? 'disabled' : '') + '>' + (noBalance ? 'No balance due' : 'Record payment') + '</button>' +
          '</form></td></tr>';
    }).join("");
    panel.innerHTML = `
      <section class="earnings-card">
        <div class="dashboard-section-heading"><div><span class="eyebrow">${escapeHtml(month)} · AGENT PAYROLL</span><h2>Monthly earnings &amp; payouts</h2><p>Delivery earnings are calculated at the configured per-delivery rate. Record a payment only after the transfer is actually made.</p></div></div>
        <div class="restaurant-metrics">
          <article><span>Deliveries</span><strong>${result.totals.completedDeliveries}</strong><small>Completed this month</small></article>
          <article><span>Total earned</span><strong>${money(result.totals.earned)}</strong><small>All agents</small></article>
          <article><span>Recorded as paid</span><strong>${money(result.totals.paid)}</strong><small>Recorded payouts</small></article>
          <article><span>Outstanding</span><strong>${money(result.totals.outstanding)}</strong><small>Still to be paid</small></article>
        </div>
        <div class="order-actions" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-top:14px">
          <label>Payroll month<input id="adminEarningsMonth" type="month" value="${escapeHtml(month)}" max="${escapeHtml(new Date().toISOString().slice(0,7))}"></label>
          <button type="button" class="secondary-button" data-refresh-earnings="admin">View month</button>
        </div>
        <p class="tiny muted">${escapeHtml(result.note || "")}</p>
      </section>
      <section class="dashboard-order-section"><div class="dashboard-section-heading"><div><h3>Agent earnings &amp; payment entry</h3><p>Partial payments are supported. The outstanding balance decreases as payment records are added.</p></div></div>
        <div style="overflow-x:auto"><table class="admin-student-table" style="width:100%;border-collapse:collapse;text-align:left"><thead><tr><th style="padding:10px">Agent</th><th style="padding:10px">Deliveries</th><th style="padding:10px">Earned</th><th style="padding:10px">Paid</th><th style="padding:10px">Outstanding</th><th style="padding:10px">Record a payout</th></tr></thead><tbody>${agentRows || '<tr><td colspan="6" style="padding:12px">No delivery agents have been added yet.</td></tr>'}</tbody></table></div>
      </section>
      <section class="dashboard-order-section"><div class="dashboard-section-heading"><div><h3>Payment history</h3><p>Saved payout records for ${escapeHtml(month)}.</p></div></div>${historyTable}</section>`;
  } catch (error) {
    panel.innerHTML = '<div class="empty-state">Could not load earnings records: ' + escapeHtml(error.message) + '</div>';
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
  if ($("#year")) $("#year").textContent = new Date().getFullYear();
  try { const savedCart = JSON.parse(localStorage.getItem("coc_cart") || "[]"); if (Array.isArray(savedCart)) state.cart = savedCart.filter(item => item && item.id && item.restaurantId && Number(item.qty) > 0); } catch { state.cart = []; }

  try {
    const result = await api("/api/menu");
    state.restaurants = result.restaurants;
    renderRestaurants();
  } catch (error) {
    if ($("#restaurantList")) $("#restaurantList").innerHTML = `<div class="empty-state">Could not load the menu. Please refresh the page.</div>`;
  }

  renderCart();
  updateNavigation();

  // The delivery map starts inside a collapsed disclosure; recalculate its size when opened.
  const deliveryDisclosure = $("#deliveryDetailsDisclosure");
  if (deliveryDisclosure) {
    deliveryDisclosure.addEventListener("toggle", () => {
      if (deliveryDisclosure.open) setTimeout(() => deliveryMap?.invalidateSize(), 180);
    });
  }
  initDeliveryMap();

  try {
    const result = await api("/api/me");
    state.account = result.account;
    updateNavigation();
    const params = new URLSearchParams(location.search);
    if (state.account && ["student", "restaurant", "agent"].includes(state.account.role) && params.get("dashboard") === "1") {
      setView("dashboard");
      history.replaceState({}, "", location.pathname);
    }
  } catch (error) {
    console.error(error);
  }

  document.addEventListener("click", async event => {
    const earningsRefresh = event.target.closest("[data-refresh-earnings]");
    if (earningsRefresh) {
      const monthInput = $("#adminEarningsMonth") || $("#agentEarningsMonth");
      await loadEarningsPanel(monthInput?.value || "");
      return;
    }
    const gpsButton = event.target.closest("#useMyLocation");
    if (gpsButton) {
      const message = $("#locationMessage");
      if (!navigator.geolocation) { message.textContent = "GPS is not supported by this browser. Please enter your location manually."; return; }
      gpsButton.disabled = true;
      message.textContent = "Requesting your location permission…";
      navigator.geolocation.getCurrentPosition(position => {
        setDeliveryPin(position.coords.latitude, position.coords.longitude, 17, "Current GPS location selected.");
        gpsButton.disabled = false;
      }, error => {
        message.textContent = error.code === 1 ? "Location permission was denied. Enter your hostel and landmark manually, or allow location in browser settings." : "Could not get GPS location. Check device location settings or enter your address manually.";
        gpsButton.disabled = false;
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
      return;
    }
    const deliveryMapButton = event.target.closest("#deliveryMapPickGps");
    if (deliveryMapButton) {
      const message = $("#locationMessage");
      if (!navigator.geolocation) { message.textContent = "GPS is not supported. Click the map to choose your delivery pin."; return; }
      deliveryMapButton.disabled = true;
      message.textContent = "Requesting location permission…";
      navigator.geolocation.getCurrentPosition(position => {
        setDeliveryPin(position.coords.latitude, position.coords.longitude, 17, "Current GPS location selected.");
        deliveryMapButton.disabled = false;
      }, error => {
        message.textContent = error.code === 1
          ? "Location permission was denied. Allow location in browser settings or click the map to choose a pin."
          : "Could not get GPS. Check device location settings or click the map to choose a pin.";
        deliveryMapButton.disabled = false;
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
      return;
    }
    const openChatButton = event.target.closest("[data-open-temp-chat]");
    if (openChatButton) { openFullPageChat(openChatButton.dataset.openTempChat, openChatButton.dataset.chatTitle || "Delivery chat"); return; }
    if (event.target.closest("#retryFullPageChat")) { const input = $("#fullPageChatForm")?.elements.message; if (input) input.disabled = false; const send = $("#fullPageChatForm")?.querySelector('button[type="submit"]'); if (send) send.disabled = false; refreshFullPageChat(); return; }
    if (event.target.closest("#closeFullPageChat")) { closeFullPageChat(); return; }
    if (event.target.closest("#temporaryChatPage") && event.target === $("#temporaryChatPage")) { closeFullPageChat(); return; }
    const viewButton = event.target.closest("[data-view]");
    if (viewButton && viewButton.dataset.view !== "login") setView(viewButton.dataset.view);

    if (event.target.closest("#catalogSearchForm")) {
      // Form submission is handled below; this branch intentionally does not intercept the click.
    }
    const clearCatalogSearch = event.target.closest("#clearCatalogSearch");
    if (clearCatalogSearch) {
      state.catalogSearchQuery = "";
      const searchInput = $("#catalogSearchInput");
      if (searchInput) searchInput.value = "";
      renderRestaurants();
      return;
    }

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

    const showPasswordButton = event.target.closest("[data-show-password-form]");
    if (showPasswordButton) {
      const form = document.getElementById("changePasswordForm");
      const toggle = document.getElementById("togglePasswordForm");
      const panel = document.getElementById("accountSecurityPanel");
      if (state.account?.role === "restaurant") showRestaurantDashboardPanel("accountSecurityPanel");
      if (form) {
        form.hidden = false;
        if (toggle) { toggle.setAttribute("aria-expanded", "true"); toggle.textContent = "✕ Close password form"; }
        panel?.scrollIntoView({ behavior: "smooth", block: "start" });
        form.querySelector("input[name=currentPassword]")?.focus({ preventScroll: true });
      }
      return;
    }

    if (event.target.closest("#togglePasswordForm")) {
      const toggle = event.target.closest("#togglePasswordForm");
      const form = document.getElementById("changePasswordForm");
      if (form) {
        form.hidden = !form.hidden;
        toggle.setAttribute("aria-expanded", String(!form.hidden));
        toggle.textContent = form.hidden ? "🔐 Change password" : "✕ Close password form";
        if (!form.hidden) form.querySelector("input[name=currentPassword]")?.focus({ preventScroll: true });
      }
      return;
    }

    const showMenuEditorButton = event.target.closest("[data-show-menu-editor]");
    if (showMenuEditorButton) {
      const manager = document.getElementById("restaurantMenuManager");
      const editor = document.getElementById("restaurantMenuEditor");
      const locationPanel = manager?.querySelector(".restaurant-location-manager");
      if (state.account?.role === "restaurant") showRestaurantDashboardPanel("restaurantMenuManager");
      if (locationPanel) locationPanel.hidden = true;
      if (editor) {
        editor.hidden = false;
        editor.scrollIntoView({ behavior: "smooth", block: "start" });
        document.getElementById("restaurantMenuForm")?.focus({ preventScroll: true });
      }
      return;
    }

    const restaurantJumpButton = event.target.closest("[data-restaurant-jump]");
    if (restaurantJumpButton) {
      const targetId = restaurantJumpButton.dataset.restaurantJump;
      if (state.account?.role === "restaurant") {
        showRestaurantDashboardPanel(targetId);
        const manager = document.getElementById("restaurantMenuManager");
        if (targetId === "restaurantMenuManager" && manager) {
          const locationPanel = manager.querySelector(".restaurant-location-manager");
          const editor = document.getElementById("restaurantMenuEditor");
          if (locationPanel) locationPanel.hidden = false;
          if (editor) editor.hidden = true;
          if (!restaurantPickupMapReady) {
            const restaurant = state.restaurants.find(item => item.id === state.account.restaurantId);
            if (restaurant) initRestaurantPickupMap(restaurant);
          } else if (restaurantPickupMap) {
            setTimeout(() => restaurantPickupMap && restaurantPickupMap.invalidateSize(), 100);
          }
        }
      } else {
        document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
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

    const payOrderButton = event.target.closest("[data-pay-order]");
    if (payOrderButton) {
      payOrderButton.disabled = true;
      payOrderButton.textContent = "Opening secure checkout…";
      try {
        const payment = await api("/api/orders/" + encodeURIComponent(payOrderButton.dataset.payOrder) + "/paystack/initialize", {
          method: "POST",
          body: JSON.stringify({ email: $("#paymentEmail")?.value?.trim() || "" })
        });
        location.href = payment.authorizationUrl;
      } catch (error) {
        showToast(error.message);
        payOrderButton.disabled = false;
        payOrderButton.textContent = "Continue secure payment";
      }
      return;
    }

    if (event.target.closest("#brandHome")) {
      state.selectedRestaurantId = null;
      renderMenu();
      setView("home");
    }
  });

  const catalogSearchForm = $("#catalogSearchForm");
  if (catalogSearchForm) {
    catalogSearchForm.addEventListener("submit", event => {
      event.preventDefault();
      state.catalogSearchQuery = $("#catalogSearchInput").value.trim();
      renderRestaurants();
    });
  }

  $("#checkoutForm").addEventListener("submit", placeOrder);

  $("#trackForm").addEventListener("submit", event => {
    event.preventDefault();
    trackOrder($("#trackId").value);
  });
  document.addEventListener("submit", async event => {

    const fullChatForm = event.target.closest("#fullPageChatForm");
    if (fullChatForm) {
      event.preventDefault();
      const input = fullChatForm.elements.message;
      const message = input.value.trim();
      const orderId = activeFullPageChatOrderId;
      if (!message || !orderId) return;
      const button = fullChatForm.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await api("/api/orders/" + encodeURIComponent(orderId) + "/chat", {method:"POST", body:JSON.stringify({message})});
        input.value = "";
        await refreshFullPageChat(orderId);
        input.focus({preventScroll:true});
      } catch (error) { $("#fullPageChatNotice").textContent = error.message; }
      finally { if (orderId === activeFullPageChatOrderId && input.isConnected && !input.disabled) button.disabled = false; }
      return;
    }
    const agentPaymentForm = event.target.closest("[data-agent-payment-form]");
    if (agentPaymentForm) {
      event.preventDefault();
      const button = agentPaymentForm.querySelector('button[type="submit"]');
      const values = new FormData(agentPaymentForm);
      const month = $("#adminEarningsMonth")?.value || "";
      const payload = {
        agentId: agentPaymentForm.dataset.agentPaymentForm,
        month,
        amount: Number(values.get("amount")),
        reference: String(values.get("reference") || "").trim(),
        note: String(values.get("note") || "").trim()
      };
      button.disabled = true;
      button.textContent = "Saving record…";
      try {
        const result = await api("/api/admin/agent-payments", { method: "POST", body: JSON.stringify(payload) });
        showToast(result.message || "Payment record saved.");
        await loadEarningsPanel(month);
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
        button.textContent = "Record payment";
      }
      return;
    }
    const ratingForm = event.target.closest("[data-order-rating]");
    if (ratingForm) {
      event.preventDefault();
      const button = ratingForm.querySelector('button[type="submit"]');
      const message = ratingForm.querySelector("[data-rating-message]");
      const values = new FormData(ratingForm);
      const foodRatings = Array.from(ratingForm.querySelectorAll('select[name^="food-"]')).map(select => ({ itemId: select.name.slice(5), rating: Number(select.value) }));
      const payload = { restaurantRating: Number(values.get("restaurantRating")), agentRating: values.get("agentRating") ? Number(values.get("agentRating")) : null, foodRatings, comment: String(values.get("comment") || "").trim() };
      button.disabled = true;
      message.textContent = "Submitting your ratings…";
      try {
        const result = await api("/api/orders/" + encodeURIComponent(ratingForm.dataset.orderRating) + "/rating", { method: "POST", body: JSON.stringify(payload) });
        message.textContent = result.message;
        showToast("Thanks for your feedback!");
        await loadDashboard();
      } catch (error) { message.textContent = error.message; button.disabled = false; }
      return;
    }
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
    if (event.target.closest("#refreshAgentOrders")) { await loadDashboard(); return; }
    const useRestaurantGps = event.target.closest("#restaurantUseGps");
    if (useRestaurantGps) {
      const message = $("#restaurantPickupMapMessage");
      if (!navigator.geolocation) { message.textContent = "GPS is not supported by this browser. Click the map to place the pin manually."; return; }
      useRestaurantGps.disabled = true;
      message.textContent = "Requesting location permission…";
      navigator.geolocation.getCurrentPosition(position => {
        setRestaurantPickupPin(position.coords.latitude, position.coords.longitude, 17);
        message.textContent = "GPS selected. Save the pickup pin to keep it.";
        useRestaurantGps.disabled = false;
      }, error => {
        message.textContent = error.code === 1 ? "Location permission denied. Allow location in browser settings or click the map to place the pin." : "Could not get GPS. Check device location settings or click the map.";
        useRestaurantGps.disabled = false;
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
      return;
    }
    const saveRestaurantPin = event.target.closest("#saveRestaurantPickupPin");
    if (saveRestaurantPin) {
      const message = $("#restaurantPickupMapMessage");
      const latitude = $("#restaurantPickupLatitude").value;
      const longitude = $("#restaurantPickupLongitude").value;
      if (latitude === "" || longitude === "") { message.textContent = "Use GPS or click the map to choose a pickup point first."; return; }
      saveRestaurantPin.disabled = true;
      message.textContent = "Saving pickup pin…";
      try {
        const result = await api("/api/restaurant/location-coordinates", { method: "PATCH", body: JSON.stringify({ latitude: Number(latitude), longitude: Number(longitude) }) });
        const restaurant = state.restaurants.find(item => item.id === state.account.restaurantId);
        if (restaurant) { restaurant.latitude = result.latitude; restaurant.longitude = result.longitude; }
        message.textContent = "Pickup pin saved. The system can now use this restaurant location to find the nearest available agent.";
        showToast("Restaurant pickup pin saved.");
      } catch (error) {
        message.textContent = error.message;
      } finally { saveRestaurantPin.disabled = false; }
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
        if (addRestaurantForm) addRestaurantForm.reset();
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
        if (addAgentForm) addAgentForm.reset();
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
  const paymentParams = new URLSearchParams(location.search);
  if (paymentParams.get("payment") === "paystack") {
    const callbackOrderId = paymentParams.get("orderId") || "";
    const paymentReference = paymentParams.get("reference") || paymentParams.get("trxref") || "";
    history.replaceState({}, document.title, location.pathname + location.hash);
    if (!callbackOrderId || !paymentReference) {
      showMessage("#checkoutMessage", "Payment was not confirmed. If you were charged, contact support with your Paystack receipt.");
    } else {
      showMessage("#checkoutMessage", "Verifying your payment securely…");
      try {
        const verification = await api("/api/payments/paystack/verify", {
          method: "POST",
          body: JSON.stringify({ orderId: callbackOrderId, reference: paymentReference })
        });
        state.lastOrderId = callbackOrderId;
        try { localStorage.setItem("coc_last_order_id", callbackOrderId); } catch {}
        $("#trackId").value = callbackOrderId;
        showMessage("#checkoutMessage", verification.message || "Payment verified and order confirmed.", true);
        showToast("Payment verified. Your order is confirmed.");
        await trackOrder(callbackOrderId);
        $("#trackingSection").scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        showMessage("#checkoutMessage", error.message + " If you were charged, keep your payment reference and contact support.");
        $("#trackId").value = callbackOrderId;
        await trackOrder(callbackOrderId);
        $("#trackingSection").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }
  try {
    const savedOrderId = localStorage.getItem("coc_last_order_id");
    if (savedOrderId) {
      $("#trackId").value = savedOrderId;
      trackOrder(savedOrderId, true);
    }
  } catch {}
  startTrackingRefresh();
  // Keep the restaurant dashboard in sync when an agent completes a delivery.
  window.setInterval(() => {
    if (state.account?.role !== "restaurant" || document.visibilityState !== "visible") return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    loadDashboard();
  }, 15000);
  window.addEventListener("focus", () => {
    if (state.account?.role === "restaurant") loadDashboard();
  });
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
