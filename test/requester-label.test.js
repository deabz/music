const { test } = require("node:test");
const assert = require("node:assert/strict");
const { requesterLabel } = require("../src/commands");

test("labels dashboard and system track requesters without invalid mentions", () => {
  assert.equal(requesterLabel({ requestedById: "dashboard" }), "Dashboard");
  assert.equal(requesterLabel({ requestedById: "system" }), "Autoplay");
  assert.equal(requesterLabel({}), "Autoplay");
});

test("keeps Discord user mentions for user-requested tracks", () => {
  assert.equal(requesterLabel({ requestedById: "12345678901234567" }), "<@12345678901234567>");
});
