const $ = selector => document.querySelector(selector);
const money = amount => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
let restaurants = [];
let selectedRestaurantId = null;
let searchQuery = "";
const escapeHtml = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function getCart() {
  try { const value = JSON.parse(localStorage.getItem("coc_cart") || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function saveCart(cart) {
  try { localStorage.setItem("coc_cart", JSON.stringify(cart)); } catch {}
  $("#restaurantCartCount").textContent = cart.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
}
function renderRestaurants() {
  const query = searchQuery.trim().toLocaleLowerCase();
  const matched = restaurants.filter(r => !query ||
    [r.name, r.description, r.location].some(v => String(v || "").toLocaleLowerCase().includes(query)) ||
    (r.items || []).some(i => [i.name, i.category, i.description].some(v => String(v || "").toLocaleLowerCase().includes(query))));
  $("#restaurantSearchSummary").textContent = query
    ? matched.length + " restaurant(s) match “" + searchQuery + "”."
    : "Browse " + restaurants.length + " restaurant(s), or search by restaurant name or meal.";
  $("#restaurantList").innerHTML = matched.length ? matched.map((r, index) =>
    '<article class="restaurant-card"><div class="restaurant-banner">' + (index % 2 === 0 ? "🍛" : "🍲") +
    '</div><div class="restaurant-info"><h3>' + escapeHtml(r.name) + '</h3><p>' +
    escapeHtml(r.description || "Fresh meals made for campus life.") + '</p><p class="public-rating">' +
    (r.ratingAverage == null ? "☆ Not rated yet" : "★ " + r.ratingAverage + "/5") +
    '<span class="muted"> (' + (r.ratingCount || 0) + ' rating(s))</span></p><p class="restaurant-location">' +
    (r.location ? "📍 " + escapeHtml(r.location) : "📍 Campus location not added yet") +
    '</p><button class="secondary-button" type="button" data-open-menu="' + escapeHtml(r.id) + '">' +
    (selectedRestaurantId === r.id ? "Hide menu ↑" : "Explore menu →") + '</button></div></article>'
  ).join("") : '<div class="empty-state catalog-empty"><strong>No restaurants found.</strong><p>Try another search.</p></div>';
  renderSelectedMenu();
}
function renderSelectedMenu() {
  const r = restaurants.find(item => item.id === selectedRestaurantId);
  if (!r) { $("#restaurantMenuArea").innerHTML = ""; return; }
  const items = (r.items || []).map(item =>
    '<article class="food-card ' + (item.available === false ? "food-sold-out" : "") +
    '"><div class="food-emoji">' + escapeHtml(item.emoji || "🍽️") + '</div><div class="food-info"><h3>' +
    escapeHtml(item.name) + '</h3><span class="muted">' + escapeHtml(item.category || "Meal") +
    '</span><p class="public-rating food-public-rating">' +
    (item.ratingAverage == null ? "☆ Not rated yet" : "★ " + item.ratingAverage + "/5") +
    '</p><div class="food-bottom"><span class="price">' + money(item.price) + '</span>' +
    (item.available === false ? '<span class="sold-out-label">Sold out</span>' :
      '<button type="button" class="add-button" data-add-item="' + escapeHtml(item.id) +
      '" aria-label="Add ' + escapeHtml(item.name) + '">+</button>') +
    '</div></div></article>'
  ).join("");
  $("#restaurantMenuArea").innerHTML =
    '<section class="content-section"><div class="section-heading"><div><span class="eyebrow">NOW SERVING</span><h2>' +
    escapeHtml(r.name) + ' menu</h2></div><button type="button" class="text-button" id="closeRestaurantMenu">Close menu ×</button></div>' +
    '<div class="food-grid">' + (items || '<p class="muted">This restaurant has not added its menu yet.</p>') +
    '</div><p id="restaurantCartMessage" class="small-note" aria-live="polite"></p><a class="primary-button" href="/#cartSection">Continue to cart →</a></section>';
}
async function loadRestaurants() {
  try {
    const response = await fetch("/api/menu", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load restaurants.");
    const data = await response.json();
    restaurants = Array.isArray(data.restaurants) ? data.restaurants : [];
    renderRestaurants();
  } catch (error) {
    $("#restaurantList").innerHTML = '<div class="empty-state"><strong>Restaurants could not load.</strong><p>Please refresh and try again.</p></div>';
    $("#restaurantSearchSummary").textContent = error.message;
  }
}
document.addEventListener("click", event => {
  const open = event.target.closest("[data-open-menu]");
  if (open) {
    const id = open.dataset.openMenu;
    selectedRestaurantId = selectedRestaurantId === id ? null : id;
    renderRestaurants();
    if (selectedRestaurantId) $("#restaurantMenuArea").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (event.target.closest("#closeRestaurantMenu")) {
    selectedRestaurantId = null;
    renderRestaurants();
    return;
  }
  const add = event.target.closest("[data-add-item]");
  if (!add) return;
  const r = restaurants.find(item => item.id === selectedRestaurantId);
  const item = r && r.items.find(entry => entry.id === add.dataset.addItem);
  if (!r || !item || item.available === false) return;
  let cart = getCart();
  if (cart.length && cart[0].restaurantId !== r.id) {
    if (!confirm("Your bag contains food from another restaurant. Clear it and start a new order?")) return;
    cart = [];
  }
  const existing = cart.find(entry => entry.id === item.id);
  if (existing) {
    if (existing.qty >= 20) return;
    existing.qty += 1;
  } else {
    cart.push({ id: item.id, name: item.name, price: Number(item.price), emoji: item.emoji || "🍽️", qty: 1, restaurantId: r.id, restaurantName: r.name });
  }
  saveCart(cart);
  const message = $("#restaurantCartMessage");
  if (message) message.textContent = item.name + " added to your bag. Your bag has " + cart.reduce((sum, entry) => sum + entry.qty, 0) + " item(s).";
});
$("#restaurantSearchForm").addEventListener("submit", event => {
  event.preventDefault();
  searchQuery = $("#restaurantSearch").value.trim();
  renderRestaurants();
});
$("#clearRestaurantSearch").addEventListener("click", () => {
  searchQuery = "";
  $("#restaurantSearch").value = "";
  renderRestaurants();
});
$("#year").textContent = new Date().getFullYear();
saveCart(getCart());
loadRestaurants();