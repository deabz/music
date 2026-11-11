const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHealthServer } = require("../src/health-server");
const { healthPage } = require("../src/health-page");
const { dashboardPage } = require("../src/dashboard-page");

async function withServer(options, run) {
  const server = createHealthServer({
    page: "<main>public page</main>",
    dashboardPage: "<main>dashboard</main>",
    getStatus: () => ({ ready: true, serverCount: 2, track: null }),
    getDashboard: async () => ({ guilds: [{ id: "123", name: "Test" }] }),
    controlDashboard: async body => ({ accepted: body.action }),
    ...options
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("serves public pages and read-only health without a dashboard token", async () => {
  await withServer({}, async base => {
    const favicon = await fetch(`${base}/favicon.svg`);
    assert.equal(favicon.status, 200);
    assert.match(favicon.headers.get("content-type"), /image\/svg\+xml/);
    assert.match(await favicon.text(), /<svg/);

    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /public page/);

    const dashboard = await fetch(`${base}/dashboard`);
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /dashboard/);

    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).serverCount, 2);

    const healthPage = await fetch(`${base}/api/health`, {
      headers: { Accept: "text/html" }
    });
    assert.equal(healthPage.status, 200);
    assert.match(healthPage.headers.get("content-type"), /text\/html/);
    assert.match(await healthPage.text(), /public page/);

    const healthz = await fetch(`${base}/healthz`, {
      headers: { Accept: "text/html" }
    });
    assert.match(healthz.headers.get("content-type"), /application\/json/);
  });
});

test("links the favicon from the public and dashboard pages", () => {
  assert.match(healthPage, /rel="icon"[^>]+href="\/favicon\.svg"/);
  assert.match(dashboardPage, /rel="icon"[^>]+href="\/favicon\.svg"/);
});

test("requires the dashboard token and accepts authorized read and control requests", async () => {
  await withServer({ dashboardToken: "test-dashboard-token" }, async base => {
    const denied = await fetch(`${base}/api/dashboard`);
    assert.equal(denied.status, 401);

    const headers = { Authorization: "Bearer test-dashboard-token" };
    const dashboard = await fetch(`${base}/api/dashboard`, { headers });
    assert.deepEqual(await dashboard.json(), { guilds: [{ id: "123", name: "Test" }] });

    const action = await fetch(`${base}/api/dashboard/actions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause" })
    });
    assert.equal(action.status, 200);
    assert.deepEqual(await action.json(), { accepted: "pause" });
  });
});

test("rejects dashboard controls when no access token is configured", async () => {
  await withServer({}, async base => {
    const response = await fetch(`${base}/api/dashboard`);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /MUSIC_DASHBOARD_TOKEN/);
  });
});

test("validates dashboard action request JSON", async () => {
  await withServer({ dashboardToken: "test-dashboard-token" }, async base => {
    const response = await fetch(`${base}/api/dashboard/actions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-dashboard-token",
        "Content-Type": "text/plain"
      },
      body: "{}"
    });
    assert.equal(response.status, 415);
  });
});
