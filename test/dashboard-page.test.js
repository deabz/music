const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { dashboardPage } = require("../src/dashboard-page");

test("dashboard page embeds syntactically valid browser JavaScript", () => {
  const script = dashboardPage.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(dashboardPage, /id="current-requester"/);
  assert.match(dashboardPage, /Requested by /);
  assert.match(dashboardPage, /max-height: min\(65vh, 640px\)/);
  assert.match(dashboardPage, /overflow-y: auto/);
  assert.match(dashboardPage, /align-items: start/);
  assert.match(dashboardPage, /overflow-wrap: anywhere/);
  assert.match(dashboardPage, /id="current-artwork"/);
  assert.match(dashboardPage, /current\.thumbnail\.startsWith\("https:\/\/"\)/);
});
