
require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { Pool } = require("pg");
const storagePool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 })
  : null;
const storageCache = new Map();
let storageWriteQueue = Promise.resolve();
const storageFiles = {
  "orders.json": "orders",
  "students.json": "students",
  "restaurant-menus.json": "restaurantMenus",
  "added-restaurants.json": "addedRestaurants",
  "delivery-agents.json": "deliveryAgents",
  "notifications.json": "notifications",
  "account-passwords.json": "accountPasswords",
  "admin-accounts.json": "adminAccounts",
  "disabled-admins.json": "disabledAdmins"
};

function readLocalJson(filename, fallback) {
  try {
    const file = path.join(__dirname, filename);
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error("Could not read legacy data file:", filename, error.message);
    return fallback;
  }
}

async function initializePersistentStorage() {
  const definitions = [
    ["orders.json", []],
    ["students.json", []],
    ["restaurant-menus.json", {}],
    ["added-restaurants.json", []],
    ["delivery-agents.json", []],
    ["notifications.json", []],
    ["account-passwords.json", {}],
    ["admin-accounts.json", []],
    ["disabled-admins.json", []]
  ];
  if (!storagePool) {
    for (const [filename, fallback] of definitions) {
      storageCache.set(storageFiles[filename], readLocalJson(filename, fallback));
    }
    console.warn("DATABASE_URL is not set; using local JSON storage.");
    return;
  }
  await storagePool.query(`
    CREATE TABLE IF NOT EXISTS coc_app_store (
      store_key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  for (const [filename, fallback] of definitions) {
    const key = storageFiles[filename];
    const existing = await storagePool.query(
      "SELECT data FROM coc_app_store WHERE store_key = $1", [key]
    );
    if (existing.rows.length) {
      storageCache.set(key, existing.rows[0].data);
      continue;
    }
    const legacyData = readLocalJson(filename, fallback);
    await storagePool.query(
      "INSERT INTO coc_app_store (store_key, data) VALUES ($1, $2::jsonb) ON CONFLICT (store_key) DO NOTHING",
      [key, JSON.stringify(legacyData)]
    );
    const seeded = await storagePool.query(
      "SELECT data FROM coc_app_store WHERE store_key = $1", [key]
    );
    storageCache.set(key, seeded.rows[0]?.data ?? legacyData);
  }
  console.log("Persistent PostgreSQL storage initialized.");
}

function readStoredJson(filePath, fallback) {
  const filename = path.basename(filePath);
  const key = storageFiles[filename];
  if (!key) throw new Error("Unknown persistent storage file: " + filename);
  if (storageCache.has(key)) return storageCache.get(key);
  const data = readLocalJson(filename, fallback);
  storageCache.set(key, data);
  return data;
}

function saveStoredJson(filePath, data) {
  const filename = path.basename(filePath);
  const key = storageFiles[filename];
  if (!key) throw new Error("Unknown persistent storage file: " + filename);
  storageCache.set(key, data);
  if (storagePool) {
    const serialized = JSON.stringify(data);
    storageWriteQueue = storageWriteQueue.catch(() => {}).then(() =>
      storagePool.query(
        `INSERT INTO coc_app_store (store_key, data, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (store_key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [key, serialized]
      )
    );
    storageWriteQueue.catch(error => {
      console.error("PostgreSQL persistence write failed for " + key + ":", error.message);
    });
  } else {
    const temp = filePath + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(temp, filePath);
  }
}


async function start() {
  await initializePersistentStorage();

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = function (body) {
    storageWriteQueue.then(() => sendJson(body)).catch(error => {
      console.error("Unable to persist request data:", error.message);
      if (!res.headersSent) {
        res.statusCode = 500;
        sendJson({ error: "Could not save data. Please try again." });
      }
    });
    return res;
  };
  next();
});

// Demo storage only. Use a persistent database before public launch.
const DATA_FILE = path.join(__dirname, "orders.json");
const sessions = new Map();
const ACCOUNT_PASSWORDS_FILE = path.join(__dirname, "account-passwords.json");
function readAccountPasswords() { return readStoredJson(ACCOUNT_PASSWORDS_FILE, {}); }
function saveAccountPasswords(records) { saveStoredJson(ACCOUNT_PASSWORDS_FILE, records); }

let restaurants = [
  {
    id: "CB",
    name: "Campus Bites",
    description: "Campus favourites, freshly prepared.",
    items: [
      { id: "cb1", name: "Jollof Rice", price: 2500, category: "Meals", emoji: "🍛" },
      { id: "cb2", name: "Fried Rice", price: 3000, category: "Meals", emoji: "🍚" },
      { id: "cb3", name: "Chicken", price: 1500, category: "Sides", emoji: "🍗" },
      { id: "cb4", name: "Chicken and Chips", price: 3500, category: "Meals", emoji: "🍟" },
      { id: "cb5", name: "Bottle Water", price: 500, category: "Drinks", emoji: "💧" }
    ]
  },
  {
    id: "MK",
    name: "Mama's Kitchen",
    description: "Homemade goodness for hungry students.",
    items: [
      { id: "mk1", name: "Beans and Plantain", price: 2000, category: "Meals", emoji: "🍲" },
      { id: "mk2", name: "Spaghetti", price: 1800, category: "Meals", emoji: "🍝" },
      { id: "mk3", name: "Rice and Stew", price: 2200, category: "Meals", emoji: "🍚" },
      { id: "mk4", name: "Chicken", price: 1500, category: "Sides", emoji: "🍗" },
      { id: "mk5", name: "Bottle Water", price: 500, category: "Drinks", emoji: "💧" }
    ]
  }
];

let agents = [];

// Never put actual passwords in this file or commit them to GitHub.
let accounts = [
  {
    username: (process.env.ADMIN_USERNAME || "coc_owner_2026").trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || "",
    role: "admin",
    name: "Chowoncampus Admin"
  },
  {
    username: (process.env.SUPERADMIN_USERNAME || "Anonymousisprime").trim().toLowerCase(),
    password: process.env.SUPERADMIN_PASSWORD || "",
    role: "admin",
    isSuperAdmin: true,
    name: "Anonymous Is Prime — Ultimate Admin"
  },
  {
    username: "campusbites",
    password: process.env.CAMPUSBITES_PASSWORD || "",
    role: "restaurant",
    restaurantId: "CB",
    name: "Campus Bites"
  },
  {
    username: "mamaskitchen",
    password: process.env.MAMASKITCHEN_PASSWORD || "",
    role: "restaurant",
    restaurantId: "MK",
    name: "Mama's Kitchen"
  }
];

if (accounts.some(account => !account.password)) {
  throw new Error(
    "Missing login passwords. Set ADMIN_PASSWORD, CAMPUSBITES_PASSWORD, " +
    "and MAMASKITCHEN_PASSWORD in .env."
  );
}

