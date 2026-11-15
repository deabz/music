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
    logYtdlpVersion: async () => {},
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

test("gateway diagnostics expose HTTP status and retry waits without raw debug data", () => {
  const { Events, RESTEvents } = require("discord.js");
  const listeners = new Map();
  const restListeners = new Map();
  const messages = [];
  const diagnosticsStart = source.indexOf("client.on(Events.Error,");
  vm.runInNewContext(source.slice(diagnosticsStart, start), {
    Events, RESTEvents,
    client: {
      on: (event, callback) => listeners.set(event, callback),
      rest: { on: (event, callback) => restListeners.set(event, callback) }
    },
    console: { log: message => messages.push(message), error: message => messages.push(message) }
  });
  restListeners.get(RESTEvents.Response)({ route: "/gateway/bot", options: { secret: "synthetic-secret" } }, { status: 429 });
  restListeners.get(RESTEvents.RateLimited)({ route: "/gateway/bot", retryAfter: 300000, timeToReset: 1000 });
  assert.match(messages[0], /HTTP 429/);
  assert.match(messages[1], /Waiting 300 seconds/);
  listeners.get(Events.Debug)("Provided token: synthetic-secret");
  assert.equal(messages.length, 2);
  listeners.get(Events.Debug)("[WS => Manager] Fetched Gateway Information\n\tURL: synthetic-secret");
  listeners.get(Events.Debug)("[WS => Shard 0] Connecting to wss://synthetic-secret");
  listeners.get(Events.Debug)("[WS => Shard 0] Waiting for identify throttle");
  listeners.get(Events.Debug)("[WS => Shard 0] Identifying\n\tdata: synthetic-secret");
  assert.equal(messages.length, 6);
  assert.ok(!messages.join("\n").includes("synthetic-secret"));
});


test("registration failure and malformed guild snapshots do not prevent restoration or readiness", async () => {
  const begin = source.indexOf("client.once(Events.ClientReady, async ready => {");
  const finish = source.indexOf("\nconst handleCommand", begin);
  let handler, release, restored = 0, joined = 0;
  const pending = new Promise(r => { release = r; });
  const state = { restore: async () => { restored++; await pending; }, connect: async () => { joined++; } };
  const context = { startupComplete: false, shuttingDown: false, console: { log() {}, error() {} },
    client: { once: (_, fn) => { handler = fn; } }, Events: { ClientReady: "ready" },
    updatePresence() {}, startStartupDiagnostics() {}, registerCommands: async () => { throw new Error("synthetic registration failure"); },
    loadMusicState: async () => {}, favourites: { load: async () => {} }, savedMusicStates: { bad: null, malformed: [], valid: { voiceChannelId: "voice" } },
    getMusic: () => state, music: new Map(), VoiceConnectionStatus: { Ready: "ready" },
    config: { autoJoin: true, voiceGuildId: "auto", voiceChannelId: "voice" } };
  vm.createContext(context); vm.runInContext(source.slice(begin, finish), context);
  const guild = { id: "guild", channels: { fetch: async () => ({ isVoiceBased: () => true }) } };
  const running = handler({ user: { tag: "synthetic" }, guilds: { fetch: async () => guild } });
  await new Promise(setImmediate);
  assert.equal(context.startupComplete, false);
  assert.equal(restored, 1);
  release(); await running;
  assert.equal(joined, 1); assert.equal(context.startupComplete, true);
});

test("fatal process handlers log and request shutdown with a failure exit code", () => {
  const handlers = new Map(), exits = [];
  const begin = source.indexOf('process.on("SIGINT"');
  const finish = source.indexOf('\nclient.on(Events.Error', begin);
  vm.runInNewContext(source.slice(begin, finish), {
    process: { on: (event, handler) => handlers.set(event, handler) }, console: { error() {} },
    shutdown: async code => { exits.push(code); }
  });
  handlers.get("unhandledRejection")(new Error("synthetic"));
  handlers.get("uncaughtException")(new Error("synthetic"));
  assert.deepEqual(exits, [1, 1]);
});
test("panel reattachment still runs when a saved voice channel is gone", async () => {
  const begin = source.indexOf("client.once(Events.ClientReady, async ready => {");
  const finish = source.indexOf("\nconst handleCommand", begin);
  let handler, attached = 0, restoredIdentity;
  const state = { restorePanel: snapshot => { restoredIdentity = snapshot.panelMessageId; },
    panel: { reattach: async () => { attached++; } } };
  const context = { startupComplete: false, shuttingDown: false, console: { log() {}, error() {} },
    client: { once: (_, fn) => { handler = fn; } }, Events: { ClientReady: "ready" }, updatePresence() {}, startStartupDiagnostics() {},
    registerCommands: async () => {}, loadMusicState: async () => {}, favourites: { load: async () => {} },
    savedMusicStates: { guild: { voiceChannelId: "gone", panelChannelId: "text", panelMessageId: "existing" } },
    getMusic: () => state, music: new Map(), config: {} };
  vm.runInNewContext(source.slice(begin, finish), context);
  await handler({ user: { tag: "synthetic" }, guilds: { fetch: async () => ({ channels: { fetch: async () => { throw new Error("gone"); } } }) } });
  assert.equal(attached, 1); assert.equal(restoredIdentity, "existing"); assert.equal(context.startupComplete, true);
});
