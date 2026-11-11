const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");

const storageSource = require("node:fs").readFileSync(require.resolve("../src/storage"), "utf8");

function storageModule(env, createClient = () => { throw new Error("Unexpected Supabase client"); }) {
  const messages = [];
  const errors = [];
  const context = {
    require: name => name === "@supabase/supabase-js" ? { createClient } : require(name),
    process: { env, pid: process.pid },
    console: { log: message => messages.push(message), error: message => errors.push(message) },
    module: { exports: {} }
  };
  vm.runInNewContext(storageSource, context);
  return { storage: context.module.exports, messages, errors };
}

function remoteStore(rows = []) {
  const calls = { loads: [], saves: [], deletes: [], clients: [] };
  const failures = {};
  const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-key" };
  const module = storageModule(env, (...args) => {
    calls.clients.push(args);
    return { from(table) {
      assert.equal(table, "music_state");
      return {
        select(columns) {
          assert.equal(columns, "guild_id, state");
          return { order(column) {
            assert.equal(column, "guild_id");
            return { async range(from, to) {
              calls.loads.push([from, to]);
              return { data: rows.slice(from, to + 1), error: failures.load };
            } };
          } };
        },
        async upsert(batch, options) {
          calls.saves.push({ batch, options });
          if (failures.throwSave) throw new Error("Network unavailable");
          return { error: failures.save };
        },
        delete() {
          return { async eq(column, guildId) {
            assert.equal(column, "guild_id");
            calls.deletes.push(guildId);
            return { error: failures.delete };
          } };
        }
      };
    } };
  });
  return { ...module, calls, failures };
}

test("Supabase loads all pages and batches only changed snapshots", async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({ guild_id: String(index), state: { volume: 80 } }));
  const { storage, calls, messages } = remoteStore(rows);
  const snapshots = await storage.loadAll();
  assert.equal(Object.keys(snapshots).length, 1001);
  assert.equal(calls.loads.length, 2);
  assert.equal(calls.clients[0][2].auth.persistSession, false);
  assert.match(messages[0], /Supabase/);
  await storage.saveGuilds(snapshots);
  assert.equal(calls.saves.length, 0);
  snapshots["1"].volume = 90;
  snapshots["2"].volume = 100;
  await storage.saveGuilds(snapshots);
  assert.equal(calls.saves.length, 1);
  const { batch, options } = calls.saves[0];
  assert.equal(batch.length, 2);
  assert.equal(options.onConflict, "guild_id");
  assert.equal(batch[0].state.volume, 90);
  assert.ok(Number.isFinite(Date.parse(batch[0].updated_at)));
  await storage.saveGuilds(snapshots);
  assert.equal(calls.saves.length, 1);
});

test("empty Supabase table accepts first save; failed saves log and retry", async () => {
  const { storage, calls, failures, errors } = remoteStore();
  assert.equal(Object.keys(await storage.loadAll()).length, 0);
  failures.save = { message: "Unauthorized" };
  await storage.saveGuilds({ guild: { volume: 80 } });
  assert.match(errors[0], /Unauthorized/);
  failures.save = null;
  failures.throwSave = true;
  await storage.saveGuilds({ guild: { volume: 80 } });
  assert.match(errors[1], /Network unavailable/);
  failures.throwSave = false;
  await storage.saveGuilds({ guild: { volume: 80 } });
  await storage.saveGuilds({ guild: { volume: 80 } });
  assert.equal(calls.saves.length, 3);
});

test("Supabase load errors keep saving and deletion disabled", async () => {
  const { storage, calls, failures } = remoteStore();
  failures.load = new Error("Auth failed");
  await assert.rejects(storage.loadAll(), /Auth failed/);
  await storage.saveGuilds({ guild: {} });
  await storage.deleteGuild("guild");
  assert.equal(calls.saves.length, 0);
  assert.equal(calls.deletes.length, 0);
});

test("Supabase delete is filtered; failed deletion retains cached state", async () => {
  const { storage, calls, failures, errors } = remoteStore([{ guild_id: "guild", state: { volume: 80 } }]);
  const snapshots = await storage.loadAll();
  failures.delete = { message: "Delete denied" };
  await storage.deleteGuild("guild");
  assert.match(errors[0], /Delete denied/);
  await storage.saveGuilds(snapshots);
  assert.equal(calls.saves.length, 0);
  failures.delete = null;
  await storage.deleteGuild("guild");
  await storage.saveGuilds(snapshots);
  assert.equal(calls.deletes.length, 2);
  assert.equal(calls.saves.length, 1);
});

test("missing either Supabase variable preserves versioned atomic JSON storage", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "music-storage-"));
  try {
    for (const partial of [{}, { SUPABASE_URL: "https://example.supabase.co" }, { SUPABASE_SERVICE_ROLE_KEY: "test-key" }]) {
      const file = path.join(directory, "nested", `state-${Object.keys(partial).join("")}.json`);
      const { storage, messages } = storageModule({ ...partial, MUSIC_STATE_FILE: file });
      assert.match(messages[0], /JSON file/);
      assert.equal(Object.keys(await storage.loadAll()).length, 0);
      await storage.saveGuilds({ first: { volume: 80 }, second: { queue: [] } });
      assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { version: 1, guilds: { first: { volume: 80 }, second: { queue: [] } } });
      assert.equal(Object.keys(await storage.loadAll()).length, 2);
      await storage.deleteGuild("first");
      assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).guilds, { second: { queue: [] } });
      await assert.rejects(fs.access(`${file}.${process.pid}.tmp`), { code: "ENOENT" });
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("corrupt JSON state is left untouched and writes stay disabled", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "music-storage-"));
  const file = path.join(directory, "state.json");
  try {
    await fs.writeFile(file, "invalid json");
    const { storage } = storageModule({ MUSIC_STATE_FILE: file });
    await assert.rejects(storage.loadAll());
    await storage.saveGuilds({ guild: {} });
    await storage.deleteGuild("guild");
    assert.equal(await fs.readFile(file, "utf8"), "invalid json");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("shutdown waits for queued save, flushes latest state, then disconnects", async () => {
  const source = await fs.readFile(require.resolve("../src/index"), "utf8");
  const start = source.indexOf("let musicSaveTimer =");
  const end = source.indexOf("\nclass GuildMusic", start);
  const shutdownStart = source.indexOf("async function shutdown()");
  const shutdownEnd = source.indexOf('\nprocess.on("SIGINT"', shutdownStart);
  const operations = [];
  let scheduled;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const storage = { loadAll: async () => ({}), saveGuilds: async () => { operations.push("save"); if (operations.length === 1) await pending; } };
  const api = vm.runInNewContext(`${source.slice(start, end)}\n${source.slice(shutdownStart, shutdownEnd)}\n({ loadMusicState, scheduleMusicSave, shutdown });`, {
    storage, music: new Map(), console: { error() {} },
    setTimeout: callback => { scheduled = callback; }, clearTimeout() {},
    client: { destroy: () => operations.push("disconnect") }, process: { exit: () => operations.push("exit") }
  });
  await api.loadMusicState();
  api.scheduleMusicSave();
  scheduled();
  const stopping = api.shutdown();
  await Promise.resolve();
  assert.deepEqual(operations, ["save"]);
  release();
  await stopping;
  assert.deepEqual(operations, ["save", "save", "disconnect", "exit"]);
  storage.loadAll = async () => { throw new Error("Network down"); };
  await api.loadMusicState();
  operations.length = 0;
  await api.shutdown();
  assert.deepEqual(operations, ["disconnect", "exit"]);
});
