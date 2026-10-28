
require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { Pool } = require("pg");
const webPush = require("web-push");
const storagePool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 })
  : null;
const storageCache = new Map();
const persistedOrderSnapshot = new Map();
let storageWriteQueue = Promise.resolve();
const storageFiles = {
  "orders.json": "orders",
  "students.json": "students",
  "restaurant-menus.json": "restaurantMenus",
  "restaurant-locations.json": "restaurantLocations",
  "added-restaurants.json": "addedRestaurants",
  "delivery-agents.json": "deliveryAgents",
  "agent-payments.json": "agentPayments",
  "notifications.json": "notifications",
  "push-subscriptions.json": "pushSubscriptions",
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
    ["restaurant-locations.json", {}],
    ["added-restaurants.json", []],
    ["delivery-agents.json", []],
    ["agent-payments.json", []],
    ["notifications.json", []],
    ["push-subscriptions.json", []],
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
  // Orders are stored as individual rows so concurrent order creation does not rewrite
  // one giant JSON document and overwrite unrelated orders.
  await storagePool.query(`
    CREATE TABLE IF NOT EXISTS coc_orders (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const orderCount = await storagePool.query("SELECT COUNT(*)::int AS count FROM coc_orders");
  if (orderCount.rows[0].count === 0) {
    const legacyOrders = await storagePool.query(
      "SELECT data FROM coc_app_store WHERE store_key = $1", ["orders"]
    );
    const legacy = Array.isArray(legacyOrders.rows[0]?.data) ? legacyOrders.rows[0].data : [];
    for (const order of legacy) {
      if (!order || !order.id) continue;
      await storagePool.query(
        `INSERT INTO coc_orders (id, data, created_at)
         VALUES ($1, $2::jsonb, COALESCE($3::timestamptz, NOW()))
         ON CONFLICT (id) DO NOTHING`,
        [String(order.id), JSON.stringify(order), order.createdAt || null]
      );
    }
  }
  const orderRows = await storagePool.query(
    "SELECT data FROM coc_orders ORDER BY created_at DESC, id DESC"
  );
  const orders = orderRows.rows.map(row => row.data);
  storageCache.set("orders", orders);
  persistedOrderSnapshot.clear();
  for (const order of orders) {
    if (order?.id) persistedOrderSnapshot.set(String(order.id), JSON.stringify(order));
  }
  for (const [filename, fallback] of definitions) {
    if (filename === "orders.json") continue;
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
    if (key === "orders") {
      const current = new Map();
      for (const order of Array.isArray(data) ? data : []) {
        if (!order?.id) continue;
        const id = String(order.id);
        const serializedOrder = JSON.stringify(order);
        current.set(id, serializedOrder);
        if (persistedOrderSnapshot.get(id) !== serializedOrder) {
          // Only write orders that actually changed; each order has its own database row.
          storageWriteQueue = storageWriteQueue.catch(() => {}).then(() =>
            storagePool.query(
              `INSERT INTO coc_orders (id, data, created_at, updated_at)
               VALUES ($1, $2::jsonb, COALESCE($3::timestamptz, NOW()), NOW())
               ON CONFLICT (id) DO UPDATE
               SET data = EXCLUDED.data, created_at = EXCLUDED.created_at, updated_at = NOW()`,
              [id, serializedOrder, order.createdAt || null]
            )
          );
        }
      }
      for (const oldId of persistedOrderSnapshot.keys()) {
        if (!current.has(oldId)) {
          storageWriteQueue = storageWriteQueue.catch(() => {}).then(() =>
            storagePool.query("DELETE FROM coc_orders WHERE id = $1", [oldId])
          );
        }
      }
      persistedOrderSnapshot.clear();
      for (const [id, serializedOrder] of current) persistedOrderSnapshot.set(id, serializedOrder);
      storageWriteQueue.catch(error => {
        console.error("PostgreSQL order persistence failed:", error.message);
      });
      return;
    }
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
// Fixed delivery fee for every order.
const FIXED_DELIVERY_FEE = 300;
const STUDENT_PAYMENT_FEE_RATE = 0.01;

app.use(express.json({ limit: "50kb", verify: (req, res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
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

// Restaurant GPS coordinates are persisted separately so seeded and admin-created partners
// keep their pickup pins across server restarts.
const RESTAURANT_LOCATIONS_FILE = path.join(__dirname, "restaurant-locations.json");
function readRestaurantLocations() {
  return readStoredJson(RESTAURANT_LOCATIONS_FILE, {});
}
function saveRestaurantLocations(data) {
  saveStoredJson(RESTAURANT_LOCATIONS_FILE, data);
}
const restaurantLocationCoordinates = readRestaurantLocations();
for (const restaurant of restaurants) {
  const saved = restaurantLocationCoordinates[restaurant.id];
  if (saved && Number.isFinite(Number(saved.latitude)) && Number.isFinite(Number(saved.longitude))) {
    restaurant.latitude = Number(saved.latitude);
    restaurant.longitude = Number(saved.longitude);
  }
}

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
const AGENT_PAYMENTS_FILE = path.join(__dirname, "agent-payments.json");
function readAgentPayments() { return readStoredJson(AGENT_PAYMENTS_FILE, []); }
function saveAgentPayments(records) { saveStoredJson(AGENT_PAYMENTS_FILE, records); }
const AGENT_EARNING_PER_DELIVERY = Math.max(0, Math.round(Number(process.env.AGENT_EARNING_PER_DELIVERY || 100)));
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

const PUSH_SUBSCRIPTIONS_FILE = path.join(__dirname, "push-subscriptions.json");
function readPushSubscriptions() { return readStoredJson(PUSH_SUBSCRIPTIONS_FILE, []); }
function savePushSubscriptions(items) { saveStoredJson(PUSH_SUBSCRIPTIONS_FILE, items.slice(-5000)); }
const PUSH_VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const PUSH_VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const PUSH_VAPID_CONFIGURED = Boolean(PUSH_VAPID_PUBLIC_KEY && PUSH_VAPID_PRIVATE_KEY);
if (PUSH_VAPID_CONFIGURED) webPush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@chowoncampus.com", PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY);
function pushSubscriptionBelongsToTarget(subscription, target) {
  if (!subscription || !target || subscription.role !== target.role) return false;
  if (target.role === "admin") return true;
  if (target.role === "student") return Boolean(target.username && subscription.username === target.username);
  if (target.role === "restaurant") return Boolean(target.restaurantId && subscription.restaurantId === target.restaurantId);
  if (target.role === "agent") return Boolean(target.agentId && subscription.agentId === target.agentId);
  return false;
}
function sendPushToTarget(target, payload) {
  if (!PUSH_VAPID_CONFIGURED) return;
  for (const record of readPushSubscriptions().filter(item => pushSubscriptionBelongsToTarget(item, target))) {
    webPush.sendNotification(record.subscription, JSON.stringify(payload)).catch(error => {
      if (error.statusCode === 404 || error.statusCode === 410) {
        savePushSubscriptions(readPushSubscriptions().filter(item => item.endpoint !== record.endpoint));
      } else console.error("Push notification delivery failed:", error.statusCode || "", error.message || error);
    });
  }
}

function createNotification(target, title, message, orderId = null) {
  const items = readNotifications();
  items.unshift({ id: crypto.randomUUID(), ...target, title, message, orderId, createdAt: new Date().toISOString(), read: false });
  saveNotifications(items);
  sendPushToTarget(target, { title, body: message, orderId, url: "/" });
}
function notifyOrderParties(order, title, message) {
  createNotification({ role: "student", username: order.customerPhone }, title, message, order.id);
  createNotification({ role: "restaurant", restaurantId: order.restaurantId }, title, `${order.id}: ${message}`, order.id);
  createNotification({ role: "admin" }, title, `${order.id}: ${message}`, order.id);

  // Let every delivery agent know a paid order has arrived, even if they are not
  // currently on the website. The actual pickup offer is still sent separately
  // when the restaurant marks the order ready.
  const agentMessage = `${order.id}: A paid order has arrived at ${order.restaurantName}. No pickup action is needed yet; you will receive a separate offer when it is ready.`;
  const agentTargets = readAgentRecords().filter(agent => agent && agent.id);
  for (const agent of agentTargets) {
    createNotification({ role: "agent", agentId: agent.id }, "New paid order — awaiting preparation", agentMessage, order.id);
  }
}

function notifyOrderStatusChanged(order, previousStatus, newStatus) {
  const title = "Order update";
  let studentMessage = `Your order status is now: ${newStatus}.`;
  if (newStatus === "Ready for pickup") {
    studentMessage = "Your order is ready and is being prepared for dispatch.";
  } else if (newStatus === "Out for delivery") {
    studentMessage = "Your order is on its way. Please be ready to collect it at the gate.";
  } else if (newStatus === "Completed") {
    studentMessage = "Your order has been delivered. Thank you for using ChowOnCampus!";
  } else if (newStatus === "Cancelled") {
    studentMessage = "Your order has been cancelled. Open ChowOnCampus for details.";
  }

  createNotification({ role: "student", username: order.customerPhone }, title, studentMessage, order.id);
  createNotification({ role: "restaurant", restaurantId: order.restaurantId }, title,
    `Order ${order.id}: status changed from ${previousStatus} to ${newStatus}.`, order.id);
  createNotification({ role: "admin" }, title,
    `Order ${order.id}: status changed from ${previousStatus} to ${newStatus}.`, order.id);
  if (order.assignedAgentId) createNotification({ role: "agent", agentId: order.assignedAgentId }, title,
    `Order ${order.id}: status changed from ${previousStatus} to ${newStatus}.`, order.id);
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
  const { chatMessages, paymentEmail, paystackAuthorizationUrl, paystackSubaccountCode, ...safeOrder } = order;
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
  const consents = req.body.consents || {};
  if (consents.terms !== true || consents.privacy !== true || consents.delivery !== true) {
    return res.status(400).json({ error: "Read and agree to the Terms of Service, Privacy Policy, and Delivery & Cancellation Policy before creating an account." });
  }
  try {
    const students = readStudents();
    if (students.some(student => student.phone === phone)) return res.status(409).json({ error: "An account already exists for this phone number. Please log in." });
    const passwordData = hashPassword(password);
    const consentedAt = new Date().toISOString();
    const student = { id: crypto.randomUUID(), name, phone, passwordSalt: passwordData.salt, passwordHash: passwordData.hash, role: "student", verifiedPhone: false, policyConsent: { termsAcceptedAt: consentedAt, privacyAcceptedAt: consentedAt, deliveryPolicyAcceptedAt: consentedAt }, createdAt: consentedAt };
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

// Student self-service password recovery uses Twilio Verify SMS so only the phone holder can reset the account.
// Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID in Render.
const passwordResetAttempts = new Map();
function resetRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const previous = passwordResetAttempts.get(key) || [];
  const recent = previous.filter(time => now - time < windowMs);
  if (recent.length >= limit) {
    passwordResetAttempts.set(key, recent);
    return false;
  }
  recent.push(now);
  passwordResetAttempts.set(key, recent);
  return true;
}
function hasTwilioVerifyConfig() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);
}
async function twilioVerifyRequest(pathname, values) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const response = await fetch("https://verify.twilio.com/v2/Services/" + encodeURIComponent(serviceSid) + pathname, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(sid + ":" + token).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(values)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Twilio Verify request failed:", response.status, result.code || "unknown");
    throw new Error("SMS verification is temporarily unavailable. Please try again later.");
  }
  return result;
}

app.post("/api/student/forgot-password/start", async (req, res) => {
  const phone = normalizeNigerianPhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: "Enter a valid phone number." });
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  if (!resetRateLimit("reset-start:ip:" + ip, 8, 15 * 60 * 1000) ||
      !resetRateLimit("reset-start:phone:" + phone, 3, 15 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many attempts. Please wait 15 minutes before trying again." });
  }
  if (!hasTwilioVerifyConfig()) {
    return res.status(503).json({ error: "Password recovery SMS is not configured yet. Please contact ChowOnCampus support for help." });
  }
  try {
    const studentExists = readStudents().some(student => student.phone === phone && !student.banned);
    // Keep the response the same whether or not the phone belongs to an account.
    if (studentExists) {
      await twilioVerifyRequest("/Verifications", { To: phone, Channel: "sms" });
    }
    res.json({ ok: true, message: "If an eligible student account exists for that number, a verification code has been sent. Check your SMS." });
  } catch (error) {
    res.status(503).json({ error: error.message || "Could not send a verification code. Please try again later." });
  }
});

app.post("/api/student/forgot-password/reset", async (req, res) => {
  const phone = normalizeNigerianPhone(req.body.phone);
  const code = String(req.body.code || "").trim();
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");
  if (!phone) return res.status(400).json({ error: "Enter a valid phone number." });
  if (!/^\d{4,10}$/.test(code)) return res.status(400).json({ error: "Enter the verification code from your SMS." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Use a password between 10 and 128 characters." });
  if (password !== confirmPassword) return res.status(400).json({ error: "The new passwords do not match." });
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  if (!resetRateLimit("reset-check:ip:" + ip, 10, 15 * 60 * 1000) ||
      !resetRateLimit("reset-check:phone:" + phone, 6, 15 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many attempts. Please wait 15 minutes before trying again." });
  }
  if (!hasTwilioVerifyConfig()) {
    return res.status(503).json({ error: "Password recovery SMS is not configured yet. Please contact ChowOnCampus support for help." });
  }
  try {
    const students = readStudents();
    const student = students.find(item => item.phone === phone && !item.banned);
    if (!student) return res.status(400).json({ error: "We could not verify this reset request. Check the phone number and code, then try again." });
    const verification = await twilioVerifyRequest("/VerificationCheck", { To: phone, Code: code });
    if (verification.status !== "approved") {
      return res.status(400).json({ error: "That code is invalid or expired. Request a new code and try again." });
    }
    const hashed = hashPassword(password);
    student.passwordSalt = hashed.salt;
    student.passwordHash = hashed.hash;
    saveStudents(students);
    for (const [token, session] of sessions.entries()) {
      if (session.role === "student" && session.username === phone) sessions.delete(token);
    }
    res.json({ ok: true, message: "Password reset successfully. You can now log in with your new password." });
  } catch (error) {
    res.status(503).json({ error: error.message || "Could not reset your password. Please try again later." });
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


app.get("/api/push/public-key", (req, res) => {
  res.json({ configured: PUSH_VAPID_CONFIGURED, publicKey: PUSH_VAPID_CONFIGURED ? PUSH_VAPID_PUBLIC_KEY : null });
});
app.post("/api/push/subscribe", requireLogin, (req, res) => {
  if (!PUSH_VAPID_CONFIGURED) return res.status(503).json({ error: "Push notifications need VAPID keys configured on the hosting service." });
  const subscription = req.body && req.body.subscription;
  if (!subscription || typeof subscription.endpoint !== "string" || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    return res.status(400).json({ error: "The browser did not provide a valid push subscription." });
  }
  const account = req.account;
  const record = { endpoint: subscription.endpoint, subscription, role: account.role, username: account.username || null, restaurantId: account.restaurantId || null, agentId: account.agentId || null, updatedAt: new Date().toISOString() };
  const subscriptions = readPushSubscriptions().filter(item => item.endpoint !== record.endpoint);
  subscriptions.push(record);
  savePushSubscriptions(subscriptions);
  res.json({ ok: true, message: "Push notifications enabled on this device." });
});
app.delete("/api/push/subscribe", requireLogin, (req, res) => {
  const endpoint = String(req.body && req.body.endpoint || "");
  if (!endpoint) return res.status(400).json({ error: "Push subscription endpoint is required." });
  savePushSubscriptions(readPushSubscriptions().filter(item => item.endpoint !== endpoint || !pushSubscriptionBelongsToTarget(item, req.account)));
  res.json({ ok: true });
});

// Device-level diagnostics so staff can confirm whether background push is actually set up.
app.get("/api/push/status", requireLogin, (req, res) => {
  const matching = readPushSubscriptions().filter(item => pushSubscriptionBelongsToTarget(item, req.account));
  res.json({
    configured: PUSH_VAPID_CONFIGURED,
    subscribedDevices: matching.length,
    role: req.account.role
  });
});
app.post("/api/push/test", requireLogin, async (req, res) => {
  if (!PUSH_VAPID_CONFIGURED) {
    return res.status(503).json({ error: "Background push is not configured on the server. VAPID keys are missing." });
  }
  const matching = readPushSubscriptions().filter(item => pushSubscriptionBelongsToTarget(item, req.account));
  if (!matching.length) {
    return res.status(409).json({ error: "This account has no registered devices yet. Allow notifications and enable them on this device first." });
  }
  const payload = JSON.stringify({
    title: "ChowOnCampus test alert",
    body: "Background notifications are working on this device.",
    url: "/",
    test: true
  });
  const results = await Promise.allSettled(matching.map(async record => {
    try {
      await webPush.sendNotification(record.subscription, payload);
      return { endpoint: record.endpoint, ok: true };
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        savePushSubscriptions(readPushSubscriptions().filter(item => item.endpoint !== record.endpoint));
      }
      console.error("Push test failed:", error.statusCode || "", error.message || error);
      throw error;
    }
  }));
  const succeeded = results.filter(result => result.status === "fulfilled").length;
  const failed = results.length - succeeded;
  if (!succeeded) {
    const reason = results.find(result => result.status === "rejected")?.reason;
    return res.status(502).json({
      error: "The server could not deliver a push to any registered device. " + (reason?.statusCode ? "Push provider returned HTTP " + reason.statusCode + "." : "Check the service logs and VAPID key configuration."),
      subscribedDevices: matching.length,
      failedDevices: failed
    });
  }
  res.json({
    ok: true,
    message: "Test push sent to " + succeeded + " device" + (succeeded === 1 ? "" : "s") + ".",
    subscribedDevices: matching.length,
    deliveredToPushService: succeeded,
    failedDevices: failed
  });
});

// Authenticated in-app notifications. Enforce both the role and the account-specific recipient.
function notificationBelongsToAccount(item, account) {
  if (!item || !account || typeof item.role !== "string" || item.role !== account.role) return false;
  if (account.role === "admin") return true;
  if (account.role === "student") {
    return Boolean(account.username && item.username && item.username === account.username);
  }
  if (account.role === "restaurant") {
    return Boolean(account.restaurantId && item.restaurantId && item.restaurantId === account.restaurantId);
  }
  if (account.role === "agent") {
    return Boolean(account.agentId && item.agentId && item.agentId === account.agentId);
  }
  return false;
}
app.get("/api/notifications", requireLogin, (req, res) => {
  const account = req.account;
  const notifications = readNotifications()
    .filter(item => notificationBelongsToAccount(item, account))
    .slice(0, 100);
  res.json({ notifications, unreadCount: notifications.filter(item => !item.read).length });
});
app.patch("/api/notifications/:id/read", requireLogin, (req, res) => {
  const account = req.account;
  const items = readNotifications();
  const item = items.find(n => n.id === req.params.id && notificationBelongsToAccount(n, account));
  if (!item) return res.status(404).json({ error: "Notification not found." });
  item.read = true;
  saveNotifications(items);
  res.json({ ok: true });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "Chowoncampus" });
});

// Public menu includes crowd-sourced average ratings for restaurants and food items.
app.get("/api/menu", (req, res) => {
  const ratedOrders = readOrders().filter(order => order.rating);
  const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + Number(value), 0) / values.length * 10) / 10 : null;
  res.json({ restaurants: restaurants.map(restaurant => {
    const restaurantReviews = ratedOrders.filter(order => order.restaurantId === restaurant.id && order.rating.restaurantRating);
    return {
      ...restaurant,
      location: restaurant.location || "",
      ratingAverage: average(restaurantReviews.map(order => order.rating.restaurantRating)),
      ratingCount: restaurantReviews.length,
      items: restaurant.items.map(item => {
        const scores = ratedOrders.filter(order => order.restaurantId === restaurant.id)
          .flatMap(order => (order.rating.foodRatings || []).filter(rating => rating.itemId === item.id).map(rating => rating.rating));
        return { ...item, available: item.available !== false, ratingAverage: average(scores), ratingCount: scores.length };
      })
    };
  }) });
});

// Public quote endpoint: server-calculated fee based on restaurant and customer GPS/map pins.
app.post("/api/delivery/quote", (req, res) => {
  const restaurant = restaurants.find(item => item.id === req.body.restaurantId);
  if (!restaurant) return res.status(400).json({ error: "Choose a valid restaurant." });
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const hasDeliveryPin = req.body.latitude !== undefined && req.body.longitude !== undefined &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  res.json(calculateDeliveryQuote(restaurant, hasDeliveryPin ? latitude : null, hasDeliveryPin ? longitude : null));
});

// Restaurant partners can save their pickup pin using GPS or the map picker.
app.patch("/api/restaurant/location-coordinates", requireRole("restaurant"), (req, res) => {
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return res.status(400).json({ error: "Choose a valid pickup point on the map or use GPS." });
  }
  const restaurant = restaurants.find(item => item.id === req.account.restaurantId);
  if (!restaurant) return res.status(404).json({ error: "Restaurant account not found." });
  try {
    restaurant.latitude = latitude;
    restaurant.longitude = longitude;
    restaurantLocationCoordinates[restaurant.id] = { latitude, longitude, updatedAt: new Date().toISOString() };
    saveRestaurantLocations(restaurantLocationCoordinates);
    const records = readAddedRestaurants();
    const record = records.find(item => item.restaurant && item.restaurant.id === restaurant.id);
    if (record) {
      record.restaurant.latitude = latitude;
      record.restaurant.longitude = longitude;
      saveAddedRestaurants(records);
    }
    res.json({ ok: true, latitude, longitude, message: "Restaurant pickup pin saved." });
  } catch (error) {
    console.error("Could not save restaurant pickup coordinates:", error.message);
    res.status(500).json({ error: "Could not save pickup coordinates. Please try again." });
  }
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
  const { hostel, block, room, landmark, latitude, longitude, restaurantId, items, requestId } = req.body;
  let student;
  try {
    student = readStudents().find(item => item.phone === req.account.username);
  } catch (error) {
    return res.status(500).json({ error: "Could not verify your student account." });
  }
  if (!student) return res.status(403).json({ error: "A valid student account is required to order." });
  const customerName = student.name;
  const customerPhone = student.phone;
  const cleanRequestId = typeof requestId === "string" ? requestId.trim() : "";
  if (requestId !== undefined && (!cleanRequestId || cleanRequestId.length > 100)) {
    return res.status(400).json({ error: "Invalid order request identifier. Please try again." });
  }
  // Idempotency: a retry after a timeout returns the original order instead of creating a duplicate.
  if (cleanRequestId) {
    const existingOrder = readOrders().find(order => order.idempotencyKey === cleanRequestId);
    if (existingOrder) {
      if (existingOrder.customerPhone !== customerPhone) {
        return res.status(409).json({ error: "This order request identifier has already been used." });
      }
      return res.status(200).json({
        order: publicOrder(existingOrder),
        message: "This order was already received; returning the existing order."
      });
    }
  }

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

  // Mandatory one-time takeaway packaging fee is server-calculated and cannot be removed by the customer.
  const takeawayFee = 200;
  subtotal += takeawayFee;
  cleanItems.push({
    id: "takeaway-packaging",
    name: "Takeaway packaging (required)",
    price: takeawayFee,
    qty: 1
  });

  const deliveryQuote = calculateDeliveryQuote(
    restaurant,
    hasCoordinates ? Number(latitude) : null,
    hasCoordinates ? Number(longitude) : null
  );
  const deliveryFee = deliveryQuote.deliveryFee;
  const baseTotal = subtotal + deliveryFee;
  const paymentFee = Math.round(baseTotal * STUDENT_PAYMENT_FEE_RATE);

  const order = {
    id: `COC-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    hostel: [deliveryLocation.hostel, deliveryLocation.block && `Block ${deliveryLocation.block}`, deliveryLocation.room && `Room ${deliveryLocation.room}`, deliveryLocation.landmark && `Near ${deliveryLocation.landmark}`].filter(Boolean).join(", "),
    deliveryLocation,
    deliveryDistanceKm: deliveryQuote.distanceKm,
    estimatedRoadDistanceKm: deliveryQuote.estimatedRoadDistanceKm,
    deliveryPricingDistanceBased: deliveryQuote.distanceBased,
    deliveryPricingMessage: deliveryQuote.message,
    restaurantLocation: restaurant.location || "",
    restaurantLatitude: Number.isFinite(Number(restaurant.latitude)) && restaurant.latitude !== null ? Number(restaurant.latitude) : null,
    restaurantLongitude: Number.isFinite(Number(restaurant.longitude)) && restaurant.longitude !== null ? Number(restaurant.longitude) : null,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    items: cleanItems,
    takeawayFee,
    subtotal,
    deliveryFee,
    baseTotal,
    paymentFeeRate: STUDENT_PAYMENT_FEE_RATE,
    paymentFee,
    total: baseTotal + paymentFee,
    status: "Awaiting payment",
    statusHistory: [{ status: "Awaiting payment", at: new Date().toISOString(), by: "system" }],
    updatedAt: new Date().toISOString(),
    paymentStatus: IS_PRODUCTION ? "Unpaid" : "Unpaid — demo only",
    idempotencyKey: cleanRequestId || null,
    assignedAgentId: null,
    chatMessages: [],
    agentEarningsRecorded: false,
    createdAt: new Date().toISOString()
  };

  try {
    const orders = readOrders();
    orders.unshift(order);
    saveOrders(orders);
    // Keep unpaid production orders out of restaurant fulfilment until Paystack confirms payment.
    if (!IS_PRODUCTION) notifyOrderParties(order, "New order placed", order.customerName + " placed an order at " + order.restaurantName + ".");

    res.status(201).json({
      order: publicOrder(order),
      message: IS_PRODUCTION ? "Order created. Complete payment to confirm it." : "Demo order created. No payment has been made."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not save your order." });
  }
});

// Paystack checkout is initialized server-side; the secret key is never sent to the browser.
function hasPaystackConfig() {
  const key = String(process.env.PAYSTACK_SECRET_KEY || "").trim();
  // Production checkout must never silently run with a test key.
  return IS_PRODUCTION ? /^sk_live_/.test(key) : /^sk_test_/.test(key);
}

// Each restaurant has its own Paystack subaccount. Keep these codes in Render environment
// variables, never in browser code or committed source. Example: PAYSTACK_SUBACCOUNT_CB=ACCT_...
function getPaystackSubaccountCode(restaurantId) {
  const suffix = String(restaurantId || "").replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  const code = String(process.env["PAYSTACK_SUBACCOUNT_" + suffix] || "").trim();
  return /^ACCT_[A-Za-z0-9]+$/.test(code) ? code : null;
}

async function paystackRequest(url, options = {}) {
  const response = await fetch("https://api.paystack.co" + url, {
    ...options,
    headers: {
      Authorization: "Bearer " + process.env.PAYSTACK_SECRET_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status !== true) {
    console.error("Paystack request failed:", response.status, result.message || "unknown error");
    throw new Error("Payment provider could not complete the request. Please try again.");
  }
  return result.data;
}

app.post("/api/orders/:id/paystack/initialize", requireRole("student"), async (req, res) => {
  if (!IS_PRODUCTION) return res.status(400).json({ error: "Use the local demo payment flow outside production." });
  if (!hasPaystackConfig()) return res.status(503).json({ error: "Online payments are not configured yet. Please contact support." });
  const orders = readOrders();
  const order = orders.find(item => item.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (order.customerPhone !== req.account.username) return res.status(403).json({ error: "You can only pay for your own order." });
  const subaccountCode = getPaystackSubaccountCode(order.restaurantId);
  if (!subaccountCode) return res.status(503).json({ error: "This restaurant is not configured for secure split payments yet. Please contact ChowOnCampus support." });
  if (["Paid — Paystack verified", "Paid — demo verified"].includes(order.paymentStatus)) {
    return res.status(409).json({ error: "This order has already been paid." });
  }
  if (order.paymentStatus === "Payment pending" && order.paystackReference && order.paystackAuthorizationUrl &&
      order.paystackSplitConfigured === true && order.paystackSubaccountCode === subaccountCode) {
    return res.json({ authorizationUrl: order.paystackAuthorizationUrl, reference: order.paystackReference, orderId: order.id });
  }
  // Do not reuse a checkout link initialized before split payments were enabled or for another subaccount.
  if (order.paymentStatus === "Payment pending") {
    order.paymentStatus = "Unpaid";
    order.paystackReference = null;
    order.paystackAuthorizationUrl = null;
    order.paystackSplitConfigured = false;
  }
  const email = String(req.body.email || order.paymentEmail || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address for your payment receipt." });
  }
  if (order.status === "Cancelled") return res.status(400).json({ error: "This order has been cancelled." });
  if (!Number.isSafeInteger(Number(order.total)) || Number(order.total) <= 0) {
    return res.status(400).json({ error: "The order total is invalid. Please contact support." });
  }
  const reference = "COC-" + crypto.randomBytes(16).toString("hex");
  const baseUrl = String(process.env.PUBLIC_APP_URL || ((req.headers["x-forwarded-proto"] || req.protocol) + "://" + req.get("host"))).replace(/\/$/, "");
  const amountKobo = Math.round(Number(order.total) * 100);
  const restaurantShareKobo = Math.round(Number(order.subtotal) * 100);
  const platformShareKobo = Math.round((Number(order.deliveryFee) + Number(order.paymentFee || 0)) * 100);
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0 ||
      !Number.isSafeInteger(restaurantShareKobo) || restaurantShareKobo < 0 ||
      !Number.isSafeInteger(platformShareKobo) || platformShareKobo < 0 ||
      restaurantShareKobo + platformShareKobo !== amountKobo) {
    return res.status(400).json({ error: "The order payment split does not balance. Please recreate the order or contact support." });
  }
  try {
    const payment = await paystackRequest("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email,
        amount: amountKobo,
        currency: "NGN",
        reference,
        subaccount: subaccountCode,
        transaction_charge: platformShareKobo,
        bearer: "account",
        callback_url: baseUrl + "/?payment=paystack&orderId=" + encodeURIComponent(order.id),
        metadata: {
          order_id: order.id,
          customer_phone: order.customerPhone,
          restaurant_id: order.restaurantId,
          restaurant_share_kobo: restaurantShareKobo,
          platform_share_kobo: platformShareKobo,
          payment_fee_kobo: Math.round(Number(order.paymentFee || 0) * 100)
        }
      })
    });
    order.paymentEmail = email;
    order.paystackReference = reference;
    order.paystackAuthorizationUrl = payment.authorization_url;
    order.paystackSubaccountCode = subaccountCode;
    order.paystackSplitConfigured = true;
    order.restaurantShare = Number(order.subtotal);
    order.platformShare = Number(order.deliveryFee) + Number(order.paymentFee || 0);
    order.paymentInitializationAt = new Date().toISOString();
    order.paymentStatus = "Payment pending";
    order.updatedAt = order.paymentInitializationAt;
    saveOrders(orders);
    return res.json({ authorizationUrl: payment.authorization_url, reference, orderId: order.id });
  } catch (error) {
    console.error("Paystack initialization failed for order:", order.id, error.message);
    return res.status(502).json({ error: error.message || "Could not start payment. Please try again." });
  }
});

