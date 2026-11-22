const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("admins can edit existing agent category and gender", () => {
  const admin = read("public/admin-dashboard.html");
  const server = read("server.js");
  assert.match(admin, /data-agent-profile=/);
  assert.match(admin, /Edit category \/ gender/);
  assert.match(admin, /\/profile/);
  assert.match(admin, /enter male or female/);
  assert.match(server, /app\.patch\("\/api\/admin\/agents\/:id\/profile"/);
  assert.match(server, /if \(!\["male", "female"\]\.includes\(gender\)\)/);
});

test("room orders only match the selected male or female Leg Agent", () => {
  const server = read("server.js");
  assert.match(server, /order\.deliveryType === "room" && String\(agent\.agentType \|\| "leg"\)\.toLowerCase\(\) !== "leg"/);
  assert.match(server, /String\(agent\.gender \|\| ""\)\.toLowerCase\(\) !== order\.agentGenderPreference/);
});