// Dynamically created restaurant partners and their hashed login credentials.
const RESTAURANTS_FILE = path.join(__dirname, "added-restaurants.json");
function readAddedRestaurants() {
  return readStoredJson(RESTAURANTS_FILE, []);
}
function saveAddedRestaurants(records) {
  saveStoredJson(RESTAURANTS_FILE, records);
}
const addedRestaurantRecords = readAddedRestaurants();
for (const record of addedRestaurantRecords) {
  if (record.restaurant && record.username && record.passwordSalt && record.passwordHash) {
    restaurants.push(record.restaurant);
    accounts.push({
      username: record.username,
      role: "restaurant",
      restaurantId: record.restaurant.id,
      name: record.restaurant.name,
      passwordSalt: record.passwordSalt,
      passwordHash: record.passwordHash
    });
  }
}
// Tombstones keep deleted seeded and partner restaurants deleted across restarts.
const deletedRestaurantIds = new Set(addedRestaurantRecords
  .map(record => record.deletedRestaurantId)
  .filter(Boolean));
restaurants = restaurants.filter(restaurant => !deletedRestaurantIds.has(restaurant.id));
accounts = accounts.filter(account => account.role !== "restaurant" || !deletedRestaurantIds.has(account.restaurantId));

// Restaurant menu overrides are kept separately so menu edits survive app restarts
// when the deployment has persistent storage configured.
const MENUS_FILE = path.join(__dirname, "restaurant-menus.json");
function readMenuOverrides() {
  return readStoredJson(MENUS_FILE, {});
}
function saveMenuOverrides(data) {
  saveStoredJson(MENUS_FILE, data);
}
const menuOverrides = readMenuOverrides();
for (const restaurant of restaurants) {
  if (Array.isArray(menuOverrides[restaurant.id])) restaurant.items = menuOverrides[restaurant.id];
  restaurant.items = restaurant.items.map(item => ({ ...item, available: item.available !== false }));
}

/* Delivery agents are created by an administrator. JSON storage is demo storage;
   use a persistent database before relying on this for live operations. */
const AGENTS_FILE = path.join(__dirname, "delivery-agents.json");
function readAgentRecords() {
  return readStoredJson(AGENTS_FILE, []);
}
function saveAgentRecords(records) {
  saveStoredJson(AGENTS_FILE, records);
}
const agentRecords = readAgentRecords();
agents = agentRecords.map(record => ({
  id: record.id,
  name: record.name,
  username: record.username,
  online: Boolean(record.online),
  activeOrderId: record.activeOrderId || null,
  createdAt: record.createdAt || null
}));
for (const record of agentRecords) {
  if (record.id && record.username && record.passwordSalt && record.passwordHash) {
    accounts.push({
      username: record.username,
      role: "agent",
      agentId: record.id,
      name: record.name,
      passwordSalt: record.passwordSalt,
      passwordHash: record.passwordHash
    });
  }
}

function readOrders() {
  return readStoredJson(DATA_FILE, []);
}

function saveOrders(orders) {
  saveStoredJson(DATA_FILE, orders);
}

const NOTIFICATIONS_FILE = path.join(__dirname, "notifications.json");
function readNotifications() { return readStoredJson(NOTIFICATIONS_FILE, []); }
function saveNotifications(items) { saveStoredJson(NOTIFICATIONS_FILE, items.slice(0, 2000)); }
function createNotification(target, title, message, orderId = null) {
  const items = readNotifications();
  items.unshift({ id: crypto.randomUUID(), ...target, title, message, orderId, createdAt: new Date().toISOString(), read: false });
  saveNotifications(items);
}
function notifyOrderParties(order, title, message) {
  createNotification({ role: "student", username: order.customerPhone }, title, message, order.id);
  createNotification({ role: "restaurant", restaurantId: order.restaurantId }, title, `${order.id}: ${message}`, order.id);
  createNotification({ role: "admin" }, title, `${order.id}: ${message}`, order.id);
  if (order.assignedAgentId) createNotification({ role: "agent", agentId: order.assignedAgentId }, title, `${order.id}: ${message}`, order.id);
}

function safeAccount(account) {
  return {
    username: account.username,
    role: account.role,
    name: account.name,
    restaurantId: account.restaurantId || null,
    agentId: account.agentId || null,
    isSuperAdmin: Boolean(account.isSuperAdmin)
  };
}

function getSession(req) {
  const cookies = (req.headers.cookie || "").split(";").map(v => v.trim());
  const cookie = cookies.find(v => v.startsWith("coc_session="));

  if (!cookie) return null;

  try {
    const token = decodeURIComponent(cookie.slice("coc_session=".length));
    return sessions.get(token) || null;
  } catch {
    return null;
  }
}

function requireLogin(req, res, next) {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({ error: "Please log in first." });
  }

  req.account = session;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const session = getSession(req);

    if (!session) {
      return res.status(401).json({ error: "Please log in first." });
    }

    if (!roles.includes(session.role)) {
      return res.status(403).json({
        error: "You don't have permission to do that."
      });
    }

    req.account = session;
    next();
  };
}

function publicOrder(order) {
  const { chatMessages, ...safeOrder } = order;
  return safeOrder;
}


// Student accounts. Students are stored separately from staff accounts.
// Configure Twilio Verify in Render to enable real phone verification.
const STUDENTS_FILE = path.join(__dirname, "students.json");

function readStudents() {
  return readStoredJson(STUDENTS_FILE, []);
}