app.post("/api/payments/paystack/webhook", async (req, res) => {
  if (!hasPaystackConfig()) return res.sendStatus(503);
  const signature = String(req.headers["x-paystack-signature"] || "");
  const rawBody = req.rawBody;
  if (!signature || !rawBody) return res.sendStatus(400);
  const expected = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest();
  let received;
  try { received = Buffer.from(signature, "hex"); } catch { return res.sendStatus(401); }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return res.sendStatus(401);

  const event = req.body || {};
  if (event.event !== "charge.success" || !event.data) return res.sendStatus(200);
  const payment = event.data;
  const orderId = String(payment.metadata?.order_id || "");
  const reference = String(payment.reference || "");
  if (!orderId || !reference) return res.sendStatus(200);
  try {
    const orders = readOrders();
    const order = orders.find(item => item.id === orderId);
    if (!order || order.paystackReference !== reference) return res.sendStatus(200);
    const validPayment = payment.status === "success" &&
      Number(payment.amount) === Math.round(Number(order.total) * 100) &&
      payment.currency === "NGN" &&
      String(payment.metadata?.restaurant_id || "") === String(order.restaurantId) &&
      Number(payment.metadata?.restaurant_share_kobo) === Math.round(Number(order.subtotal) * 100) &&
      Number(payment.metadata?.platform_share_kobo) === Math.round((Number(order.deliveryFee) + Number(order.paymentFee || 0)) * 100) &&
      String(payment.customer?.email || "").toLowerCase() === String(order.paymentEmail || "").toLowerCase();
    if (!validPayment) {
      console.warn("Paystack webhook did not match order amount or customer:", order.id);
      return res.sendStatus(200);
    }
    if (order.paymentStatus !== "Paid — Paystack verified" && order.status !== "Cancelled") {
      const changedAt = new Date().toISOString();
      order.paymentStatus = "Paid — Paystack verified";
      order.paidAt = changedAt;
      order.paymentChannel = String(payment.channel || "");
      order.status = "Confirmed";
      order.updatedAt = changedAt;
      order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
      order.statusHistory.push({ status: "Confirmed", at: changedAt, by: "Paystack webhook" });
      saveOrders(orders);
      notifyOrderParties(order, "Payment verified — new order", order.customerName + " paid for an order at " + order.restaurantName + ".");
      return res.json({ received: true });
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error("Paystack webhook processing failed:", error.message);
    return res.sendStatus(500);
  }
});

app.post("/api/payments/paystack/verify", requireRole("student"), async (req, res) => {
  if (!hasPaystackConfig()) return res.status(503).json({ error: "Online payments are not configured yet." });
  const orderId = String(req.body.orderId || "").trim();
  const reference = String(req.body.reference || "").trim();
  if (!orderId || !reference || reference.length > 100) return res.status(400).json({ error: "Order ID and payment reference are required." });
  const orders = readOrders();
  const order = orders.find(item => item.id === orderId);
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (order.customerPhone !== req.account.username) return res.status(403).json({ error: "You can only verify your own order." });
  if (order.paymentStatus === "Paid — Paystack verified" && order.paystackReference === reference) {
    return res.json({ ok: true, order: publicOrder(order), message: "Payment was already verified." });
  }
  if (order.paystackReference !== reference) return res.status(400).json({ error: "This payment reference does not match the order." });
  if (order.status === "Cancelled") return res.status(400).json({ error: "This order has been cancelled." });
  try {
    const payment = await paystackRequest("/transaction/verify/" + encodeURIComponent(reference));
    const expectedAmount = Math.round(Number(order.total) * 100);
    if (payment.status !== "success" || payment.reference !== reference ||
        Number(payment.amount) !== expectedAmount || payment.currency !== "NGN" ||
        String(payment.metadata?.order_id || "") !== order.id ||
        String(payment.metadata?.restaurant_id || "") !== String(order.restaurantId) ||
        Number(payment.metadata?.restaurant_share_kobo) !== Math.round(Number(order.subtotal) * 100) ||
        Number(payment.metadata?.platform_share_kobo) !== Math.round((Number(order.deliveryFee) + Number(order.paymentFee || 0)) * 100) ||
        String(payment.customer?.email || "").toLowerCase() !== String(order.paymentEmail || "").toLowerCase()) {
      return res.status(400).json({ error: "Payment could not be verified against this order. If you were charged, contact support with your payment reference." });
    }
    const changedAt = new Date().toISOString();
    order.paymentStatus = "Paid — Paystack verified";
    order.paidAt = changedAt;
    order.paymentChannel = String(payment.channel || "");
    order.status = "Confirmed";
    order.updatedAt = changedAt;
    order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    order.statusHistory.push({ status: "Confirmed", at: changedAt, by: "Paystack verification" });
    saveOrders(orders);
    notifyOrderParties(order, "Payment verified — new order", order.customerName + " paid for an order at " + order.restaurantName + ".");
    return res.json({ ok: true, order: publicOrder(order), message: "Payment verified successfully. Your order is confirmed." });
  } catch (error) {
    console.error("Paystack verification failed for order:", order.id, error.message);
    return res.status(502).json({ error: "We could not verify the payment right now. If you were charged, contact support with your payment reference." });
  }
});

// Local testing only: simulates payment without charging money.
// View orders: restaurants see their orders, agents see assigned orders.
app.get("/api/orders", requireLogin, (req, res) => {
  try {
    let orders = readOrders();

    if (req.account.role === "restaurant") {
      orders = orders.filter(
        order => order.restaurantId === req.account.restaurantId &&
          ["Paid — demo verified", "Paid — Paystack verified"].includes(order.paymentStatus)
      );
    } else if (req.account.role === "agent") {
      orders = orders.filter(
        order => order.assignedAgentId === req.account.agentId &&
          ["Paid — demo verified", "Paid — Paystack verified"].includes(order.paymentStatus)
      );
    } else if (req.account.role === "student") {
      // Students see active orders and a short post-delivery feedback window only.
      // Older completed/cancelled orders remain available for admin review.
      const activeStatuses = new Set(["Awaiting payment", "Confirmed", "Preparing", "Ready for pickup", "Out for delivery"]);
      const feedbackWindowMs = 2 * 60 * 1000;
      orders = orders.filter(order => {
        if (order.customerPhone !== req.account.username) return false;
        if (activeStatuses.has(order.status)) return true;
        if (order.status !== "Completed") return false;
        const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
        const completedEvent = [...history].reverse().find(event => event.status === "Completed");
        const completedAt = order.deliveredAt || order.completedAt || completedEvent?.at;
        const completedTime = completedAt ? new Date(completedAt).getTime() : NaN;
        return Number.isFinite(completedTime) && Date.now() - completedTime < feedbackWindowMs;
      });
    } else if (req.account.role !== "admin") {
      return res.status(403).json({ error: "You don't have permission to view orders." });
    }

    res.json({ orders: orders.map(publicOrder) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ratings are stored on completed orders, so each order can only be reviewed once.
app.post("/api/orders/:id/rating", requireRole("student"), (req, res) => {
  const orders = readOrders();
  const order = orders.find(item => item.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (order.customerPhone !== req.account.username) return res.status(403).json({ error: "You can only rate your own orders." });
  if (order.status !== "Completed") return res.status(400).json({ error: "You can rate an order after it is completed." });
  if (order.rating) return res.status(409).json({ error: "This order has already been rated." });
  const validScore = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 5;
  const restaurantRating = Number(req.body.restaurantRating);
  const agentRating = Number(req.body.agentRating);
  const foodRatings = req.body.foodRatings;
  if (!validScore(restaurantRating)) return res.status(400).json({ error: "Choose a restaurant rating from 1 to 5 stars." });
  if (order.assignedAgentId && !validScore(agentRating)) return res.status(400).json({ error: "Choose a delivery-agent rating from 1 to 5 stars." });
  if (!Array.isArray(foodRatings) || foodRatings.length !== order.items.length) return res.status(400).json({ error: "Rate each food item in this order." });
  const cleanedFoodRatings = [];
  for (const item of order.items) {
    const submitted = foodRatings.find(rating => rating.itemId === item.id);
    if (!submitted || !validScore(submitted.rating)) return res.status(400).json({ error: "Choose a 1–5 star rating for " + item.name + "." });
    cleanedFoodRatings.push({ itemId: item.id, itemName: item.name, rating: Number(submitted.rating) });
  }
  const comment = String(req.body.comment || "").trim().slice(0, 500);
  order.rating = {
    studentName: order.customerName,
    restaurantId: order.restaurantId,
    restaurantName: order.restaurantName,
    restaurantRating,
    agentId: order.assignedAgentId || null,
    agentRating: order.assignedAgentId ? agentRating : null,
    foodRatings: cleanedFoodRatings,
    comment,
    ratedAt: new Date().toISOString()
  };
  saveOrders(orders);
  res.status(201).json({ ok: true, message: "Thanks for rating your food, restaurant and delivery experience." });
});

app.get("/api/ratings/summary", requireLogin, (req, res) => {
  const orders = readOrders();
  const ratedOrders = orders.filter(order => order.rating);
  const scoped = req.account.role === "restaurant"
    ? ratedOrders.filter(order => order.restaurantId === req.account.restaurantId)
    : req.account.role === "agent"
      ? ratedOrders.filter(order => order.assignedAgentId === req.account.agentId)
      : req.account.role === "student"
        ? ratedOrders.filter(order => order.customerPhone === req.account.username)
        : ratedOrders;
  const average = values => values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;
  const restaurantMap = new Map();
  const foodMap = new Map();
  const agentMap = new Map();
  for (const order of scoped) {
    const rating = order.rating;
    if (rating.restaurantRating) {
      if (!restaurantMap.has(order.restaurantId)) restaurantMap.set(order.restaurantId, { id: order.restaurantId, name: order.restaurantName, scores: [] });
      restaurantMap.get(order.restaurantId).scores.push(Number(rating.restaurantRating));
    }
    for (const food of rating.foodRatings || []) {
      const key = order.restaurantId + ":" + food.itemId;
      if (!foodMap.has(key)) foodMap.set(key, { id: food.itemId, restaurantId: order.restaurantId, restaurantName: order.restaurantName, name: food.itemName, scores: [] });
      foodMap.get(key).scores.push(Number(food.rating));
    }
    if (order.assignedAgentId && rating.agentRating) {
      if (!agentMap.has(order.assignedAgentId)) {
        const agent = readAgentRecords().find(item => item.id === order.assignedAgentId);
        agentMap.set(order.assignedAgentId, { id: order.assignedAgentId, name: agent?.name || order.assignedAgentId, scores: [] });
      }
      agentMap.get(order.assignedAgentId).scores.push(Number(rating.agentRating));
    }
  }
  const shape = map => [...map.values()].map(item => ({ ...item, average: average(item.scores), count: item.scores.length })).sort((a, b) => (b.average || 0) - (a.average || 0));
  res.json({
    totalReviews: scoped.length,
    restaurants: shape(restaurantMap),
    food: shape(foodMap),
    agents: shape(agentMap),
    reviews: [...scoped].sort((a, b) => new Date(b.rating.ratedAt || 0) - new Date(a.rating.ratedAt || 0)).map(order => ({
      orderId: order.id, studentName: order.rating.studentName,
      restaurantName: order.restaurantName, restaurantRating: order.rating.restaurantRating,
      agentId: order.assignedAgentId || null, agentRating: order.rating.agentRating,
      foodRatings: order.rating.foodRatings || [], comment: order.rating.comment || "",
      ratedAt: order.rating.ratedAt, deliveredAt: order.deliveredAt || order.completedAt || null
    }))
  });
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

const DELIVERY_CHAT_GRACE_MS = 2 * 60 * 1000;

function deliveryChatIsOpen(order) {
  if (["Ready for pickup", "Out for delivery"].includes(order.status)) return true;
  if (order.status !== "Completed") return false;
  const deliveredAt = new Date(order.deliveredAt || order.completedAt || 0).getTime();
  return Number.isFinite(deliveredAt) && deliveredAt > 0 && Date.now() <= deliveredAt + DELIVERY_CHAT_GRACE_MS;
}

function removeExpiredDeliveryChat(order) {
  if (order.status !== "Completed") return false;
  const deliveredAt = new Date(order.deliveredAt || order.completedAt || 0).getTime();
  if (!Number.isFinite(deliveredAt) || !deliveredAt || Date.now() <= deliveredAt + DELIVERY_CHAT_GRACE_MS) return false;
  if (!Object.prototype.hasOwnProperty.call(order, "chatMessages")) return false;
  delete order.chatMessages;
  return true;
}

app.get("/api/orders/:id/chat", requireRole("student", "agent", "restaurant"), (req, res) => {
  try {
    const orders = readOrders();
    const requestedOrderId = String(req.params.id || "").trim();
    const order = orders.find(item => String(item.id || "").trim() === requestedOrderId) || orders.find(item => String(item.id || "").trim().toLowerCase() === requestedOrderId.toLowerCase());
    if (!order) {
      console.warn("Delivery chat order lookup failed", { storedOrderCount: orders.length });
      return res.status(404).json({ error: "This order could not be found by the chat service. Refresh your deliveries and open the chat again." });
    }
    if (!canUseDeliveryChat(req.account, order)) return res.status(403).json({ error: "Only the ordering student and assigned delivery agent can access this chat." });
    if (removeExpiredDeliveryChat(order)) saveOrders(orders);
    if (!deliveryChatIsOpen(order)) return res.status(410).json({ active: false, messages: [], error: "This temporary chat closed two minutes after delivery." });
    const deliveredAt = new Date(order.deliveredAt || order.completedAt || 0).getTime();
    res.json({ active: true, expiresAt: order.status === "Completed" ? new Date(deliveredAt + DELIVERY_CHAT_GRACE_MS).toISOString() : null, messages: Array.isArray(order.chatMessages) ? order.chatMessages : [] });
  } catch (error) {
    res.status(500).json({ error: "Could not load delivery chat." });
  }
});

app.post("/api/orders/:id/chat", requireRole("student", "agent", "restaurant"), (req, res) => {
  const message = String(req.body.message || "").trim();
  if (!message || message.length > 500) return res.status(400).json({ error: "Message must be between 1 and 500 characters." });
  try {
    const orders = readOrders();
    const requestedOrderId = String(req.params.id || "").trim();
    const order = orders.find(item => String(item.id || "").trim() === requestedOrderId) || orders.find(item => String(item.id || "").trim().toLowerCase() === requestedOrderId.toLowerCase());
    if (!order) {
      console.warn("Delivery chat send lookup failed", { storedOrderCount: orders.length });
      return res.status(404).json({ error: "This order could not be found by the chat service. Refresh your deliveries and open the chat again." });
    }
    if (!canUseDeliveryChat(req.account, order)) return res.status(403).json({ error: "Only the ordering student and assigned delivery agent can send messages here." });
    if (removeExpiredDeliveryChat(order)) {
      saveOrders(orders);
      return res.status(410).json({ error: "This temporary chat closed two minutes after delivery." });
    }
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
// Admin-only location overview. Student pins are their latest saved delivery points;
 // agent GPS is shown only while the agent is online; restaurant pins are pickup locations.
app.get("/api/admin/locations", requireRole("admin"), (req, res) => {
  try {
    const inNigeria = (latitude, longitude) =>
      Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) &&
      Number(latitude) >= 4 && Number(latitude) <= 14 &&
      Number(longitude) >= 2 && Number(longitude) <= 15;
    const orders = readOrders().slice().sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    const students = readStudents().map(student => {
      const latestOrder = orders.find(order => order.customerPhone === student.phone &&
        Number.isFinite(Number(order.deliveryLocation?.latitude)) &&
        Number.isFinite(Number(order.deliveryLocation?.longitude)) &&
        order.deliveryLocation?.latitude !== null && order.deliveryLocation?.longitude !== null);
      const pin = latestOrder ? latestOrder.deliveryLocation : null;
      return {
        id: student.id,
        name: student.name,
        username: student.username || student.phone,
        latitude: pin && inNigeria(pin.latitude, pin.longitude) ? Number(pin.latitude) : null,
        longitude: pin && inNigeria(pin.latitude, pin.longitude) ? Number(pin.longitude) : null,
        locationLabel: pin ? (latestOrder.hostel || pin.hostel || "Saved delivery point") : "",
        updatedAt: pin ? (latestOrder.updatedAt || latestOrder.createdAt || null) : null,
        locationType: "latest-delivery-pin"
      };
    });
    const agentRows = readAgentRecords().map(agent => ({
      id: agent.id,
      name: agent.name,
      username: agent.username,
      online: Boolean(agent.online),
      latitude: agent.online && inNigeria(agent.latitude, agent.longitude) ? Number(agent.latitude) : null,
      longitude: agent.online && inNigeria(agent.latitude, agent.longitude) ? Number(agent.longitude) : null,
      updatedAt: agent.online ? (agent.locationUpdatedAt || null) : null,
      locationType: "agent-gps"
    }));
    const restaurantRows = restaurants.map(restaurant => ({
      id: restaurant.id,
      name: restaurant.name,
      locationLabel: restaurant.location || "",
      latitude: inNigeria(restaurant.latitude, restaurant.longitude) ? Number(restaurant.latitude) : null,
      longitude: inNigeria(restaurant.latitude, restaurant.longitude) ? Number(restaurant.longitude) : null,
      updatedAt: restaurantLocationCoordinates[restaurant.id]?.updatedAt || null,
      locationType: "restaurant-pickup"
    }));
    res.json({ students, agents: agentRows, restaurants: restaurantRows });
  } catch (error) {
    console.error("Could not load admin location overview:", error.message);
    res.status(500).json({ error: "Could not load location data. Please refresh and try again." });
  }
});

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

// Ultimate admin can reset a student, restaurant, or agent password when they lose access.
app.post("/api/superadmin/reset-password", requireSuperAdmin, (req, res) => {
  const role = String(req.body.role || "");
  const id = String(req.body.id || "").trim();
  const password = String(req.body.password || "");
  if (!["student", "restaurant", "agent"].includes(role)) {
    return res.status(400).json({ error: "Choose a student, restaurant, or agent account." });
  }
  if (!id) return res.status(400).json({ error: "Choose an account to reset." });
  if (password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: "Temporary password must be 10–128 characters." });
  }

  try {
    let username = "";
    let targetName = "";
    const hashed = hashPassword(password);

    if (role === "student") {
      const records = readStudents();
      const student = records.find(item => item.id === id);
      if (!student) return res.status(404).json({ error: "Student account not found." });
      student.passwordSalt = hashed.salt;
      student.passwordHash = hashed.hash;
      saveStudents(records);
      username = student.phone;
      targetName = student.name;
    } else if (role === "agent") {
      const records = readAgentRecords();
      const agent = records.find(item => item.id === id);
      if (!agent) return res.status(404).json({ error: "Delivery agent not found." });
      agent.passwordSalt = hashed.salt;
      agent.passwordHash = hashed.hash;
      saveAgentRecords(records);
      username = agent.username;
      targetName = agent.name;
      const staffAccount = accounts.find(item => item.role === "agent" && item.agentId === id);
      if (staffAccount) {
        staffAccount.passwordSalt = hashed.salt;
        staffAccount.passwordHash = hashed.hash;
        staffAccount.password = "";
      }
    } else {
      const restaurant = restaurants.find(item => item.id === id);
      if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });
      const staffAccount = accounts.find(item => item.role === "restaurant" && item.restaurantId === id);
      if (!staffAccount) return res.status(404).json({ error: "Restaurant login account not found." });
      username = staffAccount.username;
      targetName = restaurant.name;
      staffAccount.passwordSalt = hashed.salt;
      staffAccount.passwordHash = hashed.hash;
      staffAccount.password = "";
    }

    if (role !== "student") {
      const overrides = readAccountPasswords();
      overrides[role + ":" + username] = {
        passwordSalt: hashed.salt,
        passwordHash: hashed.hash,
        changedAt: new Date().toISOString(),
        resetBy: req.account.username
      };
      saveAccountPasswords(overrides);
    }

    for (const [token, session] of sessions.entries()) {
      if (session.role === role && (session.username === username ||
          (role === "agent" && session.agentId === id) ||
          (role === "restaurant" && session.restaurantId === id))) {
        sessions.delete(token);
      }
    }

    res.json({
      ok: true,
      message: "Password reset for " + targetName + ". Share the temporary password securely and ask them to change it after logging in."
    });
  } catch (error) {
    console.error("Ultimate admin password reset failed:", error.message);
    res.status(500).json({ error: "Could not reset that password. Please try again." });
  }
});

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

function distanceKm(aLat, aLon, bLat, bLon) {
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function calculateDeliveryQuote(restaurant, deliveryLatitude, deliveryLongitude) {
  const hasRestaurantPin = restaurant &&
    restaurant.latitude !== null && restaurant.latitude !== undefined &&
    restaurant.longitude !== null && restaurant.longitude !== undefined &&
    Number.isFinite(Number(restaurant.latitude)) && Number.isFinite(Number(restaurant.longitude));
  const hasDeliveryPin = deliveryLatitude !== null && deliveryLatitude !== undefined &&
    deliveryLongitude !== null && deliveryLongitude !== undefined &&
    Number.isFinite(Number(deliveryLatitude)) && Number.isFinite(Number(deliveryLongitude));
  let distanceKmValue = null;
  let estimatedRoadDistanceKm = null;
  if (hasRestaurantPin && hasDeliveryPin) {
    distanceKmValue = Math.round(distanceKm(
      Number(restaurant.latitude), Number(restaurant.longitude),
      Number(deliveryLatitude), Number(deliveryLongitude)
    ) * 10) / 10;
    // Distance is informational only; it never changes the delivery fee.
    estimatedRoadDistanceKm = Math.round(distanceKmValue * 1.3 * 10) / 10;
  }
  return {
    deliveryFee: FIXED_DELIVERY_FEE,
    distanceKm: distanceKmValue,
    estimatedRoadDistanceKm,
    distanceBased: false,
    baseFee: FIXED_DELIVERY_FEE,
    perKm: 0,
    message: "Fixed delivery fee: ₦300 for every order."
  };
}

function assignReadyOrders() {
  const records = readAgentRecords();
  const orders = readOrders();
  const busyAgentIds = new Set(orders.filter(order =>
    order.assignedAgentId && !["Completed", "Cancelled"].includes(order.status)
  ).map(order => order.assignedAgentId));
  const waiting = orders.filter(order =>
    order.status === "Ready for pickup" && !order.assignedAgentId
  );
  let changed = false;

  for (const order of waiting) {
    const tried = new Set(Array.isArray(order.offeredAgentIds) ? order.offeredAgentIds : []);
    const eligible = records.filter(agent =>
      agent.online && !busyAgentIds.has(agent.id) && !agent.activeOrderId && !tried.has(agent.id)
    );
    if (!eligible.length) continue;

    // Pickup is at the restaurant. Never use the student's delivery pin as a
    // substitute for restaurant coordinates; without a pickup pin use fair rotation.
    const targetLatitude = order.restaurantLatitude;
    const targetLongitude = order.restaurantLongitude;
    const hasTargetCoords = targetLatitude !== null && targetLatitude !== undefined &&
      targetLongitude !== null && targetLongitude !== undefined &&
      Number.isFinite(Number(targetLatitude)) && Number.isFinite(Number(targetLongitude));
    eligible.sort((a, b) => {
      const aHas = Number.isFinite(Number(a.latitude)) && Number.isFinite(Number(a.longitude)) &&
        a.latitude !== null && a.longitude !== null && hasTargetCoords;
      const bHas = Number.isFinite(Number(b.latitude)) && Number.isFinite(Number(b.longitude)) &&
        b.latitude !== null && b.longitude !== null && hasTargetCoords;
      if (aHas && bHas) {
        return distanceKm(targetLatitude, targetLongitude, a.latitude, a.longitude) -
          distanceKm(targetLatitude, targetLongitude, b.latitude, b.longitude);
      }
      if (aHas !== bHas) return aHas ? -1 : 1;
      return new Date(a.lastAssignedAt || 0) - new Date(b.lastAssignedAt || 0);
    });

    const agent = eligible[0];
    const now = new Date();
    order.assignedAgentId = agent.id;
    order.assignmentOfferedAt = now.toISOString();
    order.assignmentExpiresAt = new Date(now.getTime() + 60 * 1000).toISOString();
    order.offeredAgentIds = [...tried, agent.id];
    order.updatedAt = now.toISOString();
    order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    order.statusHistory.push({ status: "Delivery assignment offered", at: now.toISOString(), by: "system" });
    agent.activeOrderId = order.id;
    agent.lastAssignedAt = now.toISOString();
    busyAgentIds.add(agent.id);

    createNotification({ role: "agent", agentId: agent.id }, "Pickup request — 60 seconds to accept",
      `Order ${order.id} is ready for pickup. Accept by starting delivery within 60 seconds or it will be offered to another agent.`, order.id);
    createNotification({ role: "student", username: order.customerPhone }, "Finding a delivery agent",
      `A pickup request for order ${order.id} has been sent to ${agent.name}.`, order.id);
    createNotification({ role: "admin" }, "Pickup request sent",
      `${agent.name} has 60 seconds to accept order ${order.id}.`, order.id);
    createNotification({ role: "restaurant", restaurantId: order.restaurantId }, "Delivery agent notified",
      `${agent.name} has 60 seconds to accept pickup for ${order.id}.`, order.id);
    changed = true;
  }

  if (changed) {
    saveAgentRecords(records);
    saveOrders(orders);
    agents = records.map(record => ({
      id: record.id, name: record.name, username: record.username,
      online: Boolean(record.online), activeOrderId: record.activeOrderId || null,
      createdAt: record.createdAt || null
    }));
  }
  return changed;
}

// If an agent does not accept within 60 seconds, release the order and offer it
// to the next available agent. Starting delivery counts as accepting the offer.
function expireUnacceptedOffers() {
  const orders = readOrders();
  const records = readAgentRecords();
  const now = Date.now();
  let ordersChanged = false;
  let agentsChanged = false;

  for (const order of orders) {
    if (order.status !== "Ready for pickup" || !order.assignedAgentId ||
        !order.assignmentExpiresAt || order.assignmentAcceptedAt) continue;
    if (new Date(order.assignmentExpiresAt).getTime() > now) continue;

    const previousAgentId = order.assignedAgentId;
    const previousAgent = records.find(agent => agent.id === previousAgentId);
    if (previousAgent && previousAgent.activeOrderId === order.id) {
      previousAgent.activeOrderId = null;
      agentsChanged = true;
    }
    createNotification({ role: "agent", agentId: previousAgentId }, "Pickup request expired",
      `The 60-second window for order ${order.id} expired. The order will be offered to another agent.`, order.id);
    order.assignedAgentId = null;
    order.assignmentExpiresAt = null;
    order.updatedAt = new Date().toISOString();
    order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    order.statusHistory.push({ status: "Pickup offer expired", at: order.updatedAt, by: "system" });
    ordersChanged = true;
  }

  if (agentsChanged) {
    saveAgentRecords(records);
    agents = records.map(record => ({
      id: record.id, name: record.name, username: record.username,
      online: Boolean(record.online), activeOrderId: record.activeOrderId || null,
      createdAt: record.createdAt || null
    }));
  }
  if (ordersChanged) saveOrders(orders);
  if (ordersChanged) assignReadyOrders();
}

setInterval(() => {
  try { expireUnacceptedOffers(); }
  catch (error) { console.error("Pickup offer expiry check failed:", error.message); }
}, 5000);

// Admin can override an agent's availability and trigger assignment when enabling them.
app.patch("/api/admin/agents/:id/availability", requireRole("admin"), (req, res) => {
  if (typeof req.body.online !== "boolean") return res.status(400).json({ error: "Choose online or offline." });
  try {
    const records = readAgentRecords();
    const agent = records.find(item => item.id === req.params.id);
    if (!agent) return res.status(404).json({ error: "Delivery agent not found." });
    agent.online = req.body.online;
    agent.availabilityUpdatedAt = new Date().toISOString();
    // Do not retain a live location after an agent goes offline.
    if (!agent.online) {
      agent.latitude = null;
      agent.longitude = null;
      agent.locationUpdatedAt = null;
    }
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
    const successfulDeliveries = readOrders().filter(order =>
      String(order.assignedAgentId || "") === String(agent.id) && order.status === "Completed"
    ).length;
    res.json({
      id: agent.id,
      name: agent.name,
      username: agent.username,
      online: Boolean(agent.online),
      activeOrderId: agent.activeOrderId || null,
      successfulDeliveries
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load agent profile." });
  }
});

// Agent explicitly accepts a pickup offer within its 60-second window.
app.post("/api/agent/assignments/:id/accept", requireRole("agent"), (req, res) => {
  try {
    const orders = readOrders();
    const order = orders.find(item => item.id === req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (order.assignedAgentId !== req.account.agentId || order.status !== "Ready for pickup") {
      return res.status(409).json({ error: "This pickup offer is no longer assigned to you." });
    }
    if (!order.assignmentExpiresAt || new Date(order.assignmentExpiresAt).getTime() <= Date.now()) {
      expireUnacceptedOffers();
      return res.status(409).json({ error: "The 60-second window expired. The order may have been offered to another agent." });
    }
    order.assignmentAcceptedAt = new Date().toISOString();
    order.assignmentExpiresAt = null;
    order.updatedAt = order.assignmentAcceptedAt;
    order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    order.statusHistory.push({ status: "Delivery assignment accepted", at: order.assignmentAcceptedAt, by: "agent" });
    saveOrders(orders);
    createNotification({ role: "restaurant", restaurantId: order.restaurantId }, "Delivery agent accepted",
      `The delivery agent accepted pickup for ${order.id} and is heading to collect it.`, order.id);
    createNotification({ role: "student", username: order.customerPhone }, "Delivery agent accepted",
      `Your delivery agent accepted order ${order.id} and is heading to the restaurant.`, order.id);
    res.json({ ok: true, message: "Pickup accepted. Head to the restaurant." });
  } catch (error) {
    res.status(500).json({ error: "Could not accept this pickup offer." });
  }
});

// Agents can update their current GPS position so pickup offers can be sorted by distance.
app.patch("/api/agent/location", requireRole("agent"), (req, res) => {
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return res.status(400).json({ error: "Provide valid GPS coordinates." });
  }
  try {
    const records = readAgentRecords();
    const agent = records.find(item => item.id === req.account.agentId);
    if (!agent) return res.status(404).json({ error: "Agent account not found." });
    agent.latitude = latitude;
    agent.longitude = longitude;
    agent.locationUpdatedAt = new Date().toISOString();
    saveAgentRecords(records);
    res.json({ ok: true, message: "Agent location updated." });
  } catch (error) {
    res.status(500).json({ error: "Could not update agent location." });
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

      if (newStatus === "Completed" && order.status !== "Out for delivery") {
        return res.status(400).json({ error: "Confirm delivery only after the order is marked Out for delivery." });
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
      !["Paid — demo verified", "Paid — Paystack verified"].includes(order.paymentStatus)
    ) {
      return res.status(400).json({
        error: "This order is unpaid. Complete and verify payment before fulfilment."
      });
    }

    const previousStatus = order.status;
    if (order.status !== newStatus) {
      const changedAt = new Date().toISOString();
      order.status = newStatus;
      order.updatedAt = changedAt;
      order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [{ status: previousStatus, at: order.createdAt, by: "system" }];
      order.statusHistory.push({ status: newStatus, at: changedAt, by: req.account.role });
    }

    // Delivery chat stays available for two minutes after successful delivery,
    // then its messages are removed on the next chat request.
    if (newStatus === "Cancelled") delete order.chatMessages;

    // Starting delivery accepts the 60-second pickup offer.
    if (newStatus === "Out for delivery" && order.assignedAgentId === req.account.agentId) {
      order.assignmentAcceptedAt = new Date().toISOString();
      order.assignmentExpiresAt = null;
    }

    // Stamp completion once, for restaurant history, ratings and agent earnings.
    if (newStatus === "Completed" && previousStatus !== "Completed") {
      const deliveredAt = new Date().toISOString();
      order.completedAt = deliveredAt;
      order.deliveredAt = deliveredAt;
      if (!order.agentEarningsRecorded) {
        order.agentEarningsRecorded = true;
        order.agentEarnings = AGENT_EARNING_PER_DELIVERY;
      }
    }

    saveOrders(orders);
    if (previousStatus !== newStatus) notifyOrderStatusChanged(order, previousStatus, newStatus);
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

// Monthly delivery earnings and payment history. Amounts are calculated from completed deliveries,
// while payout records are written only by an administrator and persist in PostgreSQL-backed app storage.
function normalizeEarningsMonth(value) {
  const input = typeof value === "string" ? value : "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input)) return null;
  const [year, month] = input.split("-").map(Number);
  if (year < 2020 || year > 2100) return null;
  return { key: input, year, monthIndex: month - 1 };
}

function monthlyAgentEarnings(orders, agentId, monthInfo) {
  const completed = orders.filter(order => {
    if (String(order.assignedAgentId || "") !== String(agentId) || !order.agentEarningsRecorded || !order.completedAt) return false;
    const date = new Date(order.completedAt);
    return !Number.isNaN(date.getTime()) && date.getUTCMonth() === monthInfo.monthIndex && date.getUTCFullYear() === monthInfo.year;
  });
  return {
    completedDeliveries: completed.length,
    earned: completed.reduce((sum, order) => sum + Math.max(0, Number(order.agentEarnings ?? AGENT_EARNING_PER_DELIVERY) || 0), 0)
  };
}

function agentPaymentSummary(agentId, monthKey, payments) {
  return payments.filter(payment => String(payment.agentId) === String(agentId) && payment.month === monthKey)
    .reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) || 0), 0);
}

app.get("/api/earnings", requireRole("admin", "agent"), (req, res) => {
  try {
    const now = new Date();
    const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthInfo = normalizeEarningsMonth(req.query.month || defaultMonth);
    if (!monthInfo) return res.status(400).json({ error: "Choose a valid month in YYYY-MM format." });
    const orders = readOrders();
    const payments = readAgentPayments();
    const monthPayments = payments.filter(payment => payment.month === monthInfo.key)
      .sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));

    if (req.account.role === "agent") {
      const agent = readAgentRecords().find(item => item.id === req.account.agentId);
      if (!agent) return res.status(404).json({ error: "Agent account not found." });
      const totals = monthlyAgentEarnings(orders, agent.id, monthInfo);
      const paid = agentPaymentSummary(agent.id, monthInfo.key, payments);
      return res.json({
        month: monthInfo.key,
        agent: { id: agent.id, name: agent.name, ...totals, paid, outstanding: Math.max(0, totals.earned - paid) },
        payments: monthPayments.filter(payment => payment.agentId === agent.id).map(payment => ({
          id: payment.id, month: payment.month, amount: payment.amount, reference: payment.reference || "",
          note: payment.note || "", paidAt: payment.paidAt, paidBy: payment.paidBy
        })),
        note: "Earnings are bookkeeping records. Payments shown here are marked as paid by an administrator."
      });
    }

    const agentsForSummary = readAgentRecords().map(agent => {
      const totals = monthlyAgentEarnings(orders, agent.id, monthInfo);
      const paid = agentPaymentSummary(agent.id, monthInfo.key, payments);
      return { id: agent.id, name: agent.name, username: agent.username, ...totals, paid, outstanding: Math.max(0, totals.earned - paid) };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const paymentRows = monthPayments.map(payment => ({
      id: payment.id, agentId: payment.agentId, agentName: payment.agentName || "Delivery agent",
      month: payment.month, amount: payment.amount, reference: payment.reference || "",
      note: payment.note || "", paidAt: payment.paidAt, paidBy: payment.paidBy
    }));
    res.json({
      month: monthInfo.key,
      agents: agentsForSummary,
      payments: paymentRows,
      totals: {
        completedDeliveries: agentsForSummary.reduce((sum, agent) => sum + agent.completedDeliveries, 0),
        earned: agentsForSummary.reduce((sum, agent) => sum + agent.earned, 0),
        paid: agentsForSummary.reduce((sum, agent) => sum + agent.paid, 0),
        outstanding: agentsForSummary.reduce((sum, agent) => sum + agent.outstanding, 0)
      },
      note: "Record a payout only after the transfer has actually been made. This feature does not send money automatically."
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load monthly agent earnings." });
  }
});

app.post("/api/admin/agent-payments", requireRole("admin"), (req, res) => {
  try {
    const agentId = String(req.body.agentId || "").trim();
    const monthInfo = normalizeEarningsMonth(req.body.month);
    if (!agentId) return res.status(400).json({ error: "Choose a delivery agent." });
    if (!monthInfo) return res.status(400).json({ error: "Choose a valid month in YYYY-MM format." });

    const agent = readAgentRecords().find(item => item.id === agentId);
    if (!agent) return res.status(404).json({ error: "Delivery agent not found." });

    const orders = readOrders();
    const payments = readAgentPayments();
    const totals = monthlyAgentEarnings(orders, agentId, monthInfo);
    const paid = agentPaymentSummary(agentId, monthInfo.key, payments);
    const outstanding = Math.max(0, totals.earned - paid);
    const amount = req.body.amount === undefined || req.body.amount === "" ? outstanding : Number(req.body.amount);
    const reference = String(req.body.reference || "").trim().slice(0, 120);
    const note = String(req.body.note || "").trim().slice(0, 300);

    if (!Number.isSafeInteger(amount) || amount <= 0) return res.status(400).json({ error: "Enter a whole-number payout amount greater than ₦0." });
    if (amount > outstanding) return res.status(400).json({ error: `Payout exceeds the outstanding balance of ₦${outstanding.toLocaleString("en-NG")}.` });
    if (outstanding <= 0) return res.status(409).json({ error: "There is no unpaid balance for this agent in that month." });

    const payment = {
      id: "PAY-" + crypto.randomBytes(6).toString("hex").toUpperCase(),
      agentId: agent.id,
      agentName: agent.name,
      month: monthInfo.key,
      amount,
      reference,
      note,
      paidAt: new Date().toISOString(),
      paidBy: req.account.username
    };
    payments.unshift(payment);
    saveAgentPayments(payments);
    createNotification(
      { role: "agent", agentId: agent.id },
      "Monthly earnings payment recorded",
      `An administrator recorded a ₦${amount.toLocaleString("en-NG")} payment for ${monthInfo.key}.${reference ? " Reference: " + reference + "." : ""}`
    );
    res.status(201).json({
      payment: { id: payment.id, agentId: payment.agentId, agentName: payment.agentName, month: payment.month, amount: payment.amount, reference: payment.reference, note: payment.note, paidAt: payment.paidAt, paidBy: payment.paidBy },
      message: "Payment record saved. This records a payment; it does not transfer money."
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not record the agent payment." });
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
