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
let superAdminCookie;

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-vendor-verification-"));
  fs.copyFileSync(path.join(root, "server.js"), path.join(dir, "server.js"));
  const order = {
    id: "VENDOR-TEST-ORDER",
    restaurantId: "CB",
    restaurantName: "Campus Bites",
    customerName: "Test Student",
    customerPhone: "+2348012345678",
    status: "Confirmed",
    paymentStatus: "Paid — Paystack verified",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: []
  };
  fs.writeFileSync(path.join(dir, "orders.json"), JSON.stringify([order]));
  fs.writeFileSync(path.join(dir, "vendor-verifications.json"), "[]");
  const port = await freePort();
  base = "http://127.0.0.1:" + port;
  const password = "Test-Password-12345";
  child = spawn(process.execPath, [path.join(dir, "server.js")], {
    cwd: dir,
    stdio: "ignore",
    env: {
      ...process.env,
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
  assert.equal(ready, true, "server should start for vendor verification tests");
  restaurantCookie = await login("campusbites", password);
  adminCookie = await login("testadmin", password);
  superAdminCookie = await login("testsuper", password);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("restaurant verification onboarding is enforced end to end", async t => {
  await t.test("verification status is private to the restaurant and starts pending", async () => {
    assert.equal((await api(null, "/api/restaurant/vendor-verification")).status, 401);
    assert.equal((await api(adminCookie, "/api/restaurant/vendor-verification")).status, 403);
    const response = await api(restaurantCookie, "/api/restaurant/vendor-verification");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.vendor.status, "pending");
    assert.deepEqual(data.missingDocuments, ["identity", "business-proof", "settlement-proof"]);
  });

  await t.test("unapproved restaurant is hidden from the public student menu", async () => {
    const response = await fetch(base + "/api/menu");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.restaurants.some(item => item.id === "CB"), false);
  });

  await t.test("restaurant account cannot see or receive orders before approval", async () => {
    const response = await api(restaurantCookie, "/api/orders");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).orders, []);
  });

  await t.test("restaurant can securely upload the required document categories", async () => {
    const docs = [
      ["identity", "owner-id.pdf"],
      ["business-proof", "business-proof.pdf"],
      ["settlement-proof", "bank-proof.pdf"]
    ];
    for (const [type, filename] of docs) {
      const upload = await api(restaurantCookie, "/api/restaurant/vendor-verification/documents", {
        method: "POST",
        body: JSON.stringify({
          type,
          filename,
          mimeType: "application/pdf",
          dataBase64: Buffer.from("sample " + type + " document").toString("base64")
        })
      });
      assert.equal(upload.status, 201);
    }
    const stored = JSON.parse(fs.readFileSync(path.join(dir, "vendor-verifications.json"), "utf8"));
    assert.equal(stored[0].documents.length, 3);
    assert.ok(stored[0].documents.every(doc => doc.encrypted?.ciphertext && doc.encrypted?.iv && doc.encrypted?.tag));
    assert.ok(stored[0].documents.every(doc => !JSON.stringify(doc).includes(Buffer.from("sample").toString("base64"))));
    const status = await (await api(restaurantCookie, "/api/restaurant/vendor-verification")).json();
    assert.deepEqual(status.missingDocuments, []);
  });

  await t.test("individual document rejection is visible and replacement is required", async () => {
    let status = await (await api(restaurantCookie, "/api/restaurant/vendor-verification")).json();
    const identity = status.vendor.documents.find(doc => doc.type === "identity");
    const rejected = await api(superAdminCookie, "/api/superadmin/vendor-verifications/CB/documents/" + identity.id + "/review", {
      method: "PATCH",
      body: JSON.stringify({ reviewStatus: "rejected", rejectionReason: "The image is blurry. Upload a clear, readable identity document." })
    });
    assert.equal(rejected.status, 200);
    status = await (await api(restaurantCookie, "/api/restaurant/vendor-verification")).json();
    assert.equal(status.vendor.status, "pending", "a single rejected file must not silently change the overall application decision");
    const rejectedIdentity = status.vendor.documents.find(doc => doc.id === identity.id);
    assert.equal(rejectedIdentity.reviewStatus, "rejected");
    assert.equal(rejectedIdentity.rejectionReason, "The image is blurry. Upload a clear, readable identity document.");
    const blocked = await api(restaurantCookie, "/api/restaurant/vendor-verification/resubmit", { method: "POST", body: JSON.stringify({}) });
    assert.equal(blocked.status, 400, "resubmission must wait for a replacement");
    const replacement = await api(restaurantCookie, "/api/restaurant/vendor-verification/documents", {
      method: "POST",
      body: JSON.stringify({ type: "identity", filename: "clear-owner-id.png", mimeType: "image/png", dataBase64: Buffer.from("clear identity").toString("base64") })
    });
    assert.equal(replacement.status, 201);
    status = await (await api(restaurantCookie, "/api/restaurant/vendor-verification")).json();
    const oldIdentity = status.vendor.documents.find(doc => doc.id === identity.id);
    const newIdentity = status.vendor.documents.find(doc => doc.filename === "clear-owner-id.png");
    assert.ok(oldIdentity.supersededAt);
    assert.equal(newIdentity.reviewStatus, "pending");
    for (const doc of status.vendor.documents.filter(item => !item.supersededAt)) {
      const verified = await api(superAdminCookie, "/api/superadmin/vendor-verifications/CB/documents/" + doc.id + "/review", {
        method: "PATCH",
        body: JSON.stringify({ reviewStatus: "verified", rejectionReason: "" })
      });
      assert.equal(verified.status, 200);
    }
  });

  await t.test("restaurant must submit the complete application for admin review", async () => {
    const response = await api(restaurantCookie, "/api/restaurant/vendor-verification/resubmit", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).vendor.status, "pending");
  });

  await t.test("only Ultimate Admin can review and approve the vendor", async () => {
    const denied = await api(adminCookie, "/api/superadmin/vendor-verifications");
    assert.equal(denied.status, 403);
    const review = await api(superAdminCookie, "/api/superadmin/vendor-verifications/CB", {
      method: "PATCH",
      body: JSON.stringify({
        identityStatus: "verified",
        businessStatus: "verified",
        settlementStatus: "verified",
        decision: "approved",
        notes: "All documents checked."
      })
    });
    assert.equal(review.status, 200);
    const status = await (await api(restaurantCookie, "/api/restaurant/vendor-verification")).json();
    assert.equal(status.vendor.status, "approved");
    assert.equal(status.vendor.reviewer, "testsuper");
    assert.ok(status.vendor.approvalDate);
  });

  await t.test("approved restaurant can go online and offline through its dashboard endpoint", async () => {
    const initial = await api(restaurantCookie, "/api/restaurant/operations");
    assert.equal(initial.status, 200);
    const online = await api(restaurantCookie, "/api/restaurant/operations", {
      method: "PATCH",
      body: JSON.stringify({ online: true })
    });
    assert.equal(online.status, 200);
    const onlineData = await online.json();
    assert.equal(onlineData.operations.online, true);
    assert.equal(onlineData.acceptingOrders, true);
    const publicMenu = await (await fetch(base + "/api/menu")).json();
    assert.equal(publicMenu.restaurants.find(item => item.id === "CB").online, true);

    const offline = await api(restaurantCookie, "/api/restaurant/operations", {
      method: "PATCH",
      body: JSON.stringify({ online: false })
    });
    assert.equal(offline.status, 200);
    assert.equal((await offline.json()).operations.online, false);
  });

  await t.test("approved restaurant becomes visible on the public student menu", async () => {
    const response = await fetch(base + "/api/menu");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.restaurants.some(item => item.id === "CB"), true);
  });

  await t.test("repeated restaurant dashboard refreshes never alter or remove stored orders", async () => {
    const file = path.join(dir, "orders.json");
    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(before.length, 1);
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await api(restaurantCookie, "/api/orders");
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.orders.length, 1);
      assert.equal(data.orders[0].id, "VENDOR-TEST-ORDER");
    }
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(after, before, "dashboard refresh is read-only and must not change the order store");
  });

  await t.test("rejecting a document after approval pauses restaurant order access", async () => {
    let status = await (await api(restaurantCookie, "/api/restaurant/vendor-verification")).json();
    const settlement = status.vendor.documents.find(doc => doc.type === "settlement-proof" && !doc.supersededAt);
    const rejected = await api(superAdminCookie, "/api/superadmin/vendor-verifications/CB/documents/" + settlement.id + "/review", {
      method: "PATCH",
      body: JSON.stringify({ reviewStatus: "rejected", rejectionReason: "The account holder name does not match the restaurant owner." })
    });
    assert.equal(rejected.status, 200);
    status = await (await api(restaurantCookie, "/api/restaurant/vendor-verification")).json();
    assert.equal(status.vendor.status, "pending");
    assert.equal(status.vendor.approvalDate, null);
    assert.equal(status.vendor.documents.find(doc => doc.id === settlement.id).rejectionReason, "The account holder name does not match the restaurant owner.");
    const menu = await (await fetch(base + "/api/menu")).json();
    assert.equal(menu.restaurants.some(item => item.id === "CB"), false);
    const availabilityReadBlocked = await api(restaurantCookie, "/api/restaurant/operations");
    assert.equal(availabilityReadBlocked.status, 403, "a rejected required document must not load online controls");
    const availabilityBlocked = await api(restaurantCookie, "/api/restaurant/operations", {
      method: "PATCH",
      body: JSON.stringify({ online: true })
    });
    assert.equal(availabilityBlocked.status, 403, "a rejected required document must block going online");
    const restoreReview = await api(superAdminCookie, "/api/superadmin/vendor-verifications/CB/documents/" + settlement.id + "/review", {
      method: "PATCH",
      body: JSON.stringify({ reviewStatus: "verified", rejectionReason: "" })
    });
    assert.equal(restoreReview.status, 200);
  });

  await t.test("rejected restaurant sees reviewer feedback and can resubmit corrected documents", async () => {
    const reject = await api(superAdminCookie, "/api/superadmin/vendor-verifications/CB", {
      method: "PATCH",
      body: JSON.stringify({
        identityStatus: "rejected",
        businessStatus: "verified",
        settlementStatus: "verified",
        decision: "rejected",
        notes: "Please upload a clearer owner identity document."
      })
    });
    assert.equal(reject.status, 200);
    const status = await (await api(restaurantCookie, "/api/restaurant/vendor-verification")).json();
    assert.equal(status.vendor.status, "rejected");
    assert.equal(status.vendor.notes, "Please upload a clearer owner identity document.");
    const upload = await api(restaurantCookie, "/api/restaurant/vendor-verification/documents", {
      method: "POST",
      body: JSON.stringify({
        type: "identity",
        filename: "corrected-owner-id.png",
        mimeType: "image/png",
        dataBase64: Buffer.from("corrected identity document").toString("base64")
      })
    });
    assert.equal(upload.status, 201);
    const resubmit = await api(restaurantCookie, "/api/restaurant/vendor-verification/resubmit", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert.equal(resubmit.status, 200);
    const refreshed = await (await api(restaurantCookie, "/api/restaurant/vendor-verification")).json();
    assert.equal(refreshed.vendor.status, "pending");
    assert.equal(refreshed.vendor.notes, "Please upload a clearer owner identity document.");
  });
});
