const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
let dir;
let child;
let base;
let restaurantCookie;
let adminCookie;
let studentCookie;

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function login(username, password) {
  const response = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

async function api(cookie, route, options = {}) {
  return fetch(base + route, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(options.headers || {})
    }
  });
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-restaurant-operations-"));
  fs.copyFileSync(path.join(root, "server.js"), path.join(dir, "server.js"));
  fs.writeFileSync(path.join(dir, "vendor-verifications.json"), JSON.stringify([{
    restaurantId: "CB",
    restaurantName: "Campus Bites",
    status: "approved",
    identityStatus: "verified",
    businessStatus: "verified",
    settlementStatus: "verified",
    documents: []
  }]));
  fs.writeFileSync(path.join(dir, "restaurant-operations.json"), "{}");
  const port = await freePort();
  base = "http://127.0.0.1:" + port;
  const password = "Test-Password-12345";
  child = spawn(process.execPath, [path.join(dir, "server.js")], {
    cwd: dir,
    stdio: "ignore",
    env: {
      ...process.env,
      DATABASE_URL: "",
      NODE_PATH: path.join(root, "node_modules"),
      PORT: String(port),
      ADMIN_USERNAME: "testadmin",
      ADMIN_PASSWORD: password,
      SUPERADMIN_USERNAME: "testsuper",
      SUPERADMIN_PASSWORD: password,
      CAMPUSBITES_PASSWORD: password,
      MAMASKITCHEN_PASSWORD: password,
      VENDOR_DOCS_ENCRYPTION_KEY: "test-only-encryption-secret-that-is-long-and-random"
    }
  });
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + "/api/me");
      if (response.status === 200 || response.status === 401) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.equal(ready, true, "server should start for restaurant operations tests");
  restaurantCookie = await login("campusbites", password);
  adminCookie = await login("testadmin", password);
  const studentResponse = await api(null, "/api/student/register", {
    method: "POST",
    body: JSON.stringify({ name: "Test Student", phone: "08012345678", password, consents: { terms: true, privacy: true, delivery: true } })
  });
  assert.equal(studentResponse.status, 201);
  studentCookie = studentResponse.headers.get("set-cookie").split(";")[0];
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("restaurant online, offline, pause and item availability are enforced", async t => {
  await t.test("restaurant controls are private and default safely to offline", async () => {
    assert.equal((await api(null, "/api/restaurant/operations")).status, 401);
    assert.equal((await api(adminCookie, "/api/restaurant/operations")).status, 403);
    const response = await api(restaurantCookie, "/api/restaurant/operations");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.operations.online, false);
    assert.equal(data.operations.ordersPaused, false);
    const menu = await (await fetch(base + "/api/menu")).json();
    const restaurant = menu.restaurants.find(item => item.id === "CB");
    assert.ok(restaurant);
    assert.equal(restaurant.online, false);
    assert.equal(restaurant.ordersPaused, false);
  });

  await t.test("offline restaurants cannot receive quotes or accept orders", async () => {
    const response = await api(null, "/api/delivery/quote", {
      method: "POST",
      body: JSON.stringify({ restaurantId: "CB", latitude: 7.68, longitude: 4.46 })
    });
    assert.equal(response.status, 409);
    const orderResponse = await api(studentCookie, "/api/orders", {
      method: "POST",
      body: JSON.stringify({ hostel: "Test hostel", latitude: 7.67998, longitude: 4.45982, restaurantId: "CB", items: [{ id: "cb1", qty: 1 }], requestId: "offline-order-test" })
    });
    assert.equal(orderResponse.status, 409);
  });

  await t.test("restaurant can go online and students can see that status", async () => {
    const response = await api(restaurantCookie, "/api/restaurant/operations", {
      method: "PATCH",
      body: JSON.stringify({ online: true })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.operations.online, true);
    assert.equal(result.acceptingOrders, true);
    const menu = await (await fetch(base + "/api/menu")).json();
    assert.equal(menu.restaurants.find(item => item.id === "CB").online, true);
    const quote = await api(null, "/api/delivery/quote", {
      method: "POST",
      body: JSON.stringify({ restaurantId: "CB", latitude: 7.68, longitude: 4.46 })
    });
    assert.equal(quote.status, 200);
  });

  await t.test("restaurant can pause and resume incoming orders", async () => {
    const pause = await api(restaurantCookie, "/api/restaurant/operations", {
      method: "PATCH",
      body: JSON.stringify({ ordersPaused: true, pauseReason: "high-demand" })
    });
    assert.equal(pause.status, 200);
    const paused = await pause.json();
    assert.equal(paused.operations.ordersPaused, true);
    assert.equal(paused.acceptingOrders, false);
    assert.equal((await api(null, "/api/delivery/quote", {
      method: "POST",
      body: JSON.stringify({ restaurantId: "CB", latitude: 7.68, longitude: 4.46 })
    })).status, 409);
    const resume = await api(restaurantCookie, "/api/restaurant/operations", {
      method: "PATCH",
      body: JSON.stringify({ ordersPaused: false })
    });
    assert.equal(resume.status, 200);
    assert.equal((await resume.json()).acceptingOrders, true);
  });

  await t.test("restaurant cannot pause while offline and offline resets pause state", async () => {
    assert.equal((await api(restaurantCookie, "/api/restaurant/operations", {
      method: "PATCH",
      body: JSON.stringify({ online: false })
    })).status, 200);
    assert.equal((await api(restaurantCookie, "/api/restaurant/operations", {
      method: "PATCH",
      body: JSON.stringify({ ordersPaused: true, pauseReason: "stock-check" })
    })).status, 409);
    const result = await (await api(restaurantCookie, "/api/restaurant/operations")).json();
    assert.equal(result.operations.online, false);
    assert.equal(result.operations.ordersPaused, false);
  });

  await t.test("individual food availability is saved and reflected in the public menu", async () => {
    await api(restaurantCookie, "/api/restaurant/operations", {
      method: "PATCH",
      body: JSON.stringify({ online: true })
    });
    const menu = await (await fetch(base + "/api/menu")).json();
    const restaurant = menu.restaurants.find(item => item.id === "CB");
    const items = restaurant.items.map((item, index) => ({
      ...item,
      available: index === 0 ? false : item.available !== false
    }));
    const saved = await api(restaurantCookie, "/api/restaurant/menu", {
      method: "PUT",
      body: JSON.stringify({ items })
    });
    assert.equal(saved.status, 200);
    const updated = await (await fetch(base + "/api/menu")).json();
    assert.equal(updated.restaurants.find(item => item.id === "CB").items[0].available, false);
  });

  await t.test("availability settings persist to the configured storage file", async () => {
    const records = JSON.parse(fs.readFileSync(path.join(dir, "restaurant-operations.json"), "utf8"));
    assert.equal(records.CB.online, true);
    assert.ok(records.CB.updatedAt);
  });
});
