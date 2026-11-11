const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../src/index"), "utf8");
const start = source.indexOf("async function startBot()");
const end = source.indexOf("\nstartBot();", start);

function startup(prepareYouTubeCookies) {
  const logs = [];
  const errors = [];
  const exits = [];
  let warning;
  let ready;
  let cleared = false;
  let logins = 0;
  const startBot = vm.runInNewContext(`${source.slice(start, end)}\nstartBot;`, {
    prepareYouTubeCookies,
    config: { token: "synthetic-test-token" },
    client: {
      isReady: () => false,
      once: (event, callback) => { ready = callback; },
      login: async () => { logins++; }
    },
    Events: { ClientReady: "clientReady" },
    setTimeout: callback => { warning = callback; return { unref() {} }; },
    clearTimeout: () => { cleared = true; },
    console: { log: message => logs.push(message), error: message => errors.push(message) },
    process: { exit: code => exits.push(code) }
  });
  return { startBot, logs, errors, exits, warn: () => warning(), ready: () => ready(), cleared: () => cleared, logins: () => logins };
}

test("startup distinguishes cookie preparation from Discord login and clears warning on ready", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const app = startup(() => pending);
  const running = app.startBot();
  app.warn();
  assert.match(app.errors[0], /YouTube cookie preparation/);
  assert.equal(app.logins(), 0);
  release();
  await running;
  assert.equal(app.logins(), 1);
  assert.match(app.logs[1], /Connecting to Discord/);
  app.warn();
  assert.match(app.errors[1], /Discord login/);
  app.ready();
  assert.equal(app.cleared(), true);
});

test("startup errors identify the stage without printing error contents or secrets", async () => {
  const app = startup(async () => { throw Object.assign(new Error("synthetic-secret-value"), { code: "ENOENT" }); });
  await app.startBot();
  assert.match(app.errors[0], /cookie preparation: ENOENT/);
  assert.ok(!app.errors.join("\n").includes("synthetic-secret-value"));
  assert.equal(app.logins(), 0);
  assert.equal(app.cleared(), true);
  assert.deepEqual(app.exits, [1]);
});
