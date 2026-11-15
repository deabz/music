const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHealthServer } = require("../src/health-server");
const { healthPage } = require("../src/health-page");
const { dashboardPage } = require("../src/dashboard-page");

// Invalid credentials are generated only in memory for refusal/rate-limit tests.
const dashboardCredential = require("node:crypto").randomBytes(24).toString("hex");
const invalidAuthorization = () => "Bearer " + require("node:crypto").randomBytes(24).toString("hex");

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
    assert.match(await healthPage.text(), /Public status/);

    const healthz = await fetch(`${base}/healthz`, {
      headers: { Accept: "text/html" }
    });
    assert.match(healthz.headers.get("content-type"), /text\/html/);
    assert.equal(new URL(healthz.url).pathname, "/status");
  });
});

test("links the favicon from the public and dashboard pages", () => {
  assert.match(healthPage, /rel="icon"[^>]+href="\/favicon\.svg"/);
  assert.match(dashboardPage, /rel="icon"[^>]+href="\/favicon\.svg"/);
});

test("requires the dashboard token and accepts authorized read and control requests", async () => {
  await withServer({ dashboardToken: dashboardCredential }, async base => {
    const denied = await fetch(`${base}/api/dashboard`);
    assert.equal(denied.status, 401);

    const headers = { Authorization: "Bearer " + dashboardCredential };
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
  await withServer({ dashboardToken: dashboardCredential }, async base => {
    const response = await fetch(`${base}/api/dashboard/actions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + dashboardCredential,
        "Content-Type": "text/plain"
      },
      body: "{}"
    });
    assert.equal(response.status, 415);
  });
});

test("health readiness, schema, pretty JSON, redirect and private-field filtering", async () => {
  let ready = false;
  const track = { title: "Song", artist: "Artist", thumbnail: null, positionSeconds: 15.25, durationSeconds: 180, status: "paused", server: "Music server", token: "private", guildId: "private" };
  await withServer({ getStatus: () => ({ ready, serverCount: 3, uptimeSeconds: 12, pingMs: 42.4, track }) }, async base => {
    const offline = await fetch(`${base}/healthz`);
    assert.equal(offline.status, 503);
    assert.equal(offline.headers.get("cache-control"), "no-store");
    const raw = await offline.text();
    assert.match(raw, /\n  "status"/);
    const data = JSON.parse(raw);
    assert.equal(data.bot, "offline");
    assert.ok(!("track" in data));
    assert.equal(data.uptimeSeconds, 12);
    assert.equal(data.version, require("../package.json").version);
    assert.ok(Number.isFinite(Date.parse(data.timestamp)));
    ready = true;
    const online = await fetch(`${base}/healthz`, { headers: { Accept: "application/json" } });
    assert.equal(online.status, 200);
    const snapshot = await online.json();
    assert.equal(snapshot.pingMs, 42);
    assert.equal(snapshot.track.positionSeconds, 15.25);
    assert.ok(!("server" in snapshot.track));
    assert.ok(!JSON.stringify(snapshot).includes("Music server"));
    assert.ok(!JSON.stringify(snapshot).includes("private"));
    const redirect = await fetch(`${base}/healthz`, { headers: { Accept: "text/html" }, redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), "/status");
    const missing = await fetch(`${base}/unknown`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Off the playlist/);
  });
});

test("both dashboard endpoints reject missing, wrong, URL and malformed tokens; failures rate limit", async () => {
  let controls = 0;
  await withServer({ dashboardToken: dashboardCredential, controlDashboard: async () => { controls++; } }, async base => {
    for (const [path, options] of [
      ["/api/dashboard?token=synthetic-secret", {}],
      ["/api/dashboard/actions", { method: "POST" }],
      ["/api/dashboard", { headers: { Authorization: invalidAuthorization() } }],
      ["/api/dashboard/actions", { method: "POST", headers: { Authorization: "Basic synthetic-secret" } }],
      ["/api/dashboard", { headers: { Authorization: invalidAuthorization() } }]
    ]) assert.equal((await fetch(base + path, options)).status, 401);
    const blocked = await fetch(`${base}/api/dashboard`, { headers: { Authorization: "Bearer " + dashboardCredential } });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(controls, 0);
  });
});

test("unexpected dashboard failures never expose stack traces or paths", async () => {
  await withServer({ dashboardToken: dashboardCredential, getDashboard: async () => { throw new Error("private-path-and-secret"); } }, async base => {
    const original = console.error;
    console.error = () => {};
    try {
      const result = await fetch(`${base}/api/dashboard`, { headers: { Authorization: "Bearer " + dashboardCredential } });
      assert.equal(result.status, 500);
      assert.deepEqual(await result.json(), { error: "The dashboard request could not be completed." });
    } finally { console.error = original; }
  });
});

test("motion links have a shared content version and development assets revalidate", async () => {
  await withServer({ page: healthPage }, async base => {
    const html=await (await fetch(base)).text();
    const links=[...html.matchAll(/(?:href|src)="(\/site\.(?:css|js)\?v=([a-f0-9]+))"/g)];
    assert.equal(links.length,2);
    assert.equal(links[0][2],links[1][2]);
    for(const [,path] of links) {
      const response=await fetch(base+path);
      assert.equal(response.status,200);
      assert.match(response.headers.get("cache-control"),/no-cache|max-age=0/);
    }
  });
});


test("new public endpoints are noindex, command-backed and have no dashboard data", async () => {
  await withServer({page:healthPage}, async base => {
    const api=await fetch(base+"/api/commands");
    const commands=await api.json();
    assert.equal(commands.length,require("../src/website").publicCommands.length);
    assert.ok(commands.every(command=>command.usage.startsWith("/")));
    for(const route of ["/","/commands","/changelog","/status","/dashboard","/unknown"]) {
      const response=await fetch(base+route);
      assert.match(response.headers.get("x-robots-tag"),/noindex/);
      const html=await response.text();
      assert.ok(!html.includes('Test listening secret'));
    }
    assert.match(await (await fetch(base+"/robots.txt")).text(),/Allow: \//);
    const manifest=await (await fetch(base+"/site.webmanifest")).json();
    assert.equal(manifest.icons.length,2);
    const changes=await (await fetch(base+"/changelog.json")).json();
    assert.ok(changes.length>=2);
  });
});
