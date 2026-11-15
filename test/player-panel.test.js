const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPlayerPanel, PlayerPanel } = require("../src/player-panel");
const track = (title = "Song") => ({ title, url: "https://youtube.com/watch?v=abc", author: "Artist", duration: 125, requestedById: "12345678901234567" });
test("panel renders plain linked titles, matching queue numbers, counts, requester and footer", () => {
  const state = { current: track("A".repeat(80)), queue: [track("Waiting")], volume: 90, loop: "off", player: { state: { status: "playing" } } };
  const payload = buildPlayerPanel(state, { avatarUrl: "https://example.com/bot.png" });
  const embed = payload.embeds[0];
  assert.equal(embed.title, "2 tracks in queue");
  assert.ok(embed.description.startsWith("["));
  assert.match(embed.description, /A{49}\u2026\]\(https:/);
  assert.match(embed.description, /1\. \[Waiting\]/);
  assert.match(embed.description, /`02:05`, \*Requested by -\* <@12345678901234567>/);
  assert.deepEqual(embed.footer, { text: "Volume: 90", icon_url: "https://example.com/bot.png" });
  assert.equal(buildPlayerPanel({ ...state, queue: [] }).embeds[0].title, "1 track in queue");
  const autoplay = buildPlayerPanel({ ...state, current: { ...track(), autoSuggested: true }, queue: [] });
  assert.match(autoplay.embeds[0].description, /Autoplay/);
});
test("panel stays below embed/component limits, truncates safely and disables idle controls", () => {
  const state = { current: track("[test](url)*"), queue: Array.from({ length: 30 }, () => track()), loop: "track", volume: 80 };
  const payload = buildPlayerPanel(state);
  assert.match(payload.embeds[0].description, /\.\.\.and 21 more/);
  assert.ok(payload.embeds[0].description.length <= 4096);
  assert.equal(payload.components.length, 4);
  const ids = payload.components.flatMap(row => row.components.map(item => item.custom_id));
  assert.equal(new Set(ids).size, 16);
  for (const row of payload.components.slice(1)) assert.equal(row.components.length, 5);
  assert.equal(payload.components[0].components[0].disabled, true);
  assert.equal(payload.components[1].components[4].style, 3);
  const idle = buildPlayerPanel({ queue: [], loop: "off" });
  assert.match(idle.embeds[0].description, /Nothing is playing/);
  assert.ok(idle.components[1].components.every(item => item.disabled));
});

function fixture(options = {}) {
  const state = { guild: { id: "guild" }, current: track(), queue: [], volume: 80, loop: "off" };
  const calls = { sends: 0, edits: 0, deletes: 0, logs: 0, identities: 0 };
  let missing = false, denied = false, pending;
  const message = { id: "message", edit: async () => { if (denied) throw { code: 50013 }; calls.edits++; }, delete: async () => { calls.deletes++; } };
  const channel = { id: "channel", messages: { fetch: async () => { if (missing) throw { code: 10008 }; return message; } },
    send: async () => { if (denied) throw { code: 50013 }; calls.sends++; missing = false; return message; } };
  const timers = new Map(); let timerId = 0;
  const manager = new PlayerPanel(state, { getChannel: async () => channel, onIdentity: () => { calls.identities++; },
    log: () => { calls.logs++; }, setTimer: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimer: id => timers.delete(id), ...options });
  return { state, calls, manager, message, channel, timers,
    missing: () => { missing = true; }, denied: value => { denied = value; } };
}
test("concurrent first plays create one normal message and debounce coalesces updates", async () => {
  const f = fixture();
  await Promise.all([f.manager.ensure("channel"), f.manager.ensure("elsewhere")]);
  assert.equal(f.calls.sends, 1); assert.equal(f.state.panelChannelId, "channel");
  f.state.volume = 100;
  f.manager.scheduleUpdate(); f.manager.scheduleUpdate(); f.manager.scheduleUpdate();
  assert.equal(f.timers.size, 1);
  [...f.timers.values()][0](); await f.manager.chain;
  assert.equal(f.calls.edits, 1);
});
test("deleted panels are replaced, moves delete the old message, and restored IDs reattach", async () => {
  const f = fixture(); await f.manager.ensure("channel");
  f.missing(); f.state.volume = 90; await f.manager.flush();
  assert.equal(f.calls.sends, 2);
  await f.manager.move("channel"); assert.equal(f.calls.deletes, 1); assert.equal(f.calls.sends, 3);
  const restored = new PlayerPanel(f.state, { getChannel: async () => f.channel });
  await restored.reattach(); assert.equal(f.calls.edits, 1); assert.equal(f.calls.sends, 3);
  f.missing(); await restored.reattach();
  assert.equal(f.state.panelMessageId, null); assert.equal(f.calls.sends, 3);
  await restored.ensure("elsewhere"); assert.equal(f.calls.sends, 4);
});
test("permission errors log once and stay blocked until an explicit command", async () => {
  const f = fixture(); f.denied(true);
  await f.manager.ensure("channel"); await f.manager.flush(); f.manager.scheduleUpdate();
  assert.equal(f.calls.logs, 1); assert.equal(f.timers.size, 0);
  f.denied(false); await f.manager.ensure("channel");
  assert.equal(f.calls.sends, 1);
});
