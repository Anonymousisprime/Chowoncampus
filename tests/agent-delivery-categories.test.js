const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const admin = read("public/admin-dashboard.html");
const checkout = read("public/checkout.html");
const app = read("public/app.js");
const server = read("server.js");

test("admin must choose an agent category and gender when creating an agent", () => {
  assert.match(admin, /name="agentType" required/);
  assert.match(admin, /value="leg">Leg Agent/);
  assert.match(admin, /value="shuttle">Shuttle Agent/);
  assert.match(admin, /name="gender" required/);
  assert.match(admin, /a\.agentType\|\|'leg'/);
  assert.match(admin, /a\.gender\|\|'Gender not set'/);
});

test("student can choose gate or room delivery and sees the room surcharge", () => {
  assert.match(checkout, /option value="gate">Gate \/ collection point/);
  assert.match(checkout, /option value="room">Direct room delivery \(\+₦100\)/);
  assert.match(checkout, /id="roomDeliveryFee"/);
  assert.match(app, /const roomSurcharge = \$\("#deliveryType"\)\?\.value === "room" \? 100 : 0/);
  assert.match(app, /roomDeliveryFee/);
});

test("server enforces room delivery eligibility and optional agent gender preference", () => {
  assert.match(server, /if \(order\.deliveryType === "room" && String\(agent\.agentType \|\| "leg"\)\.toLowerCase\(\) !== "leg"\) return false/);
  assert.match(server, /agent\.gender \|\| ""\)\.toLowerCase\(\) !== order\.agentGenderPreference/);
  assert.match(server, /const roomDeliveryFee = deliveryType === "room" \? 100 : 0/);
  assert.match(server, /if \(!\["leg", "shuttle"\]\.includes\(agentType\)\)/);
});
