const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
let dir, child, base, a, b, agent, otherAgent, admin, restaurant;

function hash(p) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { passwordSalt: salt, passwordHash: crypto.scryptSync(p, salt, 64).toString("hex") };
}
function order(id, extra = {}) {
  return { id, customerName: "Student A", customerPhone: "+2348012345678", restaurantId: "CB",
    restaurantName: "Campus Bites", assignedAgentId: "AG1", status: "Out for delivery",
    paymentStatus: "Paid — Paystack verified", deliveryCode: "A7K2", deliveryCodeAttempts: 0,
    deliveryCodeLocked: false, createdAt: new Date().toISOString(), items: [], ...extra };
}
async function getPort() {
  const s = net.createServer();
  await new Promise(r => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}
async function login(route, data) {
  const r = await fetch(base + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
async function call(cookie, id, code) {
  return fetch(base + "/api/orders/" + id + "/status", {
    method: "PATCH", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ status: "Completed", ...(code === undefined ? {} : { deliveryCode: code }) })
  });
}
async function view(cookie, id) {
  return fetch(base + "/api/orders/" + id, { headers: cookie ? { cookie } : {} });
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-handover-"));
  fs.copyFileSync(path.join(root, "server.js"), path.join(dir, "server.js"));
  const sp = "Student-Testing-Password";
  const ap = "Agent-Testing-Password";
  const dp = "Admin-Testing-Password";
  fs.writeFileSync(path.join(dir, "students.json"), JSON.stringify([
    { phone: "+2348012345678", name: "Student A", ...hash(sp) },
    { phone: "+2348098765432", name: "Student B", ...hash(sp) }
  ]));
  fs.writeFileSync(path.join(dir, "delivery-agents.json"), JSON.stringify([
    { id: "AG1", name: "Agent One", username: "agentone", online: true, ...hash(ap) },
    { id: "AG2", name: "Agent Two", username: "agenttwo", online: true, ...hash(ap) }
  ]));
  fs.writeFileSync(path.join(dir, "orders.json"), JSON.stringify([
    order("CORRECT"), order("WRONG", { deliveryCode: "W9Q4" }),
    order("LOCK", { deliveryCode: "L8M3" }),
    order("OTHER", { assignedAgentId: "AG2", deliveryCode: "P6R2" }),
    order("ADMIN", { deliveryCode: "D5F8" }),
    order("LEGACY", { deliveryCode: undefined }),
    order("STUDENT-B", { customerName: "Student B", customerPhone: "+2348098765432", deliveryCode: "B4N7" }),
    order("RATING-SPLIT", {
      customerName: "Adetola", status: "Completed", deliveredAt: new Date().toISOString(),
      items: [{ id: "cb1", name: "Jollof Rice", price: 2500 }]
    })
  ]));
  const p = await getPort();
  base = "http://127.0.0.1:" + p;
  child = spawn(process.execPath, [path.join(dir, "server.js")], { cwd: dir, stdio: "ignore",
    env: { ...process.env, NODE_PATH: path.join(root, "node_modules"), PORT: String(p),
      ADMIN_USERNAME: "testadmin", ADMIN_PASSWORD: dp, SUPERADMIN_USERNAME: "testsuper", SUPERADMIN_PASSWORD: dp,
      CAMPUSBITES_PASSWORD: dp, MAMASKITCHEN_PASSWORD: dp } });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(base + "/api/me")).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  a = await login("/api/student/login", { phone: "08012345678", password: sp });
  b = await login("/api/student/login", { phone: "08098765432", password: sp });
  agent = await login("/api/login", { username: "agentone", password: ap });
  otherAgent = await login("/api/login", { username: "agenttwo", password: ap });
  admin = await login("/api/login", { username: "testadmin", password: dp });
  restaurant = await login("/api/login", { username: "campusbites", password: dp });
  restaurant = await login("/api/login", { username: "campusbites", password: dp });
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(r => child.once("exit", r));
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("rating comments are visible only to their intended recipients", async t => {
  await t.test("Adetola can submit separate restaurant and delivery comments", async () => {
    const response = await fetch(base + "/api/orders/RATING-SPLIT/rating", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: a },
      body: JSON.stringify({
        restaurantRating: 5,
        agentRating: 4,
        foodRatings: [{ itemId: "cb1", rating: 5 }],
        restaurantComment: "Campus Bites: the jollof rice was excellent.",
        agentComment: "The delivery was prompt and courteous."
      })
    });
    assert.equal(response.status, 201);
  });

  await t.test("Campus Bites sees restaurant/food comment but not delivery comment", async () => {
    const data = await (await fetch(base + "/api/ratings/summary", { headers: { cookie: restaurant } })).json();
    const review = data.reviews.find(item => item.orderId === "RATING-SPLIT");
    assert.ok(review);
    assert.equal(review.restaurantComment, "Campus Bites: the jollof rice was excellent.");
    assert.equal("agentComment" in review, false);
    assert.equal("legacyComment" in review, false);
  });

  await t.test("assigned agent sees delivery comment but not restaurant comment", async () => {
    const data = await (await fetch(base + "/api/ratings/summary", { headers: { cookie: agent } })).json();
    const review = data.reviews.find(item => item.orderId === "RATING-SPLIT");
    assert.ok(review);
    assert.equal(review.agentComment, "The delivery was prompt and courteous.");
    assert.equal("restaurantComment" in review, false);
    assert.equal("legacyComment" in review, false);
  });

  await t.test("admin sees both comments", async () => {
    const data = await (await fetch(base + "/api/ratings/summary", { headers: { cookie: admin } })).json();
    const review = data.reviews.find(item => item.orderId === "RATING-SPLIT");
    assert.ok(review);
    assert.equal(review.restaurantComment, "Campus Bites: the jollof rice was excellent.");
    assert.equal(review.agentComment, "The delivery was prompt and courteous.");
  });
});

