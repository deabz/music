const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const http = require("node:http");
const entry = path.resolve(__dirname, "../src/index.js");
const execFileAsync = promisify(execFile);

async function freePort() {
  const server = http.createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function launch(extra = {}) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "nyx-startup-cwd-"));
  const validExtraPort = extra.PORT && /^\d+$/.test(extra.PORT) && Number(extra.PORT) > 0 && Number(extra.PORT) <= 65535;
  const port = validExtraPort ? Number(extra.PORT) : Object.hasOwn(extra, "PORT") ? 3000 : await freePort();
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    TEMP: os.tmpdir(), TMP: os.tmpdir(), PORT: String(port), NODE_ENV: "test", ...extra };
  const child = spawn(process.execPath, [entry], { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", b => { output += b; }); child.stderr.on("data", b => { output += b; });
  function waitForExit(timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.removeListener("exit", onExit); reject(new Error(`Child ${child.pid} did not exit during cleanup.`)); }, timeoutMs);
      const onExit = () => { clearTimeout(timer); resolve(); };
      child.once("exit", onExit);
    });
  }
  async function stop() {
    try {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = waitForExit(1000);
        child.kill("SIGTERM");
        try { await exited; }
        catch {
          if (process.platform === "win32") await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"]).catch(() => {});
          else child.kill("SIGKILL");
          await waitForExit(2000);
        }
      }
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
    assert.ok(child.exitCode !== null || child.signalCode !== null, `Child ${child.pid} remained alive after cleanup.`);
  }
  async function waitFor(pattern) {
    const until = Date.now() + 8000;
    while (!pattern.test(output) && child.exitCode === null && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(pattern.test(output), `Timed out waiting for ${pattern}; child exit=${child.exitCode}; captured output:\n${output}`);
  }
  async function waitForPortWithin(ms) {
    const until = Date.now() + ms;
    let lastError;
    while (Date.now() < until && child.exitCode === null) {
      try { return await get("/health"); }
      catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 25)); }
    }
    assert.fail(`IPv4 health port did not answer within ${ms}ms; last error=${lastError?.code || lastError?.message}; captured output:\n${output}`);
  }
  async function get(route) {
    return new Promise((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port, path: route, timeout: 1500 }, response => {
        let body = ""; response.setEncoding("utf8"); response.on("data", part => body += part); response.on("end", () => resolve({ status: response.statusCode, body }));
      }); req.on("error", reject); req.on("timeout", () => req.destroy(new Error("timeout")));
    });
  }
  return { child, port, get, stop, waitFor, waitForPortWithin, output: () => output };
}

test("entry opens IPv4 health port before missing-token configuration failure and remains alive", { timeout: 10000 }, async t => {
  const app = await launch(); t.after(() => app.stop());
  const portHealth = await app.waitForPortWithin(3000);
  assert.ok([200, 503].includes(portHealth.status));
  await app.waitFor(/HTTP listening on 0\.0\.0\.0:/);
  await app.waitFor(/FATAL CONFIG: DISCORD_TOKEN is not set/);
  const health = await app.get("/health"), readiness = await app.get("/healthz");
  assert.equal(health.status, 503);
  assert.deepEqual(JSON.parse(health.body), { status: "misconfigured", reason: "missing_token" });
  assert.equal(readiness.status, 503);
  assert.match(app.output(), /Environment: DISCORD_TOKEN=UNSET/);
  assert.doesNotMatch(app.output(), /synthetic-cookie-path-secret/);
  assert.ok(app.child.exitCode === null);
});

test("unreadable configured cookies warn and missing token does not leak values or stop listener", { timeout: 10000 }, async t => {
  const marker = "synthetic-cookie-path-secret";
  const app = await launch({ YOUTUBE_COOKIES_FILE: path.join(os.tmpdir(), marker) }); t.after(() => app.stop());
  assert.ok([200, 503].includes((await app.waitForPortWithin(3000)).status));
  await app.waitFor(/HTTP listening on 0\.0\.0\.0:/);
  await app.waitFor(/YOUTUBE_COOKIES_FILE is set but not readable/);
  await app.waitFor(/FATAL CONFIG: DISCORD_TOKEN is not set/);
  const health = await app.get("/health");
  assert.equal(health.status, 503);
  assert.deepEqual(JSON.parse(health.body), { status: "misconfigured", reason: "missing_token" });
  const healthz = await app.get("/healthz");
  assert.equal(healthz.status, 503);
  assert.match(app.output(), /YOUTUBE_COOKIES_FILE is set but not readable/);
  assert.ok(!app.output().includes(marker)); assert.ok(app.child.exitCode === null);
});

test("invalid PORT falls back to 3000 and binds the IPv4 wildcard", { timeout: 10000 }, async t => {
  const app = await launch({ PORT: "invalid" }); t.after(() => app.stop());
  assert.ok([200, 503].includes((await app.waitForPortWithin(3000)).status));
  await app.waitFor(/HTTP listening on 0\.0\.0\.0:3000/);
  assert.equal(app.port, 3000);
  assert.equal((await app.get("/health")).status, 503);
  assert.match(app.output(), /PORT is invalid; using 3000/);
  assert.match(app.output(), /Environment: DISCORD_TOKEN=UNSET/);
});

test("unset PORT falls back to 3000 with an explicit startup log", { timeout: 10000 }, async t => {
  const app = await launch({ PORT: "" }); t.after(() => app.stop());
  assert.ok([200, 503].includes((await app.waitForPortWithin(3000)).status));
  await app.waitFor(/HTTP listening on 0\.0\.0\.0:3000/);
  assert.match(app.output(), /PORT is unset; using 3000/);
});
