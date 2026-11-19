const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboard = fs.readFileSync(path.join(__dirname, "..", "public", "agent-dashboard.html"), "utf8");

test("agent dashboard does not rebuild an unchanged delivery card during polling", () => {
  assert.match(dashboard, /const renderKey=JSON\.stringify\(\[active\.id,active\.status,Boolean\(active\.assignmentAcceptedAt\),active\.assignmentExpiresAt\|\|null\]\)/);
  assert.match(dashboard, /if\(\$\("#orders"\)\.dataset\.renderKey===renderKey\)\{if\(active\.status==="Out for delivery"\|\|chatGraceOpen\)loadAgentChat\(active\.id\);return\}/);
  assert.match(dashboard, /\$\("#orders"\)\.dataset\.renderKey=renderKey/);
});

test("agent chat and handover submissions are protected while the request is pending", () => {
  assert.match(dashboard, /agentOrderFormBusy=true;try\{await api\("\/api\/orders\/".*?\/chat/s);
  assert.match(dashboard, /agentOrderFormBusy=true;message\.textContent="Verifying handover code/);
  assert.match(dashboard, /if\(!agentOrderFormBusy&&!agentOrderEditorIsActive\(\)\)renderOrders\(\)/);
});

test("handover submission sends the normalized four-character code", () => {
  assert.match(dashboard, /deliveryCode:input\.value\.trim\(\)\.toUpperCase\(\)/);
  assert.match(dashboard, /finally\{agentOrderFormBusy=false;button\.disabled=false\}/);
});
