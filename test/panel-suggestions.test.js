const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PanelSuggestions } = require("../src/panel-suggestions");
const { buildPlayerPanel, PANEL_SUGGESTION_COUNT } = require("../src/player-panel");
const { AutoplayCandidates } = require("../src/autoplay-candidates");
const { SongMemory, songKey } = require("../src/song-identity");
test("suggestion searches are cached per track and stale responses cannot change another song's menu", async () => {
  const one = { url: "one" }, two = { url: "two" };
  const state = { current: one, queue: [] };
  const pending = new Map(); let searches = 0, updates = 0;
  const cache = new PanelSuggestions(state, { search: track => { searches++; return new Promise(resolve => pending.set(track.url, resolve)); }, changed: () => { updates++; } });
  const first = cache.load(one); cache.load(one);
  await new Promise(setImmediate); assert.equal(searches, 1);
  state.current = two; const second = cache.load(two);
  await new Promise(setImmediate);
  pending.get("one")([{ title: "stale", url: "stale", author: "Artist", duration: 180 }]); await first;
  assert.equal(state.panelSuggestions, null);
  pending.get("two")([{ title: "fresh", url: "fresh", author: "Artist", duration: 180 }]); await second;
  assert.equal(state.panelSuggestions[0].title, "fresh"); assert.equal(updates, 2);
  cache.load(two); assert.equal(searches, 2);
  const id = state.panelSuggestions[0].id;
  assert.ok(id.length < 30);
  const claimed = cache.take(id); assert.equal(cache.take(id), null);
  cache.restore(claimed); assert.equal(state.panelSuggestions.length, 1);
  cache.dispose();
});
test("stopping aborts pending suggestions and select options obey Discord limits", async () => {
  let resolve, signal;
  const state = { current: { url: "one" }, queue: [], loop: "off" };
  const cache = new PanelSuggestions(state, { search: (_, suppliedSignal) => { signal = suppliedSignal; return new Promise(r => { resolve = r; }); } });
  const pending = cache.load(state.current); await new Promise(setImmediate);
  cache.clearActive(); resolve([{ title: "late" }]); await pending;
  assert.equal(signal.aborted, true); assert.deepEqual(state.panelSuggestions, []);
  const ready = new PanelSuggestions(state, { search: async () => Array.from({ length: 20 }, (_, index) => ({ title: "x".repeat(140) + index, author: "Artist " + index % 3, url: String(index), duration: 180 })) });
  await ready.load(state.current);
  const options = buildPlayerPanel(state).components[0].components[0].options;
  assert.equal(options.length, PANEL_SUGGESTION_COUNT); assert.equal(new Set(options.map(item => item.value)).size, PANEL_SUGGESTION_COUNT);
  for (const option of options) { assert.ok(option.label.length <= 100); assert.ok(option.description.length <= 100); }
  ready.dispose();
});
test("dropdown and autoplay share ranking and dynamically exclude newly queued/played items", async () => {
  const current = { title: "Seed - Original", url: "https://youtube.com/watch?v=dQw4w9WgXcQ", duration: 180 };
  const state = { current, queue: [], autoplayMemory: new SongMemory() }; let searches = 0;
  const items = Array.from({ length: 6 }, (_, index) => ({ title: `Artist ${index % 3} - Song ${index}`, author: `Artist ${index % 3}`, url: `https://example.com/${index}`, duration: 180 }));
  const provider = new AutoplayCandidates(state, { mix: async () => { searches++; return items; } });
  const cache = new PanelSuggestions(state, { provider }); await cache.load(current);
  const menu = state.panelSuggestions, autoplay = await cache.candidates(current);
  assert.deepEqual(menu.map(songKey), autoplay.map(songKey)); assert.equal(searches, 1);
  const oldId = menu[0].id; state.queue.push(menu[0]); state.autoplayMemory.recordStart(menu[1]); cache.refresh();
  assert.equal(cache.take(oldId), null);
  assert.ok(!state.panelSuggestions.some(item => songKey(item) === songKey(menu[0]) || songKey(item) === songKey(menu[1])));
  assert.deepEqual((await cache.candidates(current)).map(songKey), state.panelSuggestions.map(songKey)); cache.dispose();
});
test("changing songs aborts old provider work and stop cancels the replacement lookup", async () => {
  const one = { title: "One - Seed", url: "https://youtube.com/watch?v=dQw4w9WgXcQ", duration: 180 };
  const two = { title: "Two - Seed", url: "https://youtube.com/watch?v=9bZkp7q19f0", duration: 180 };
  const state = { current: one, queue: [] }; const signals = [];
  const provider = new AutoplayCandidates(state, { mix: (id, signal) => {
    signals.push(signal);
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true }));
  } });
  const cache = new PanelSuggestions(state, { provider }); const first = cache.load(one); await new Promise(setImmediate);
  state.current = two; const second = cache.load(two); await new Promise(setImmediate);
  assert.equal(signals[0].aborted, true); cache.clearActive(); await Promise.all([first, second]);
  assert.ok(signals.every(signal => signal.aborted)); assert.deepEqual(state.panelSuggestions, []); cache.dispose();
});
