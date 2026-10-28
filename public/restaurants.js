const $ = selector => document.querySelector(selector);
const money = amount => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(Number(amount) || 0);
const escapeHtml = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const coverPhotos = [
  "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80"
];
let restaurants = [];
let searchQuery = "";
let selectedCategory = "All";
function getCart() { try { const value = JSON.parse(localStorage.getItem("coc_cart") || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function updateCartCount() { const node = $("#restaurantCartCount"); if (node) node.textContent = getCart().reduce((sum, item) => sum + (Number(item.qty) || 0), 0); }
function categoryMatches(restaurant) {
  if (selectedCategory === "All") return true;
  const categories = (restaurant.items || []).map(item => String(item.category || "Meals").toLowerCase());
  if (selectedCategory === "Meals") return categories.some(category => !/(snack|drink|beverage|juice|water|smoothie)/.test(category));
  return categories.some(category => category.includes(selectedCategory.toLowerCase()));
}
function renderRestaurants() {
  const query = searchQuery.trim().toLocaleLowerCase();
  const matched = restaurants.map((restaurant, index) => ({ restaurant, index })).filter(({ restaurant }) => {
    const textMatch = !query || [restaurant.name, restaurant.description, restaurant.location].some(value => String(value || "").toLocaleLowerCase().includes(query)) ||
      (restaurant.items || []).some(item => [item.name, item.category, item.description].some(value => String(value || "").toLocaleLowerCase().includes(query)));
    return textMatch && categoryMatches(restaurant);
  });
  $("#restaurantSearchSummary").textContent = query
    ? matched.length + " stall(s) match “" + searchQuery + "”."
    : "Explore " + restaurants.length + " campus stall(s). Choose one to see its full menu.";
  $("#restaurantList").innerHTML = matched.length ? matched.map(({ restaurant: r, index }) => {
    const availableItems = (r.items || []).filter(item => item.available !== false).length;
    const preview = (r.items || []).slice(0, 3).map(item => escapeHtml(item.name)).join(" · ");
    return '<article class="explore-stall-card"><a class="explore-stall-photo" href="/stall.html?id=' + encodeURIComponent(r.id) + '" aria-label="Open ' + escapeHtml(r.name) + ' stall"><img src="' + coverPhotos[index % coverPhotos.length] + '" alt="Food from ' + escapeHtml(r.name) + '" loading="lazy"><span class="explore-photo-label">CAMPUS STALL</span></a>' +
      '<div class="explore-stall-body"><div class="explore-stall-title-row"><div><h3>' + escapeHtml(r.name) + '</h3><p class="explore-stall-location">' + (r.location ? '⌖ ' + escapeHtml(r.location) : '⌖ On campus') + '</p></div><span class="explore-stall-rating">' + (r.ratingAverage == null ? '☆ New' : '★ ' + Number(r.ratingAverage).toFixed(1)) + '</span></div>' +
      '<p class="explore-stall-description">' + escapeHtml(r.description || "Freshly prepared favourites for campus life.") + '</p><p class="explore-stall-preview">' + (preview || "Menu coming soon") + '</p>' +
      '<div class="explore-stall-footer"><span class="explore-menu-count">' + availableItems + ' item' + (availableItems === 1 ? '' : 's') + ' available</span><a class="primary-button" href="/stall.html?id=' + encodeURIComponent(r.id) + '">View stall <span aria-hidden="true">→</span></a></div></div></article>';
  }).join("") : '<div class="empty-state catalog-empty"><strong>No stalls found.</strong><p>Try another food name or choose a different category.</p><button class="secondary-button" type="button" id="resetExploreFilters">Clear filters</button></div>';
}
async function loadRestaurants() {
  try {
    const response = await fetch("/api/menu", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load restaurants.");
    const data = await response.json();
    restaurants = Array.isArray(data.restaurants) ? data.restaurants : [];
    renderRestaurants();
  } catch (error) {
    $("#restaurantList").innerHTML = '<div class="empty-state"><strong>Stalls could not load.</strong><p>Please refresh and try again.</p></div>';
    $("#restaurantSearchSummary").textContent = error.message;
  }
}
$("#restaurantSearchForm").addEventListener("submit", event => { event.preventDefault(); searchQuery = $("#restaurantSearch").value.trim(); renderRestaurants(); });
$("#restaurantCategoryFilters").addEventListener("click", event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  selectedCategory = button.dataset.category;
  $("#restaurantCategoryFilters").querySelectorAll("[data-category]").forEach(chip => chip.classList.toggle("active", chip === button));
  renderRestaurants();
});
document.addEventListener("click", event => {
  if (event.target.closest("#resetExploreFilters")) { searchQuery = ""; selectedCategory = "All"; $("#restaurantSearch").value = ""; $("#restaurantCategoryFilters").querySelectorAll("[data-category]").forEach(chip => chip.classList.toggle("active", chip.dataset.category === "All")); renderRestaurants(); }
});
$("#year").textContent = new Date().getFullYear();
updateCartCount();
loadRestaurants();