function saveStudents(students) {
  saveStoredJson(STUDENTS_FILE, students);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function passwordMatches(password, student) {
  const actual = crypto.scryptSync(password, student.passwordSalt, 64);
  const expected = Buffer.from(student.passwordHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizeNigerianPhone(value) {
  const compact = String(value || "").trim().replace(/[\s()\-]/g, "");
  if (/^0[789][01]\d{8}$/.test(compact)) return "+234" + compact.slice(1);
  if (/^[789][01]\d{8}$/.test(compact)) return "+234" + compact;
  if (/^234[789][01]\d{8}$/.test(compact)) return "+" + compact;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  return null;
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    "coc_session=" + token + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800" +
      (IS_PRODUCTION ? "; Secure" : "")
  );
}

// Student sign-up: no SMS verification yet. Phone numbers are collected but NOT marked verified.
app.post("/api/student/register", (req, res) => {
  const name = String(req.body.name || "").trim();
  const phone = normalizeNigerianPhone(req.body.phone);
  const password = String(req.body.password || "");
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Enter your name (2–100 characters)." });
  if (!phone) return res.status(400).json({ error: "Enter a valid phone number, e.g. 08012345678." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Use a password between 10 and 128 characters." });
  try {
    const students = readStudents();
    if (students.some(student => student.phone === phone)) return res.status(409).json({ error: "An account already exists for this phone number. Please log in." });
    const passwordData = hashPassword(password);
    const student = { id: crypto.randomUUID(), name, phone, passwordSalt: passwordData.salt, passwordHash: passwordData.hash, role: "student", verifiedPhone: false, createdAt: new Date().toISOString() };
    students.push(student);
    saveStudents(students);
    const account = { username: student.phone, role: "student", name: student.name };
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, account);
    setSessionCookie(res, token);
    res.status(201).json({ account, message: "Account created. Your phone number has not been verified." });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not create your account." });
  }
});

// Student login is separate from staff/admin login.
app.post("/api/student/login", (req, res) => {
  const phone = normalizeNigerianPhone(req.body.phone);
  const password = String(req.body.password || "");
  if (!phone || !password) return res.status(400).json({ error: "Enter a valid phone number and your password." });

  try {
    const student = readStudents().find(item => item.phone === phone);
    if (!student || !passwordMatches(password, student)) {
      return res.status(401).json({ error: "Incorrect phone number or password." });
    }
    if (student.banned) {
      return res.status(403).json({ error: "This student account has been banned. Contact ChowOnCampus support if you think this is a mistake." });
    }
    const account = { username: student.phone, role: "student", name: student.name };
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, account);
    setSessionCookie(res, token);
    res.json({ account });
  } catch (error) {
    res.status(500).json({ error: "Could not sign in. Please try again." });
  }
});

// Authenticated in-app notifications. Each account only sees notifications addressed to it.
app.get("/api/notifications", requireLogin, (req, res) => {
  const account = req.account;
  const notifications = readNotifications().filter(item => item.role === account.role && (
    item.role === "admin" ||
    (item.role === "student" && item.username === account.username) ||
    (item.role === "restaurant" && item.restaurantId === account.restaurantId) ||
    (item.role === "agent" && item.agentId === account.agentId)
  )).slice(0, 100);
  res.json({ notifications, unreadCount: notifications.filter(item => !item.read).length });
});
app.patch("/api/notifications/:id/read", requireLogin, (req, res) => {
  const account = req.account;
  const items = readNotifications();
  const item = items.find(n => n.id === req.params.id && n.role === account.role && (
    n.role === "admin" ||
    (n.role === "student" && n.username === account.username) ||
    (n.role === "restaurant" && n.restaurantId === account.restaurantId) ||
    (n.role === "agent" && n.agentId === account.agentId)
  ));
  if (!item) return res.status(404).json({ error: "Notification not found." });
  item.read = true;
  saveNotifications(items);
  res.json({ ok: true });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "Chowoncampus" });
});

// Public menu
app.get("/api/menu", (req, res) => {
  res.json({ restaurants: restaurants.map(restaurant => ({
    ...restaurant,
    location: restaurant.location || "",
    items: restaurant.items.map(item => ({ ...item, available: item.available !== false }))
  })) });
});

// Restaurant partners can edit their own pickup location.
app.put("/api/restaurant/location", requireRole("restaurant"), (req, res) => {
  const location = String(req.body.location || "").trim();
  if (location.length > 180) return res.status(400).json({ error: "Location must be 180 characters or fewer." });
  const restaurant = restaurants.find(item => item.id === req.account.restaurantId);
  if (!restaurant) return res.status(404).json({ error: "Restaurant account not found." });
  restaurant.location = location;
  const record = addedRestaurantRecords.find(item => item.restaurant && item.restaurant.id === restaurant.id);
  if (record) record.restaurant.location = location;
  try {
    if (record) saveAddedRestaurants(addedRestaurantRecords);
    res.json({ ok: true, location, message: "Restaurant location saved." });
  } catch (error) {
    console.error("Could not save restaurant location:", error);
    res.status(500).json({ error: "Could not save location. Please try again." });
  }
});

// Restaurant partners can manage up to 70 menu items and mark each item available/sold out.
app.put("/api/restaurant/menu", requireRole("restaurant"), (req, res) => {
  const submitted = req.body.items;
  if (!Array.isArray(submitted) || submitted.length < 1 || submitted.length > 70) {
    return res.status(400).json({ error: "A menu must contain between 1 and 70 items." });
  }
  const items = [];
  const ids = new Set();
  for (let index = 0; index < submitted.length; index++) {
    const source = submitted[index] || {};
    const name = String(source.name || "").trim();
    const category = String(source.category || "Meals").trim() || "Meals";
    const price = Number(source.price);
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Each item name must be 2–80 characters." });
    if (!Number.isFinite(price) || price < 1 || price > 1000000) return res.status(400).json({ error: "Each item price must be between ₦1 and ₦1,000,000." });
    let id = String(source.id || "").trim();
    if (!id || ids.has(id)) id = "m" + crypto.randomBytes(8).toString("hex");
    ids.add(id);
    items.push({ id, name, price: Math.round(price), category: category.slice(0, 40), emoji: String(source.emoji || "🍽️").slice(0, 8), available: source.available !== false });
  }
  try {
    const restaurant = restaurants.find(item => item.id === req.account.restaurantId);
    if (!restaurant) return res.status(404).json({ error: "Restaurant account not found." });
    const overrides = readMenuOverrides();
    overrides[restaurant.id] = items;
    saveMenuOverrides(overrides);
    restaurant.items = items;
    res.json({ items: restaurant.items, message: "Menu saved successfully." });
  } catch (error) {
    console.error("Could not save restaurant menu:", error);
    res.status(500).json({ error: "Could not save your menu. Please try again." });
  }
});

// Current login
app.get("/api/me", (req, res) => {
  const session = getSession(req);
  res.json({ account: session || null });
});

// Staff login endpoint is used by the separate admin login page and staff accounts.
// Login
app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!username || !password) {
    return res.status(400).json({
      error: "Enter your username and password."
    });
  }

  const passwordOverrides = readAccountPasswords();
  const disabledAdmins = readStoredJson(path.join(__dirname, "disabled-admins.json"), []);
  const managedAdmins = readStoredJson(path.join(__dirname, "admin-accounts.json"), []);
  for (const record of managedAdmins) {
    if (!accounts.some(a => a.role === "admin" && a.username === record.username)) {
      accounts.push({ ...record, role: "admin", isSuperAdmin: false });
    }
  }
  const account = accounts.find(a => {
    if (a.role === "admin" && disabledAdmins.includes(a.username) && !a.isSuperAdmin) return false;
    if (a.username !== username) return false;
    const override = passwordOverrides[`${a.role}:${a.username}`];
    if (override?.passwordSalt && override?.passwordHash) return passwordMatches(password, override);
    return a.passwordHash ? passwordMatches(password, a) : a.password === password;
  });

  if (!account) {
    return res.status(401).json({
      error: "Incorrect username or password."
    });
  }

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, safeAccount(account));

  res.setHeader(
    "Set-Cookie",
    `coc_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${IS_PRODUCTION ? "; Secure" : ""}`
  );

  res.json({ account: safeAccount(account) });
});

