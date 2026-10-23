
require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Demo storage only. Use a persistent database before public launch.
const DATA_FILE = path.join(__dirname, "orders.json");
const sessions = new Map();

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
  try {
    if (!fs.existsSync(RESTAURANTS_FILE)) return [];
    const records = JSON.parse(fs.readFileSync(RESTAURANTS_FILE, "utf8"));
    if (!Array.isArray(records)) throw new Error("Invalid restaurant data.");
    return records;
  } catch (error) {
    console.error("Could not read added restaurants:", error.message);
    throw new Error("Restaurant storage is unavailable.");
  }
}
function saveAddedRestaurants(records) {
  const temp = RESTAURANTS_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(records, null, 2), "utf8");
  fs.renameSync(temp, RESTAURANTS_FILE);
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

/* Delivery agents are created by an administrator. JSON storage is demo storage;
   use a persistent database before relying on this for live operations. */
const AGENTS_FILE = path.join(__dirname, "delivery-agents.json");
function readAgentRecords() {
  try {
    if (!fs.existsSync(AGENTS_FILE)) return [];
    const records = JSON.parse(fs.readFileSync(AGENTS_FILE, "utf8"));
    if (!Array.isArray(records)) throw new Error("Invalid agent data.");
    return records;
  } catch (error) {
    console.error("Could not read delivery agents:", error.message);
    throw new Error("Delivery-agent storage is unavailable.");
  }
}
function saveAgentRecords(records) {
  const temporaryFile = AGENTS_FILE + ".tmp";
  fs.writeFileSync(temporaryFile, JSON.stringify(records, null, 2), "utf8");
  fs.renameSync(temporaryFile, AGENTS_FILE);
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
  try {
    if (!fs.existsSync(DATA_FILE)) return [];

    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(data)) throw new Error("Invalid order data.");
    return data;
  } catch (error) {
    console.error("Could not read orders:", error.message);
    throw new Error("Order storage is unavailable.");
  }
}

function saveOrders(orders) {
  const temporaryFile = `${DATA_FILE}.tmp`;

  fs.writeFileSync(temporaryFile, JSON.stringify(orders, null, 2), "utf8");
  fs.renameSync(temporaryFile, DATA_FILE);
}

function safeAccount(account) {
  return {
    username: account.username,
    role: account.role,
    name: account.name,
    restaurantId: account.restaurantId || null,
    agentId: account.agentId || null
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
  return { ...order };
}


// Student accounts. Students are stored separately from staff accounts.
// Configure Twilio Verify in Render to enable real phone verification.
const STUDENTS_FILE = path.join(__dirname, "students.json");

function readStudents() {
  try {
    if (!fs.existsSync(STUDENTS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(STUDENTS_FILE, "utf8"));
    if (!Array.isArray(data)) throw new Error("Invalid student data.");
    return data;
  } catch (error) {
    console.error("Could not read student data:", error.message);
    throw new Error("Student storage is unavailable.");
  }
}

function saveStudents(students) {
  const temp = STUDENTS_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(students, null, 2), "utf8");
  fs.renameSync(temp, STUDENTS_FILE);
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
  const phone = String(req.body.phone || "").trim();
  const password = String(req.body.password || "");
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Enter your name (2–100 characters)." });
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return res.status(400).json({ error: "Enter your phone in international format, e.g. +2348012345678." });
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
  const phone = String(req.body.phone || "").trim();
  const password = String(req.body.password || "");
  if (!phone || !password) return res.status(400).json({ error: "Enter your phone number and password." });

  try {
    const student = readStudents().find(item => item.phone === phone);
    if (!student || !passwordMatches(password, student)) {
      return res.status(401).json({ error: "Incorrect phone number or password." });
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

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "Chowoncampus" });
});

// Public menu
app.get("/api/menu", (req, res) => {
  res.json({ restaurants });
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

  const account = accounts.find(a =>
    a.username === username &&
    (a.passwordHash
      ? passwordMatches(password, a)
      : a.password === password)
  );

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
  const { hostel, restaurantId, items } = req.body;
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

    if (!menuItem || !Number.isInteger(qty) || qty < 1 || qty > 20) {
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
    hostel: hostel.trim(),
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
    agentEarningsRecorded: false,
    createdAt: new Date().toISOString()
  };

  try {
    const orders = readOrders();
    orders.unshift(order);
    saveOrders(orders);

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
      itemCount: restaurant.items.length
    }))
  });
});

app.post("/api/admin/restaurants", requireRole("admin"), (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const firstItemName = String(req.body.firstItemName || "").trim();
  const firstItemPrice = Number(req.body.firstItemPrice);

  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Restaurant name must be 2–100 characters." });
  if (description.length > 240) return res.status(400).json({ error: "Description must be 240 characters or fewer." });
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
      restaurant: { id, name, description: restaurant.description, username, itemCount: restaurant.items.length },
      message: "Restaurant created. Save the login details securely and share the password with the partner."
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not create restaurant." });
  }
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
      createdAt: student.createdAt || null
    }));
    res.json({ students });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load students." });
  }
});

// Admin-only agent list
app.get("/api/agents", requireRole("admin"), (req, res) => {
  res.json({ agents });
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

    if (order.status !== newStatus) {
      const changedAt = new Date().toISOString();
      order.status = newStatus;
      order.updatedAt = changedAt;
      order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [{ status: order.status, at: order.createdAt, by: "system" }];
      order.statusHistory.push({ status: newStatus, at: changedAt, by: req.account.role });
    }

    // Record agent earnings only once when the order is completed.
    if (newStatus === "Completed" && !order.agentEarningsRecorded) {
      order.agentEarningsRecorded = true;
      order.agentEarnings = 100;
      order.completedAt = new Date().toISOString();
    }

    saveOrders(orders);
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
