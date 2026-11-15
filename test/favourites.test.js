const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { FavouritesStore } = require("../src/favourites");
const song = index => ({ url: `https://youtube.com/watch?v=${index}`, title: `Song ${index}`, author: "Artist", duration: 120, thumbnail: null, requestedById: "not-persisted" });
test("favourites toggle globally per user, persist atomically, and enforce 25 without overwriting guild data", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nyx-favourites-"));
  try {
    const file = path.join(directory, "favourites.json");
    const guildFile = path.join(directory, "music-state.json");
    await fs.writeFile(guildFile, "guild sentinel", "utf8");
    const store = new FavouritesStore(file); await store.load();
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => store.toggle("listener", song(i))));
    assert.ok(results.every(value => value === "added"));
    assert.equal(await store.toggle("listener", song(25)), "limit");
    assert.equal(await store.toggle("listener", song(0)), "removed");
    assert.equal(await store.toggle("other", song(0)), "added");
    const restored = new FavouritesStore(file); await restored.load();
    assert.equal(restored.list("listener").length, 24); assert.equal(restored.list("other").length, 1);
    assert.equal(restored.list("listener")[0].id.length, 20);
    assert.ok(!JSON.stringify(restored.list("listener")).includes("not-persisted"));
    assert.equal(await fs.readFile(guildFile, "utf8"), "guild sentinel");
    assert.deepEqual((await fs.readdir(directory)).sort(), ["favourites.json", "music-state.json"]);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test("failed favourites loads never overwrite existing data", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nyx-favourites-corrupt-"));
  try {
    const file = path.join(directory, "favourites.json");
    await fs.writeFile(file, "corrupt sentinel", "utf8");
    let logs = 0;
    const store = new FavouritesStore(file, () => { logs++; });
    assert.equal(await store.load(), false);
    await assert.rejects(store.toggle("listener", song(0)), /unavailable/);
    assert.throws(() => store.list("listener"), /unavailable/);
    assert.equal(await fs.readFile(file, "utf8"), "corrupt sentinel"); assert.equal(logs, 1);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