// All signed-in account types can change their own password after verifying the current one.
app.post("/api/account/change-password", requireLogin, (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  const confirmPassword = String(req.body.confirmPassword || "");
  if (!currentPassword || !newPassword || !confirmPassword) return res.status(400).json({ error: "Complete all password fields." });
  if (newPassword.length < 10 || newPassword.length > 128) return res.status(400).json({ error: "New password must be 10–128 characters." });
  if (newPassword !== confirmPassword) return res.status(400).json({ error: "New password and confirmation do not match." });
  if (currentPassword === newPassword) return res.status(400).json({ error: "Choose a new password different from your current password." });
  try {
    const account = req.account;
    if (account.role === "student") {
      const students = readStudents();
      const student = students.find(item => item.phone === account.username);
      if (!student || !passwordMatches(currentPassword, student)) return res.status(401).json({ error: "Your current password is incorrect." });
      const hashed = hashPassword(newPassword);
      student.passwordSalt = hashed.salt;
      student.passwordHash = hashed.hash;
      saveStudents(students);
    } else {
      const staffAccount = accounts.find(item => item.username === account.username && item.role === account.role);
      if (!staffAccount) return res.status(404).json({ error: "Account not found." });
      const overrides = readAccountPasswords();
      const key = `${staffAccount.role}:${staffAccount.username}`;
      const existing = overrides[key] || staffAccount;
      const matches = existing.passwordSalt && existing.passwordHash
        ? passwordMatches(currentPassword, existing)
        : existing.password === currentPassword;
      if (!matches) return res.status(401).json({ error: "Your current password is incorrect." });
      const hashed = hashPassword(newPassword);
      overrides[key] = { passwordSalt: hashed.salt, passwordHash: hashed.hash, changedAt: new Date().toISOString() };
      saveAccountPasswords(overrides);
      staffAccount.password = "";
      staffAccount.passwordSalt = hashed.salt;
      staffAccount.passwordHash = hashed.hash;
    }
    for (const [token, session] of sessions.entries()) {
      if (session.role === account.role && session.username === account.username) sessions.delete(token);
    }
    res.setHeader("Set-Cookie", `coc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${IS_PRODUCTION ? "; Secure" : ""}`);
    return res.json({ ok: true, message: "Password changed. Please log in again with your new password." });
  } catch (error) {
    console.error("Password change failed:", error.message);
    return res.status(500).json({ error: "Could not change password. Please try again." });
  }
});

// Logout
app.post("/api/logout", (req, res) => {
  const cookies = (req.headers.cookie || "").split(";").map(v => v.trim());
  const cookie = cookies.find(v => v.startsWith("coc_session="));

  if (cookie) {
    try {
      sessions.delete(decodeURIComponent(cookie.slice("coc_session=".length)));
    } catch {}
  }

  res.setHeader(
    "Set-Cookie",
    `coc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${IS_PRODUCTION ? "; Secure" : ""}`
  );

  res.json({ ok: true });
});

