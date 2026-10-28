const $ = selector => document.querySelector(selector);
const money = amount => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(Number(amount) || 0);
const escapeHtml = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const coverPhotos = [
  "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=1400&q=85",
  "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=1400&q=85",
  "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1400&q=85",
  "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=1400&q=85",
  "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1400&q=85"
];
let restaurants = [];
let restaurant = null;
let searchQuery = "";
let selectedCategory = "All";
function getCart() { try { const value = JSON.parse(localStorage.getItem("coc_cart") || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function saveCart(cart) { try { localStorage.setItem("coc_cart", JSON.stringify(cart)); } catch {} updateCartCount(); }
function updateCartCount() { const node = $("#stallCartCount"); if (node) node.textContent = getCart().reduce((sum, item) => sum + (Number(item.qty) || 0), 0); }
function renderStall() {
  if (!restaurant) return;
  const items = restaurant.items || [];
  const categories = ["All", ...new Set(items.map(item => String(item.category || "Meals").trim()).filter(Boolean))];
  const filtered = items.filter(item => {
    const categoryMatch = selectedCategory === "All" || String(item.category || "Meals") === selectedCategory;
    const textMatch = !searchQuery || [item.name, item.description, item.category].some(value => String(value || "").toLowerCase().includes(searchQuery.toLowerCase()));
    return categoryMatch && textMatch;
  });
  const index = Math.max(0, restaurants.findIndex(item => item.id === restaurant.id));
  $("#stallContent").innerHTML = '<section class="stall-hero"><div class="stall-hero-image"><img src="' + coverPhotos[index % coverPhotos.length] + '" alt="Food from ' + escapeHtml(restaurant.name) + '"></div><div class="stall-hero-overlay"></div><div class="stall-hero-copy"><span class="eyebrow">YOUR CAMPUS FOOD STOP</span><h1>' + escapeHtml(restaurant.name) + '</h1><p>' + escapeHtml(restaurant.description || "Fresh favourites made for campus life.") + '</p><div class="stall-meta"><span>★ ' + (restaurant.ratingAverage == null ? 'New stall' : Number(restaurant.ratingAverage).toFixed(1) + '/5') + '</span><span>' + (restaurant.ratingCount || 0) + ' rating(s)</span><span>' + (restaurant.location ? '⌖ ' + escapeHtml(restaurant.location) : '⌖ On campus') + '</span></div></div></section>' +
    '<section class="stall-menu-section"><div class="stall-menu-heading"><div><span class="eyebrow">MADE FRESH, ORDERED EASY</span><h2>Explore the menu</h2><p>Choose your favourites. Sold-out items are clearly marked.</p></div><span class="stall-item-count">' + items.filter(item => item.available !== false).length + ' available</span></div>' +
    '<div class="stall-menu-tools"><label class="stall-menu-search"><span aria-hidden="true">⌕</span><input id="stallMenuSearch" type="search" maxlength="100" placeholder="Search this menu…" value="' + escapeHtml(searchQuery) + '" aria-label="Search this menu"></label><div class="stall-category-filters" id="stallCategoryFilters">' + categories.map(category => '<button type="button" class="category-chip ' + (selectedCategory === category ? 'active' : '') + '" data-stall-category="' + escapeHtml(category) + '">' + escapeHtml(category) + '</button>').join("") + '</div></div>' +
    '<div class="stall-food-grid">' + (filtered.length ? filtered.map(item => '<article class="stall-food-card ' + (item.available === false ? 'is-unavailable' : '') + '"><div class="stall-food-art" aria-hidden="true"><span>' + escapeHtml(item.emoji || '🍽️') + '</span>' + (item.available === false ? '<span class="stall-sold-out">Sold out</span>' : '<span class="stall-fresh-tag">Available</span>') + '</div><div class="stall-food-info"><div class="stall-food-title"><div><h3>' + escapeHtml(item.name) + '</h3><p>' + escapeHtml(item.category || 'Meals') + '</p></div><span class="stall-food-rating">' + (item.ratingAverage == null ? '☆' : '★ ' + Number(item.ratingAverage).toFixed(1)) + '</span></div>' + (item.description ? '<p class="stall-food-description">' + escapeHtml(item.description) + '</p>' : '') + '<div class="stall-food-footer"><strong>' + money(item.price) + '</strong>' + (item.available === false ? '<button type="button" class="stall-add-button" disabled>Unavailable</button>' : '<button type="button" class="stall-add-button" data-add-stall-item="' + escapeHtml(item.id) + '"><span>＋</span> Add to bag</button>') + '</div></div></article>').join("") : '<div class="empty-state catalog-empty"><strong>No menu items match.</strong><p>Try another search or category.</p><button type="button" class="secondary-button" id="clearStallFilters">Clear filters</button></div>') + '</div><p id="stallCartMessage" class="stall-cart-message" aria-live="polite"></p></section>';
  $("#stallMenuSearch").addEventListener("input", event => { searchQuery = event.target.value; const start = event.target.selectionStart; renderStall(); const input = $("#stallMenuSearch"); input.focus(); input.setSelectionRange(start, start); });
}
async function loadStall() {
  try {
    const response = await fetch("/api/menu", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load the campus menu.");
    const data = await response.json();
    restaurants = Array.isArray(data.restaurants) ? data.restaurants : [];
    const id = new URLSearchParams(location.search).get("id");
    restaurant = restaurants.find(item => String(item.id) === String(id));
    if (!restaurant) {
      $("#stallContent").innerHTML = '<div class="stall-loading"><span class="stall-loading-icon">🔎</span><h1>We couldn’t find that stall.</h1><p>It may have been removed or the link is incomplete.</p><a class="primary-button" href="/restaurants.html">Explore all restaurants</a></div>';
      return;
    }
    document.title = restaurant.name + " | Chowoncampus";
    renderStall();
  } catch (error) {
    $("#stallContent").innerHTML = '<div class="stall-loading"><span class="stall-loading-icon">⚠️</span><h1>Menu unavailable</h1><p>' + escapeHtml(error.message) + '</p><button class="secondary-button" type="button" id="retryStallLoad">Try again</button></div>';
  }
}
document.addEventListener("click", event => {
  const category = event.target.closest("[data-stall-category]");
  if (category) { selectedCategory = category.dataset.stallCategory; renderStall(); return; }
  if (event.target.closest("#clearStallFilters")) { selectedCategory = "All"; searchQuery = ""; renderStall(); return; }
  if (event.target.closest("#retryStallLoad")) { loadStall(); return; }
  const add = event.target.closest("[data-add-stall-item]");
  if (!add || !restaurant) return;
  const item = restaurant.items.find(entry => String(entry.id) === String(add.dataset.addStallItem));
  if (!item || item.available === false) return;
  let cart = getCart();
  if (cart.length && String(cart[0].restaurantId) !== String(restaurant.id)) {
    if (!confirm("Your bag contains food from another restaurant. Clear it and start a new order?")) return;
    cart = [];
  }
  const existing = cart.find(entry => String(entry.id) === String(item.id));
  if (existing) { if (existing.qty >= 20) { $("#stallCartMessage").textContent = "Maximum quantity is 20 per item."; return; } existing.qty += 1; }
  else cart.push({ id: item.id, name: item.name, price: Number(item.price), emoji: item.emoji || "🍽️", qty: 1, restaurantId: restaurant.id, restaurantName: restaurant.name });
  saveCart(cart);
  $("#stallCartMessage").textContent = item.name + " added to your bag · " + cart.reduce((sum, entry) => sum + Number(entry.qty || 0), 0) + " item(s) in bag.";
});
$("#year").textContent = new Date().getFullYear();
updateCartCount();
loadStall();