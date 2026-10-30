const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
let dir, child, base, adminCookie, superCookie;

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function login(username, password) {
  const response = await fetch(base + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-operations-records-"));
  fs.copyFileSync(path.join(root, "server.js"), path.join(dir, "server.js"));
  fs.writeFileSync(path.join(dir, "operations-cases.json"), "[]");
  fs.writeFileSync(path.join(dir, "operations-events.json"), "[]");
  const port = await freePort();
  base = "http://127.0.0.1:" + port;
  const password = "Test-Password-12345";
  child = spawn(process.execPath, [path.join(dir, "server.js")], {
    cwd: dir, stdio: "ignore",
    env: {
      ...process.env, DATABASE_URL: "", NODE_PATH: path.join(root, "node_modules"),
      PORT: String(port), ADMIN_USERNAME: "testadmin", ADMIN_PASSWORD: password,
      SUPERADMIN_USERNAME: "testsuper", SUPERADMIN_PASSWORD: password,
      CAMPUSBITES_PASSWORD: password, MAMASKITCHEN_PASSWORD: password
    }
  });
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    try { const response = await fetch(base + "/api/me"); if ([200,401].includes(response.status)) { ready = true; break; } }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.equal(ready, true, "server should start for operations archive tests");
  adminCookie = await login("testadmin", password);
  superCookie = await login("testsuper", password);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("operations archive and case decisions are Ultimate Admin-only and auditable", async t => {
  await t.test("ordinary admin cannot access the private archive", async () => {
    assert.equal((await api(null, "/api/superadmin/operations-records")).status, 401);
    assert.equal((await api(adminCookie, "/api/superadmin/operations-records")).status, 403);
  });

  await t.test("Ultimate Admin can load archived records", async () => {
    const response = await api(superCookie, "/api/superadmin/operations-records");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(Array.isArray(data.orders));
    assert.ok(Array.isArray(data.cases));
    assert.ok(Array.isArray(data.events));
    assert.ok(Array.isArray(data.restaurants));
    assert.ok(Array.isArray(data.agents));
    assert.ok(Array.isArray(data.students));
  });

  await t.test("refund requests must link to an existing order", async () => {
    const response = await api(superCookie, "/api/superadmin/operations-cases", {
      method: "POST",
      body: JSON.stringify({ type: "refund", subjectRole: "student", reason: "Student requested a refund", decision: "pending" })
    });
    assert.equal(response.status, 400);
  });

  await t.test("Ultimate Admin can create a penalty record and preserve decision history", async () => {
    const created = await api(superCookie, "/api/superadmin/operations-cases", {
      method: "POST",
      body: JSON.stringify({
        type: "fine", subjectRole: "restaurant", subjectName: "Campus Bites",
        subjectId: "CB", reason: "Repeatedly accepted orders for unavailable meals.",
        amount: 2000, decision: "pending", evidenceNotes: "Test evidence"
      })
    });
    assert.equal(created.status, 201);
    const record = (await created.json()).case;
    assert.match(record.id, /^CASE-/);
    assert.equal(record.decision, "pending");

    const updated = await api(superCookie, "/api/superadmin/operations-cases/" + record.id, {
      method: "PATCH",
      body: JSON.stringify({ decision: "fine-issued", resolution: "Fine issued after review." })
    });
    assert.equal(updated.status, 200);
    const result = (await updated.json()).case;
    assert.equal(result.decision, "fine-issued");
    assert.equal(result.history.length, 2);

    const archive = await (await api(superCookie, "/api/superadmin/operations-records")).json();
    assert.ok(archive.cases.some(item => item.id === record.id && item.decision === "fine-issued"));
    assert.ok(archive.events.some(item => item.type === "case_decision_updated" && item.entityId === "CB"));
  });

  await t.test("ordinary admin cannot create or update case decisions", async () => {
    assert.equal((await api(adminCookie, "/api/superadmin/operations-cases", {
      method: "POST",
      body: JSON.stringify({ type: "warning", subjectRole: "agent", reason: "Test reason", decision: "pending" })
    })).status, 403);
  });
});