// Create an order. All prices are calculated on the server.
app.post("/api/orders", requireRole("student"), (req, res) => {
  const { hostel, block, room, landmark, latitude, longitude, restaurantId, items } = req.body;
  let student;
  try {
    student = readStudents().find(item => item.phone === req.account.username);
  } catch (error) {
    return res.status(500).json({ error: "Could not verify your student account." });
  }
  if (!student) return res.status(403).json({ error: "A valid student account is required to order." });
  const customerName = student.name;
  const customerPhone = student.phone;

  if (
    typeof customerName !== "string" ||
    customerName.trim().length < 2 ||
    customerName.trim().length > 100
  ) {
    return res.status(400).json({ error: "Enter your name." });
  }

  if (
    typeof customerPhone !== "string" ||
    !/^[0-9+()\-\s]{7,20}$/.test(customerPhone.trim())
  ) {
    return res.status(400).json({ error: "Enter a valid phone number." });
  }

  if (
    typeof hostel !== "string" ||
    hostel.trim().length < 2 ||
    hostel.trim().length > 150
  ) {
    return res.status(400).json({
      error: "Enter your campus delivery location."
    });
  }

  const hasCoordinates = latitude !== undefined && longitude !== undefined && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180;
  const deliveryLocation = { hostel: hostel.trim(), block: typeof block === "string" ? block.trim().slice(0, 100) : "", room: typeof room === "string" ? room.trim().slice(0, 40) : "", landmark: typeof landmark === "string" ? landmark.trim().slice(0, 150) : "", latitude: hasCoordinates ? Number(latitude) : null, longitude: hasCoordinates ? Number(longitude) : null };
  const restaurant = restaurants.find(r => r.id === restaurantId);

  if (
    !restaurant ||
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > 30
  ) {
    return res.status(400).json({
      error: "Choose a restaurant and at least one item."
    });
  }

  const cleanItems = [];
  let subtotal = 0;

  for (const item of items) {
    const menuItem = restaurant.items.find(i => i.id === item.id);
    const qty = Number(item.qty);

    if (!menuItem || menuItem.available === false || !Number.isInteger(qty) || qty < 1 || qty > 20) {
      return res.status(400).json({
        error: "One of your cart items is invalid."
      });
    }

    subtotal += menuItem.price * qty;

    cleanItems.push({
      id: menuItem.id,
      name: menuItem.name,
      price: menuItem.price,
      qty
    });
  }

  const deliveryFee = 300;

  const order = {
    id: `COC-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    hostel: [deliveryLocation.hostel, deliveryLocation.block && `Block ${deliveryLocation.block}`, deliveryLocation.room && `Room ${deliveryLocation.room}`, deliveryLocation.landmark && `Near ${deliveryLocation.landmark}`].filter(Boolean).join(", "),
    deliveryLocation,
    restaurantLocation: restaurant.location || "",
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    items: cleanItems,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    status: "Awaiting payment",
    statusHistory: [{ status: "Awaiting payment", at: new Date().toISOString(), by: "system" }],
    updatedAt: new Date().toISOString(),
    paymentStatus: "Unpaid — demo only",
    assignedAgentId: null,
    chatMessages: [],
    agentEarningsRecorded: false,
    createdAt: new Date().toISOString()
  };

  try {
    const orders = readOrders();
    orders.unshift(order);
    saveOrders(orders);
    notifyOrderParties(order, "New order placed", `${order.customerName} placed an order at ${order.restaurantName}.`);

    res.status(201).json({
      order: publicOrder(order),
      message: "Demo order created. No payment has been made."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not save your order." });
  }
});

// Local testing only: simulates payment without charging money.
app.post("/api/orders/:id/demo-payment", (req, res) => {
  if (IS_PRODUCTION) {
    return res.status(404).json({
      error: "Demo payments are disabled in production."
    });
  }

  try {
    const orders = readOrders();
    const order = orders.find(o => o.id === req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    if (order.paymentStatus !== "Unpaid — demo only") {
      return res.status(400).json({
        error: "This order cannot be simulated as paid."
      });
    }

    order.paymentStatus = "Paid — demo verified";
    order.status = "Confirmed";
    order.demoPaymentAt = new Date().toISOString();
    order.updatedAt = order.demoPaymentAt;
    order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [{ status: "Awaiting payment", at: order.createdAt, by: "system" }];
    order.statusHistory.push({ status: "Confirmed", at: order.updatedAt, by: "demo payment" });

    saveOrders(orders);

    res.json({
      order: publicOrder(order),
      message: "Demo payment simulated. No money was charged."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not update the order." });
  }
});

// View orders: restaurants see their orders, agents see assigned orders.
app.get("/api/orders", requireLogin, (req, res) => {
  try {
    let orders = readOrders();

    if (req.account.role === "restaurant") {
      orders = orders.filter(
        order => order.restaurantId === req.account.restaurantId
      );
    } else if (req.account.role === "agent") {
      orders = orders.filter(
        order => order.assignedAgentId === req.account.agentId
      );
    } else if (req.account.role === "student") {
      // Students may only view orders placed using their verified phone number.
      orders = orders.filter(order => order.customerPhone === req.account.username);
    } else if (req.account.role !== "admin") {
      return res.status(403).json({ error: "You don't have permission to view orders." });
    }

    res.json({ orders: orders.map(publicOrder) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Temporary order chat: only the student who placed the order and its assigned agent can use it.
// Chat is enabled only while the order is out for delivery and is erased on completion/cancellation.
function canUseDeliveryChat(account, order) {
  return Boolean(account && order && (
    (account.role === "student" && account.username === order.customerPhone) ||
    (account.role === "agent" && account.agentId && account.agentId === order.assignedAgentId) ||
    (account.role === "restaurant" && account.restaurantId === order.restaurantId && order.assignedAgentId)
  ));
}

function deliveryChatIsOpen(order) {
  return ["Ready for pickup", "Out for delivery"].includes(order.status);
}

app.get("/api/orders/:id/chat", requireRole("student", "agent", "restaurant"), (req, res) => {
  try {
    const order = readOrders().find(item => item.id === req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (!canUseDeliveryChat(req.account, order)) return res.status(403).json({ error: "Only the ordering student and assigned delivery agent can access this chat." });
    if (!deliveryChatIsOpen(order)) return res.status(410).json({ active: false, messages: [], error: "Chat is available only while the order is ready for pickup or out for delivery." });
    res.json({ active: true, messages: Array.isArray(order.chatMessages) ? order.chatMessages : [] });
  } catch (error) {
    res.status(500).json({ error: "Could not load delivery chat." });
  }
});

app.post("/api/orders/:id/chat", requireRole("student", "agent", "restaurant"), (req, res) => {
  const message = String(req.body.message || "").trim();
  if (!message || message.length > 500) return res.status(400).json({ error: "Message must be between 1 and 500 characters." });
  try {
    const orders = readOrders();
    const order = orders.find(item => item.id === req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (!canUseDeliveryChat(req.account, order)) return res.status(403).json({ error: "Only the ordering student and assigned delivery agent can send messages here." });
    if (!deliveryChatIsOpen(order)) return res.status(410).json({ error: "This temporary chat has closed." });
    order.chatMessages = Array.isArray(order.chatMessages) ? order.chatMessages : [];
    if (order.chatMessages.length >= 100) order.chatMessages.shift();
    order.chatMessages.push({
      id: crypto.randomUUID(),
      senderRole: req.account.role,
      senderName: req.account.name || (req.account.role === "student" ? "Student" : "Delivery agent"),
      message,
      sentAt: new Date().toISOString()
    });
    saveOrders(orders);
    res.status(201).json({ message: order.chatMessages[order.chatMessages.length - 1] });
  } catch (error) {
    res.status(500).json({ error: "Could not send message." });
  }
});

// Public order tracking by reference. Do not expose private customer details.
app.get("/api/orders/:id", (req, res) => {
  try {
    const order = readOrders().find(o => o.id === req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    const session = getSession(req);

    if (
      session &&
      (
        session.role === "admin" ||
        (session.role === "restaurant" &&
          session.restaurantId === order.restaurantId) ||
        (session.role === "agent" &&
          session.agentId === order.assignedAgentId)
      )
    ) {
      return res.json({ order: publicOrder(order) });
    }

    res.json({
      order: {
        id: order.id,
        restaurantName: order.restaurantName,
        items: order.items,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        total: order.total,
        status: order.status,
        statusHistory: Array.isArray(order.statusHistory) ? order.statusHistory : [{ status: order.status, at: order.updatedAt || order.createdAt, by: "system" }],
        updatedAt: order.updatedAt || order.createdAt,
        paymentStatus: order.paymentStatus,
        createdAt: order.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin-only restaurant creation. New partner passwords are hashed before storage.
app.get("/api/admin/restaurants", requireRole("admin"), (req, res) => {
  res.json({
    restaurants: restaurants.map(restaurant => ({
      id: restaurant.id,
      name: restaurant.name,
      description: restaurant.description,
      username: accounts.find(a => a.role === "restaurant" && a.restaurantId === restaurant.id)?.username || "",
      itemCount: restaurant.items.length,
      location: restaurant.location || ""
    }))
  });
});

// Admin-only restaurant deletion. Completed order history is preserved.
app.delete("/api/admin/restaurants/:id", requireRole("admin"), (req, res) => {
  const restaurantId = String(req.params.id || "");
  const restaurant = restaurants.find(item => item.id === restaurantId);
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });

  const activeOrders = readOrders().filter(order =>
    order.restaurantId === restaurantId && !["Completed", "Cancelled"].includes(order.status)
  );
  if (activeOrders.length) {
    return res.status(409).json({
      error: "This restaurant has active orders. Complete or cancel them before deleting the restaurant.",
      activeOrders: activeOrders.length
    });
  }

  try {
    const records = readAddedRestaurants().filter(record =>
      !record.restaurant || record.restaurant.id !== restaurantId
    );
    records.push({ deletedRestaurantId: restaurantId, deletedAt: new Date().toISOString() });
    saveAddedRestaurants(records);

    restaurants = restaurants.filter(item => item.id !== restaurantId);
    accounts = accounts.filter(account => !(account.role === "restaurant" && account.restaurantId === restaurantId));
    delete menuOverrides[restaurantId];
    saveMenuOverrides(menuOverrides);

    res.json({ ok: true, message: restaurant.name + " was deleted. Previous order records have been preserved." });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not delete restaurant." });
  }
});

app.post("/api/admin/restaurants", requireRole("admin"), (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const location = String(req.body.location || "").trim();
  const firstItemName = String(req.body.firstItemName || "").trim();
  const firstItemPrice = Number(req.body.firstItemPrice);

  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Restaurant name must be 2–100 characters." });
  if (description.length > 240) return res.status(400).json({ error: "Description must be 240 characters or fewer." });
  if (location.length > 180) return res.status(400).json({ error: "Restaurant location must be 180 characters or fewer." });
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return res.status(400).json({ error: "Username must be 3–30 characters: letters, numbers, dots, underscores or hyphens." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Restaurant password must be 10–128 characters." });
  if (accounts.some(account => account.username === username)) return res.status(409).json({ error: "That username is already in use." });
  if (firstItemName.length < 2 || firstItemName.length > 80) return res.status(400).json({ error: "Add the first menu item's name (2–80 characters)." });
  if (!Number.isFinite(firstItemPrice) || firstItemPrice < 1 || firstItemPrice > 1000000) return res.status(400).json({ error: "Enter a valid first menu item price." });

  try {
    const id = "R" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const itemId = id.toLowerCase() + "1";
    const restaurant = {
      id,
      name,
      description: description || "Fresh meals for campus students.",
      location,
      items: [{ id: itemId, name: firstItemName, price: Math.round(firstItemPrice), category: "Meals", emoji: "🍽️" }]
    };
    const passwordData = hashPassword(password);
    const record = { restaurant, username, passwordSalt: passwordData.salt, passwordHash: passwordData.hash };
    const records = readAddedRestaurants();
    records.push(record);
    saveAddedRestaurants(records);
    restaurants.push(restaurant);
    accounts.push({ username, role: "restaurant", restaurantId: id, name, passwordSalt: passwordData.salt, passwordHash: passwordData.hash });
    res.status(201).json({
      restaurant: { id, name, description: restaurant.description, location: restaurant.location, username, itemCount: restaurant.items.length },
      message: "Restaurant created. Save the login details securely and share the password with the partner."
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not create restaurant." });
  }
});

// Ultimate admin can manage additional admin accounts and revoke existing non-superadmin admins.
function requireSuperAdmin(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Please log in first." });
  if (session.role !== "admin" || !session.isSuperAdmin) return res.status(403).json({ error: "Only the ultimate admin can manage admin accounts." });
  req.account = session;
  next();
}

app.get("/api/superadmin/admins", requireSuperAdmin, (req, res) => {
  const disabled = readStoredJson(path.join(__dirname, "disabled-admins.json"), []);
  const managed = readStoredJson(path.join(__dirname, "admin-accounts.json"), []);
  const admins = accounts.filter(a => a.role === "admin" && !a.isSuperAdmin && !disabled.includes(a.username));
  for (const record of managed) {
    if (!admins.some(a => a.username === record.username)) admins.push(record);
  }
  res.json({ admins: admins.map(a => ({ username: a.username, name: a.name || a.username, source: managed.some(m => m.username === a.username) ? "managed" : "configured" })) });
});

app.post("/api/superadmin/admins", requireSuperAdmin, (req, res) => {
  const name = String(req.body.name || "").trim();
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Admin name must be 2–100 characters." });
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return res.status(400).json({ error: "Username must be 3–30 characters: letters, numbers, dots, underscores or hyphens." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Password must be 10–128 characters." });
  const disabled = readStoredJson(path.join(__dirname, "disabled-admins.json"), []);
  const managed = readStoredJson(path.join(__dirname, "admin-accounts.json"), []);
  if (accounts.some(a => a.username === username) || managed.some(a => a.username === username)) return res.status(409).json({ error: "That username is already in use." });
  const hashed = hashPassword(password);
  managed.push({ username, name, passwordSalt: hashed.salt, passwordHash: hashed.hash, createdAt: new Date().toISOString() });
  saveStoredJson(path.join(__dirname, "admin-accounts.json"), managed);
  saveStoredJson(path.join(__dirname, "disabled-admins.json"), disabled.filter(value => value !== username));
  accounts.push({ username, name, role: "admin", passwordSalt: hashed.salt, passwordHash: hashed.hash, isSuperAdmin: false });
  res.status(201).json({ ok: true, message: "Admin account created." });
});

app.delete("/api/superadmin/admins/:username", requireSuperAdmin, (req, res) => {
  const username = String(req.params.username || "").trim().toLowerCase();
  if (!username || username === req.account.username) return res.status(400).json({ error: "You cannot delete the ultimate admin account." });
  const target = accounts.find(a => a.role === "admin" && a.username === username && !a.isSuperAdmin);
  if (!target) return res.status(404).json({ error: "Admin account not found." });
  const disabled = readStoredJson(path.join(__dirname, "disabled-admins.json"), []);
  if (!disabled.includes(username)) disabled.push(username);
  saveStoredJson(path.join(__dirname, "disabled-admins.json"), disabled);
  const managed = readStoredJson(path.join(__dirname, "admin-accounts.json"), []);
  saveStoredJson(path.join(__dirname, "admin-accounts.json"), managed.filter(a => a.username !== username));
  for (let i = accounts.length - 1; i >= 0; i--) {
    if (accounts[i].role === "admin" && accounts[i].username === username && !accounts[i].isSuperAdmin) accounts.splice(i, 1);
  }
  for (const [token, account] of sessions.entries()) {
    if (account.role === "admin" && account.username === username && !account.isSuperAdmin) sessions.delete(token);
  }
  const overrides = readAccountPasswords();
  delete overrides[`admin:${username}`];
  saveAccountPasswords(overrides);
  res.json({ ok: true, message: "Admin account deleted and active sessions revoked." });
});

// Admin-only student directory. Never return password hashes or salts.
app.get("/api/admin/students", requireRole("admin"), (req, res) => {
  try {
    const students = readStudents().map(student => ({
      id: student.id,
      name: student.name,
      username: student.phone,
      phone: student.phone,
      verifiedPhone: Boolean(student.verifiedPhone),
      banned: Boolean(student.banned),
      createdAt: student.createdAt || null
    }));
    res.json({ students });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load students." });
  }
});

// Admin can ban or unban a student. Banning also invalidates any active session.
app.patch("/api/admin/students/:id/ban", requireRole("admin"), (req, res) => {
  const banned = req.body.banned;
  if (typeof banned !== "boolean") return res.status(400).json({ error: "Choose whether to ban or unban this student." });
  const students = readStudents();
  const student = students.find(item => item.id === req.params.id);
  if (!student) return res.status(404).json({ error: "Student account not found." });
  student.banned = banned;
  saveStudents(students);
  if (banned) {
    for (const [token, account] of sessions.entries()) {
      if (account.role === "student" && account.username === student.phone) sessions.delete(token);
    }
  }
  res.json({ ok: true, banned, message: banned ? "Student banned. Any active student session has been signed out." : "Student unbanned. They can log in again." });
});

// Permanently delete a student account while preserving historical orders.
app.delete("/api/admin/students/:id", requireRole("admin"), (req, res) => {
  const students = readStudents();
  const index = students.findIndex(item => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Student account not found." });
  const [student] = students.splice(index, 1);
  saveStudents(students);
  for (const [token, account] of sessions.entries()) {
    if (account.role === "student" && account.username === student.phone) sessions.delete(token);
  }
  res.json({ ok: true, message: "Student account deleted. Historical orders have been preserved." });
});

// Admin-only agent list and agent-account creation.
app.get("/api/agents", requireRole("admin"), (req, res) => {
  res.json({ agents: agents.map(agent => ({
    id: agent.id, name: agent.name, username: agent.username,
    online: Boolean(agent.online), activeOrderId: agent.activeOrderId || null,
    createdAt: agent.createdAt || null
  })) });
});

// Restaurants can see which delivery agents are currently available for pickup.
app.get("/api/agents/available", requireRole("restaurant", "admin"), (req, res) => {
  const records = readAgentRecords();
  const busyIds = new Set(readOrders()
    .filter(order => order.assignedAgentId && !["Completed", "Cancelled"].includes(order.status))
    .map(order => order.assignedAgentId));
  const available = records
    .filter(agent => agent.online && !busyIds.has(agent.id) && !agent.activeOrderId)
    .map(agent => ({ id: agent.id, name: agent.name, online: true }));
  res.json({ agents: available });
});

app.post("/api/admin/agents", requireRole("admin"), (req, res) => {
  const name = String(req.body.name || "").trim();
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Agent name must be 2–100 characters." });
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return res.status(400).json({ error: "Username must be 3–30 characters: letters, numbers, dots, underscores or hyphens." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Password must be 10–128 characters." });
  if (accounts.some(account => account.username === username)) return res.status(409).json({ error: "That username is already in use." });
  try {
    const records = readAgentRecords();
    const passwordData = hashPassword(password);
    const agent = {
      id: "AG-" + crypto.randomBytes(4).toString("hex").toUpperCase(),
      name, username, online: false, activeOrderId: null,
      createdAt: new Date().toISOString(),
      passwordSalt: passwordData.salt, passwordHash: passwordData.hash
    };
    records.push(agent);
    saveAgentRecords(records);
    agents.push({ id: agent.id, name, username, online: false, activeOrderId: null, createdAt: agent.createdAt });
    accounts.push({ username, role: "agent", agentId: agent.id, name, passwordSalt: passwordData.salt, passwordHash: passwordData.hash });
    res.status(201).json({ agent: { id: agent.id, name, username, online: false, activeOrderId: null, createdAt: agent.createdAt }, message: "Delivery-agent account created. Share the login details securely." });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not create delivery-agent account." });
  }
});

// Admin can delete a delivery-agent account. Refuse deletion while an active order is assigned.
app.delete("/api/admin/agents/:id", requireRole("admin"), (req, res) => {
  try {
    const records = readAgentRecords();
    const agent = records.find(item => item.id === req.params.id);
    if (!agent) return res.status(404).json({ error: "Delivery agent not found." });

    const activeOrder = readOrders().find(order =>
      order.assignedAgentId === agent.id && !["Completed", "Cancelled"].includes(order.status)
    );
    if (activeOrder) {
      return res.status(409).json({
        error: "This agent has an active order (" + activeOrder.id + "). Complete or cancel/reassign that order before deleting the agent."
      });
    }

    const remaining = records.filter(item => item.id !== agent.id);
    saveAgentRecords(remaining);
    agents.splice(0, agents.length, ...remaining.map(record => ({
      id: record.id, name: record.name, username: record.username,
      online: Boolean(record.online), activeOrderId: record.activeOrderId || null,
      createdAt: record.createdAt || null
    })));
    for (let i = accounts.length - 1; i >= 0; i--) {
      if (accounts[i].role === "agent" && accounts[i].agentId === agent.id) accounts.splice(i, 1);
    }
    for (const [token, account] of sessions.entries()) {
      if (account.role === "agent" && account.agentId === agent.id) sessions.delete(token);
    }
    res.json({ ok: true, message: agent.name + " was deleted. Completed order history has been preserved." });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not delete delivery agent." });
  }
});

function assignReadyOrders() {
  const records = readAgentRecords();
  const orders = readOrders();
  const busyAgentIds = new Set(orders.filter(order => order.assignedAgentId && !["Completed", "Cancelled"].includes(order.status)).map(order => order.assignedAgentId));
  const waiting = orders.filter(order => order.status === "Ready for pickup" && !order.assignedAgentId);
  let changed = false;
  for (const order of waiting) {
    const eligible = records.filter(agent => agent.online && !busyAgentIds.has(agent.id) && !agent.activeOrderId);
    if (!eligible.length) break;
    eligible.sort((a, b) => new Date(a.lastAssignedAt || 0) - new Date(b.lastAssignedAt || 0));
    const agent = eligible[0];
    order.assignedAgentId = agent.id;
    order.assignedAt = new Date().toISOString();
    order.updatedAt = order.assignedAt;
    order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    order.statusHistory.push({ status: "Delivery agent assigned", at: order.assignedAt, by: "system" });
    agent.activeOrderId = order.id;
    agent.lastAssignedAt = order.assignedAt;
    busyAgentIds.add(agent.id);
    createNotification({ role: "agent", agentId: agent.id }, "Delivery assigned", `You have been assigned order ${order.id}. It is ready for pickup.`, order.id);
    createNotification({ role: "student", username: order.customerPhone }, "Delivery agent assigned", `${agent.name} has been assigned to your order ${order.id}.`, order.id);
    createNotification({ role: "admin" }, "Delivery agent assigned", `${agent.name} was assigned to ${order.id}.`, order.id);
    createNotification({ role: "restaurant", restaurantId: order.restaurantId }, "Delivery agent assigned", `${agent.name} is assigned to ${order.id} and ready for pickup.`, order.id);
    changed = true;
  }
  if (changed) {
    saveAgentRecords(records);
    saveOrders(orders);
    agents = records.map(record => ({ id: record.id, name: record.name, username: record.username, online: Boolean(record.online), activeOrderId: record.activeOrderId || null, createdAt: record.createdAt || null }));
  }
  return changed;
}

// Admin can override an agent's availability and trigger assignment when enabling them.
app.patch("/api/admin/agents/:id/availability", requireRole("admin"), (req, res) => {
  if (typeof req.body.online !== "boolean") return res.status(400).json({ error: "Choose online or offline." });
  try {
    const records = readAgentRecords();
    const agent = records.find(item => item.id === req.params.id);
    if (!agent) return res.status(404).json({ error: "Delivery agent not found." });
    agent.online = req.body.online;
    agent.availabilityUpdatedAt = new Date().toISOString();
    saveAgentRecords(records);
    agents = records.map(record => ({ id: record.id, name: record.name, username: record.username, online: Boolean(record.online), activeOrderId: record.activeOrderId || null, createdAt: record.createdAt || null }));
    if (agent.online) assignReadyOrders();
    res.json({ id: agent.id, online: agent.online, activeOrderId: agent.activeOrderId || null });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not update agent availability." });
  }
});

// An agent can view only their own availability and active assignment metadata.
app.get("/api/agents/me", requireRole("agent"), (req, res) => {
  try {
    const agent = readAgentRecords().find(item => item.id === req.account.agentId);
    if (!agent) return res.status(404).json({ error: "Agent account not found." });
    res.json({ id: agent.id, name: agent.name, username: agent.username, online: Boolean(agent.online), activeOrderId: agent.activeOrderId || null });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load agent profile." });
  }
});

// An agent can change only their own availability. Going online triggers assignment.
app.patch("/api/agent/availability", requireRole("agent"), (req, res) => {
  if (typeof req.body.online !== "boolean") return res.status(400).json({ error: "Choose online or offline." });
  try {
    const records = readAgentRecords();
    const agent = records.find(item => item.id === req.account.agentId);
    if (!agent) return res.status(404).json({ error: "Agent account not found." });
    agent.online = req.body.online;
    agent.availabilityUpdatedAt = new Date().toISOString();
    saveAgentRecords(records);
    agents = records.map(record => ({ id: record.id, name: record.name, username: record.username, online: Boolean(record.online), activeOrderId: record.activeOrderId || null, createdAt: record.createdAt || null }));
    if (agent.online) assignReadyOrders();
    res.json({ online: agent.online, activeOrderId: agent.activeOrderId || null });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not update availability." });
  }
});

// Admin assigns delivery agent
app.patch("/api/orders/:id/assign", requireRole("admin"), (req, res) => {
  try {
    const agentId = req.body.agentId;

    if (!agents.some(agent => agent.id === agentId)) {
      return res.status(400).json({
        error: "Choose a valid delivery agent."
      });
    }

    const orders = readOrders();
    const order = orders.find(o => o.id === req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    if (order.status === "Completed") {
      return res.status(400).json({
        error: "Completed orders cannot be reassigned."
      });
    }

    order.assignedAgentId = agentId;
    saveOrders(orders);
    const assignedAgent = agents.find(agent => agent.id === agentId);
    createNotification({ role: "agent", agentId }, "Delivery assigned", `You have been assigned order ${order.id}.`, order.id);
    createNotification({ role: "student", username: order.customerPhone }, "Delivery agent assigned", `${assignedAgent?.name || "A delivery agent"} has been assigned to your order.`, order.id);
    createNotification({ role: "admin" }, "Delivery agent assigned", `${assignedAgent?.name || agentId} was assigned to ${order.id}.`, order.id);

    res.json({ order: publicOrder(order) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Role-based order status updates
app.patch("/api/orders/:id/status", requireLogin, (req, res) => {
  try {
    const allowedStatuses = [
      "Awaiting payment",
      "Confirmed",
      "Preparing",
      "Ready for pickup",
      "Out for delivery",
      "Completed",
      "Cancelled"
    ];

    const newStatus = req.body.status;

    if (!allowedStatuses.includes(newStatus)) {
      return res.status(400).json({ error: "Invalid order status." });
    }

    const orders = readOrders();
    const order = orders.find(o => o.id === req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    const role = req.account.role;

    if (role === "restaurant") {
      if (order.restaurantId !== req.account.restaurantId) {
        return res.status(403).json({
          error: "This order belongs to another restaurant."
        });
      }

      if (!["Confirmed", "Preparing", "Ready for pickup", "Cancelled"].includes(newStatus)) {
        return res.status(403).json({
          error: "Restaurants cannot set that status."
        });
      }
    } else if (role === "agent") {
      if (order.assignedAgentId !== req.account.agentId) {
        return res.status(403).json({
          error: "This order is not assigned to you."
        });
      }

      if (!["Out for delivery", "Completed"].includes(newStatus)) {
        return res.status(403).json({
          error: "Delivery agents cannot set that status."
        });
      }
    } else if (role !== "admin") {
      return res.status(403).json({
        error: "You don't have permission to update orders."
      });
    }

    if (order.status === "Completed" && newStatus !== "Completed") {
      return res.status(400).json({
        error: "Completed orders cannot be reopened in this demo."
      });
    }

    // Fulfilment requires a verified payment state.
    if (
      newStatus !== "Cancelled" &&
      order.paymentStatus !== "Paid — demo verified"
    ) {
      return res.status(400).json({
        error: "This order is unpaid. Real payment verification must be integrated before fulfilment."
      });
    }

    const previousStatus = order.status;
    if (order.status !== newStatus) {
      const changedAt = new Date().toISOString();
      order.status = newStatus;
      order.updatedAt = changedAt;
      order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [{ status: order.status, at: order.createdAt, by: "system" }];
      order.statusHistory.push({ status: newStatus, at: changedAt, by: req.account.role });
    }

    // Erase the temporary delivery chat as soon as the order is completed or cancelled.
    if (newStatus === "Completed" || newStatus === "Cancelled") {
      delete order.chatMessages;
    }

    // Record agent earnings only once when the order is completed.
    if (newStatus === "Completed" && !order.agentEarningsRecorded) {
      order.agentEarningsRecorded = true;
      order.agentEarnings = 100;
      order.completedAt = new Date().toISOString();
    }

    saveOrders(orders);
    if (previousStatus !== newStatus) notifyOrderParties(order, "Order status updated", `Status changed from ${previousStatus} to ${newStatus}.`);
    if (newStatus === "Ready for pickup") assignReadyOrders();
    if (newStatus === "Completed" || newStatus === "Cancelled") {
      const records = readAgentRecords();
      const assigned = records.find(agent => agent.id === order.assignedAgentId);
      if (assigned) {
        assigned.activeOrderId = null;
        saveAgentRecords(records);
        agents = records.map(record => ({ id: record.id, name: record.name, username: record.username, online: Boolean(record.online), activeOrderId: record.activeOrderId || null, createdAt: record.createdAt || null }));
      }
      assignReadyOrders();
    }
    res.json({ order: publicOrder(order) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Monthly completed delivery earnings
app.get("/api/earnings", requireRole("admin", "agent"), (req, res) => {
  try {
    const orders = readOrders();
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    const completed = orders.filter(order => {
      if (!order.agentEarningsRecorded || !order.completedAt) return false;

      if (
        req.account.role === "agent" &&
        order.assignedAgentId !== req.account.agentId
      ) {
        return false;
      }

      const date = new Date(order.completedAt);
      return date.getMonth() === month && date.getFullYear() === year;
    });

    res.json({
      month: `${year}-${String(month + 1).padStart(2, "0")}`,
      completedDeliveries: completed.length,
      earned: completed.length * 100,
      note: "Demo bookkeeping only. Agent payouts are not automated."
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve the website for browser routes, while leaving unknown API paths as 404.
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
  }

  next();
});

// Unknown API routes
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

app.listen(PORT, () => {
  console.log(`Chowoncampus running at http://localhost:${PORT}`);
});
}

start().catch(error => {
  console.error("Chowoncampus failed to start:", error);
  process.exit(1);
});
