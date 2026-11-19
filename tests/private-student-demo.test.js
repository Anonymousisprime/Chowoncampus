const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const demo = fs.readFileSync(path.join(__dirname, "..", "private-student-demo.html"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("private student demo is an isolated browser-only walkthrough", () => {
  assert.match(server, /COC_PRIVATE_STUDENT_DEMO_TOKEN/);
  assert.match(server, /crypto\.timingSafeEqual\(expected, supplied\)/);
  assert.match(server, /X-Robots-Tag/);
  assert.match(server, /private-student-demo\.html/);
  assert.doesNotMatch(demo, /fetch\s*\(/i);
  assert.doesNotMatch(demo, /\/api\//i);
  assert.match(demo, /simulated/i);
  assert.match(demo, /No real restaurant is notified/i);
  assert.match(demo, /Place simulated order/i);
});

test("demo includes student-only sections and excludes staff dashboard navigation", () => {
  for (const section of ["Restaurants", "My Orders", "FoodBack Wallet", "My Account"]) {
    assert.match(demo, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.doesNotMatch(demo, /admin-dashboard|restaurant-dashboard|agent-dashboard/i);
});