test("handover verification end-to-end", async t => {
  await t.test("student code visibility is restricted to the owning student", async () => {
    assert.equal((await (await view(a, "CORRECT")).json()).order.deliveryCode, "A7K2");
    assert.equal("deliveryCode" in (await (await view(a, "STUDENT-B")).json()).order, false);
    assert.equal((await (await view(b, "STUDENT-B")).json()).order.deliveryCode, "B4N7");
    for (const c of [agent, restaurant, admin, null]) {
      assert.equal("deliveryCode" in (await (await view(c, "CORRECT")).json()).order, false);
    }
  });
  await t.test("correct code succeeds once; used code is rejected", async () => {
    assert.equal((await call(agent, "CORRECT", "a7k2")).status, 200);
    assert.equal((await call(agent, "CORRECT", "A7K2")).status, 400);
  });
  await t.test("incorrect codes are rejected and attempt five locks the order", async () => {
    assert.equal((await call(agent, "WRONG", "XXXX")).status, 403);
    for (let i = 1; i <= 5; i++) assert.equal((await call(agent, "LOCK", "XXXX")).status, i === 5 ? 423 : 403);
    assert.equal((await call(agent, "LOCK", "L8M3")).status, 423);
  });
  await t.test("agent cannot complete another agent's order", async () => {
    assert.equal((await call(agent, "OTHER", "P6R2")).status, 403);
    assert.equal((await call(otherAgent, "OTHER", "P6R2")).status, 200);
  });
  await t.test("admin override does not require the code", async () => {
    assert.equal((await call(admin, "ADMIN")).status, 200);
  });
  await t.test("legacy order receives a code and can then be completed", async () => {
    assert.equal((await call(agent, "LEGACY", "ABCD")).status, 409);
    const code = (await (await view(a, "LEGACY")).json()).order.deliveryCode;
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}$/);
    assert.equal((await call(agent, "LEGACY", code)).status, 200);
  });
});
