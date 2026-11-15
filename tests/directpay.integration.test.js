const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
let dir, child, base, studentCookie, restaurantCookie, businessCookie, adminCookie;

function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, 64).toString("hex") };
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function login(route, body) {
  const response = await fetch(base + route, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  assert.equal(response.status, 200, await response.text());
  return response.headers.get("set-cookie").split(";")[0];
}
async function api(cookie, route, options = {}) {
  const response = await fetch(base + route, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}
async function createOrder(cookie, merchant, requestId) {
  return api(cookie, "/api/orders", {
    method: "POST",
    body: JSON.stringify({
      hostel: "Hall 2, Redeemer's University",
      latitude: 7.67998, longitude: 4.45982,
      ...(merchant.type === "business" ? { businessId: merchant.id } : { restaurantId: merchant.id }),
      items: [{ id: merchant.itemId, qty: 1 }],
      requestId, paymentMethod: "bank_transfer"
    })
  });
}
async function submitReceipt(orderId, reference, cookie = studentCookie) {
  return api(cookie, "/api/orders/" + encodeURIComponent(orderId) + "/bank-transfer/submit", {
    method: "POST",
    body: JSON.stringify({
      transactionReference: reference, mimeType: "image/jpeg", fileName: "receipt.jpg",
      receiptDataBase64: Buffer.from("test receipt image bytes").toString("base64")
    })
  });
}
function nigeriaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-directpay-"));
  fs.copyFileSync(path.join(root, "server.js"), path.join(dir, "server.js"));
  const studentPassword = "Student-DirectPay-Password";
  const merchantPassword = "Merchant-DirectPay-Password";
  const adminPassword = "Ultimate-DirectPay-Password";
  fs.writeFileSync(path.join(dir, "students.json"), JSON.stringify([{
    phone: "+2348012345678", name: "DirectPay Student", ...passwordRecord(studentPassword)
  }]));
  fs.writeFileSync(path.join(dir, "vendor-verifications.json"), JSON.stringify([{
    restaurantId: "CB", restaurantName: "Campus Bites", status: "approved",
    identityStatus: "verified", businessStatus: "verified", settlementStatus: "verified"
  }]));
  fs.writeFileSync(path.join(dir, "restaurant-operations.json"), JSON.stringify({
    CB: { online: true, ordersPaused: false }
  }));
  fs.writeFileSync(path.join(dir, "delivery-area-config.json"), JSON.stringify({
    enabled: true, centerLatitude: 7.5, centerLongitude: 4.5, radiusMeters: 5000
  }));
  fs.writeFileSync(path.join(dir, "other-businesses.json"), JSON.stringify([{
    id: "BOOKS1", name: "Campus Bookshop", category: "bookshop", description: "Test shop",
    location: "Redeemer's University", status: "approved", online: true, paused: false,
    username: "campusbookshop", ...passwordRecord(merchantPassword),
    products: [{ id: "book1", name: "Notebook", price: 1000, category: "Stationery", available: true }]
  }]));
  const port = await freePort();
  base = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, [path.join(dir, "server.js")], {
    cwd: dir, stdio: "ignore",
    env: {
      ...process.env, DATABASE_URL: "", NODE_PATH: path.join(root, "node_modules"), PORT: String(port),
      ADMIN_USERNAME: "testadmin", ADMIN_PASSWORD: adminPassword,
      SUPERADMIN_USERNAME: "testsuperadmin", SUPERADMIN_PASSWORD: adminPassword,
      CAMPUSBITES_PASSWORD: merchantPassword, MAMASKITCHEN_PASSWORD: merchantPassword,
      VENDOR_DOCS_ENCRYPTION_KEY: "directpay-integration-test-only-key"
    }
  });
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + "/api/me");
      if (response.status === 200) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.equal(ready, true, "server should start for DirectPay integration tests");
  studentCookie = await login("/api/student/login", { phone: "08012345678", password: studentPassword });
  restaurantCookie = await login("/api/login", { username: "campusbites", password: merchantPassword });
  businessCookie = await login("/api/login", { username: "campusbookshop", password: merchantPassword });
  adminCookie = await login("/api/login", { username: "testsuperadmin", password: adminPassword });
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("DirectPay merchant onboarding, receipts, verification and reconciliation", async t => {
  let restaurantOrder1, restaurantOrder2, businessOrder;
  await t.test("merchant bank details remain pending until Ultimate Admin approval", async () => {
    const saved = await api(restaurantCookie, "/api/merchant/payment-settings", {
      method: "PUT", body: JSON.stringify({
        bankName: "Test Bank", accountName: "Campus Bites Ltd", accountNumber: "0123456789",
        whatsappNumber: "08012345678"
      })
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.data.settings.bankAccountStatus, "pending");
    assert.equal(saved.data.settings.accountNumber, "0123456789");

    const blocked = await createOrder(studentCookie, { type: "restaurant", id: "CB", itemId: "cb1" }, "directpay-blocked");
    assert.equal(blocked.response.status, 409);

    const adminAccounts = await api(adminCookie, "/api/superadmin/merchant-payment-accounts");
    assert.equal(adminAccounts.response.status, 200);
    const account = adminAccounts.data.accounts.find(item => item.id === "CB");
    assert.equal(account.accountNumber, "0123456789");
    const approved = await api(adminCookie, "/api/superadmin/merchant-payment-accounts/restaurant/CB/review", {
      method: "POST", body: JSON.stringify({ decision: "approved" })
    });
    assert.equal(approved.response.status, 200);
    const reviewedAccounts = await api(adminCookie, "/api/superadmin/merchant-payment-accounts");
    const reviewed = reviewedAccounts.data.accounts.find(item => item.id === "CB");
    assert.deepEqual(reviewed.reviewHistory.map(item => item.action), ["submitted", "approved"]);
    assert.ok(reviewed.reviewHistory.every(item => item.at && item.by));
  });

  await t.test("student receives approved account details and the exact fee breakdown", async () => {
    const created = await createOrder(studentCookie, { type: "restaurant", id: "CB", itemId: "cb1" }, "directpay-restaurant-1");
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    restaurantOrder1 = created.data.order;
    assert.equal(restaurantOrder1.paymentBankAccount.bankName, "Test Bank");
    assert.equal(restaurantOrder1.merchantWhatsAppNumber, "+2348012345678");
    assert.equal(restaurantOrder1.deliveryFee, 300);
    assert.equal(restaurantOrder1.paymentFee, 25);
    assert.equal(restaurantOrder1.takeawayFee, 200);
    assert.equal(restaurantOrder1.total, 3025);
    assert.equal(restaurantOrder1.paymentStatus, "Bank transfer — awaiting receipt");
  });

  await t.test("receipt submission is private and references cannot be reused", async () => {
    const submitted = await submitReceipt(restaurantOrder1.id, "BANK-REF-0001");
    assert.equal(submitted.response.status, 200, JSON.stringify(submitted.data));
    assert.equal(submitted.data.order.paymentStatus, "Bank transfer — awaiting restaurant verification");

    const studentView = await api(studentCookie, "/api/orders/" + encodeURIComponent(restaurantOrder1.id));
    assert.equal(studentView.response.status, 200);
    assert.equal("paymentReceiptDataUrl" in studentView.data.order, false);
    assert.equal("transactionReference" in studentView.data.order, false);

    const restaurantView = await api(restaurantCookie, "/api/orders/" + encodeURIComponent(restaurantOrder1.id));
    assert.equal(restaurantView.response.status, 200);
    assert.match(restaurantView.data.order.paymentReceiptDataUrl, /^data:image\/jpeg;base64,/);

    const ordinaryAdmin = await login("/api/login", { username: "testadmin", password: "Ultimate-DirectPay-Password" });
    const restrictedView = await api(ordinaryAdmin, "/api/orders/" + encodeURIComponent(restaurantOrder1.id));
    assert.equal("paymentReceiptDataUrl" in restrictedView.data.order, false);
    assert.equal("transactionReference" in restrictedView.data.order, false);

    const duplicateOrder = await createOrder(studentCookie, { type: "restaurant", id: "CB", itemId: "cb1" }, "directpay-restaurant-2");
    assert.equal(duplicateOrder.response.status, 201);
    restaurantOrder2 = duplicateOrder.data.order;
    const duplicateReference = await submitReceipt(restaurantOrder2.id, "BANK-REF-0001");
    assert.equal(duplicateReference.response.status, 409);
  });

  await t.test("only the owning merchant can verify; a merchant decision is timestamped", async () => {
    const wrongMerchant = await api(businessCookie, "/api/orders/" + encodeURIComponent(restaurantOrder1.id) + "/bank-transfer/verify", {
      method: "POST", body: JSON.stringify({ decision: "received" })
    });
    assert.equal(wrongMerchant.response.status, 403);

    const confirmed = await api(restaurantCookie, "/api/orders/" + encodeURIComponent(restaurantOrder1.id) + "/bank-transfer/verify", {
      method: "POST", body: JSON.stringify({ decision: "received" })
    });
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.order.paymentStatus, "Paid — bank transfer verified");
    assert.ok(confirmed.data.order.paymentVerification.verifiedAt);
    assert.equal(confirmed.data.order.paymentVerification.verifiedBy, "campusbites");
  });

  await t.test("other businesses can submit bank details and accept direct transfers", async () => {
    const saved = await api(businessCookie, "/api/merchant/payment-settings", {
      method: "PUT", body: JSON.stringify({
        bankName: "Shop Bank", accountName: "Campus Bookshop", accountNumber: "9876543210",
        whatsappNumber: "+2348098765432"
      })
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.data.settings.bankAccountStatus, "pending");
    const approved = await api(adminCookie, "/api/superadmin/merchant-payment-accounts/business/BOOKS1/review", {
      method: "POST", body: JSON.stringify({ decision: "approved" })
    });
    assert.equal(approved.response.status, 200);

    const created = await createOrder(studentCookie, { type: "business", id: "BOOKS1", itemId: "book1" }, "directpay-business-1");
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    businessOrder = created.data.order;
    assert.equal(businessOrder.paymentBankAccount.bankName, "Shop Bank");
    assert.equal(businessOrder.deliveryFee, 300);
    assert.equal(businessOrder.paymentFee, 10);
    assert.equal(businessOrder.total, 1310);

    const receipt = await submitReceipt(businessOrder.id, "SHOP-REF-0001");
    assert.equal(receipt.response.status, 200);
    const verified = await api(businessCookie, "/api/orders/" + encodeURIComponent(businessOrder.id) + "/bank-transfer/verify", {
      method: "POST", body: JSON.stringify({ decision: "received" })
    });
    assert.equal(verified.response.status, 200, JSON.stringify(verified.data));
    assert.equal(verified.data.order.paymentStatus, "Paid — bank transfer verified");
    const preparing = await api(businessCookie, "/api/orders/" + encodeURIComponent(businessOrder.id) + "/status", {
      method: "PATCH", body: JSON.stringify({ status: "Preparing" })
    });
    assert.equal(preparing.response.status, 200, JSON.stringify(preparing.data));
  });

  await t.test("Ultimate Admin can override a merchant rejection with a reason", async () => {
    const receipt = await submitReceipt(restaurantOrder2.id, "BANK-REF-0002");
    assert.equal(receipt.response.status, 200);
    const rejected = await api(restaurantCookie, "/api/orders/" + encodeURIComponent(restaurantOrder2.id) + "/bank-transfer/verify", {
      method: "POST", body: JSON.stringify({ decision: "not_received", reason: "No matching bank credit found." })
    });
    assert.equal(rejected.response.status, 200);
    assert.equal(rejected.data.order.paymentStatus, "Bank transfer rejected — no bank credit");

    const overridden = await api(adminCookie, "/api/superadmin/orders/" + encodeURIComponent(restaurantOrder2.id) + "/bank-transfer/override", {
      method: "POST", body: JSON.stringify({ decision: "received", reason: "Dispute reviewed against the bank statement." })
    });
    assert.equal(overridden.response.status, 200);
    const history = await api(restaurantCookie, "/api/orders/" + encodeURIComponent(restaurantOrder2.id));
    assert.equal(history.data.order.paymentStatus, "Paid — bank transfer verified");
    assert.equal(history.data.order.paymentVerification.overridden, true);
    assert.equal(history.data.order.paymentVerification.verifiedRole, "ultimate_admin");
    assert.deepEqual(history.data.order.paymentVerification.history.map(item => item.action), ["receipt_submitted", "not_received", "admin_override_received"]);
    assert.ok(history.data.order.paymentVerification.history.every(item => item.at && item.by));
  });

  await t.test("daily fee records reconcile delivery plus 1% service fees without duplicate references", async () => {
    const date = nigeriaDate();
    const report = await api(adminCookie, "/api/superadmin/daily-report?date=" + date);
    assert.equal(report.response.status, 200, JSON.stringify(report.data));
    assert.equal(report.data.orders.paidAndDelivered, 0);
    assert.equal(report.data.orders.paidButCancelled, 0);
    const restaurant = report.data.restaurants.find(item => item.id === "CB");
    const business = report.data.businesses.find(item => item.id === "BOOKS1");
    assert.equal(restaurant.platformFeesDueToday, 650);
    assert.equal(business.platformFeesDueToday, 310);
    assert.equal(report.data.merchantFeeCollection.dueToday, 960);

    const restaurantPayment = await api(adminCookie, "/api/superadmin/merchant-fee-payments", {
      method: "POST", body: JSON.stringify({
        merchantType: "restaurant", merchantId: "CB", paymentDate: date,
        amount: 650, reference: "COC-REMIT-001", note: "Daily platform fee remittance"
      })
    });
    assert.equal(restaurantPayment.response.status, 201, JSON.stringify(restaurantPayment.data));
    const duplicate = await api(adminCookie, "/api/superadmin/merchant-fee-payments", {
      method: "POST", body: JSON.stringify({
        merchantType: "business", merchantId: "BOOKS1", paymentDate: date,
        amount: 1, reference: "COC-REMIT-001"
      })
    });
    assert.equal(duplicate.response.status, 409);

    const businessPayment = await api(adminCookie, "/api/superadmin/merchant-fee-payments", {
      method: "POST", body: JSON.stringify({
        merchantType: "business", merchantId: "BOOKS1", paymentDate: date,
        amount: 310, reference: "COC-REMIT-002"
      })
    });
    assert.equal(businessPayment.response.status, 201, JSON.stringify(businessPayment.data));
    const finalReport = await api(adminCookie, "/api/superadmin/daily-report?date=" + date);
    assert.equal(finalReport.data.merchantFeeCollection.collectedToday, 960);
    assert.equal(finalReport.data.merchantFeeCollection.outstanding, 0);
    const ledger = await api(adminCookie, "/api/superadmin/merchant-fee-payments");
    assert.equal(ledger.response.status, 200);
    assert.equal(ledger.data.integrity.valid, true);
    assert.equal(ledger.data.integrity.checkedRecords, 2);
    const overpayment = await api(adminCookie, "/api/superadmin/merchant-fee-payments", {
      method: "POST", body: JSON.stringify({
        merchantType: "restaurant", merchantId: "CB", paymentDate: date,
        amount: 1, reference: "COC-REMIT-003"
      })
    });
    assert.equal(overpayment.response.status, 409);
  });
});
