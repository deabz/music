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
  assert.match(embed.description, /`1\.` \*\*Waiting\*\*/);
  assert.match(embed.description, /\[`02:05`\],\n\*Requested by -\* <@12345678901234567>/);
  assert.deepEqual(embed.footer, { text: "Volume: 90", icon_url: "https://example.com/bot.png" });
  assert.equal(buildPlayerPanel({ ...state, queue: [] }).embeds[0].title, "1 track in queue");
  const autoplay = buildPlayerPanel({ ...state, current: { ...track(), autoSuggested: true }, queue: [] });
  assert.match(autoplay.embeds[0].description, /Autoplay/);
});
test("panel stays below embed/component limits, truncates safely and disables idle controls", () => {
  const state = { current: track("[test](url)*"), queue: Array.from({ length: 30 }, () => track()), loop: "track", volume: 80 };
  const payload = buildPlayerPanel(state);
  assert.match(payload.embeds[0].description, /\.\.\.and 20 more/);
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
test("edits serialize while one is pending and unchanged state does not schedule more requests", async () => {
  const f = fixture(); await f.manager.ensure("channel");
  f.manager.scheduleUpdate(); assert.equal(f.timers.size, 0);
  let release, active = 0, maximum = 0, edits = 0;
  const gate = new Promise(resolve => { release = resolve; });
  f.message.edit = async () => { active++; maximum = Math.max(maximum, active); edits++; if (edits === 1) await gate; active--; };
  f.state.volume = 90; const first = f.manager.flush(); await new Promise(setImmediate);
  f.state.volume = 100; const second = f.manager.flush();
  release(); await Promise.all([first, second]);
  assert.equal(maximum, 1); assert.equal(edits, 2);
});
test("missing messages on edit recover and disposed managers cannot send after an awaited fetch", async () => {
  const f = fixture(); await f.manager.ensure("channel");
  f.message.edit = async () => { throw { code: 10008 }; };
  f.state.volume = 90; await f.manager.flush(); assert.equal(f.calls.sends, 2);
  let release;
  const stopped = fixture({ getChannel: () => new Promise(resolve => { release = resolve; }) });
  const pending = stopped.manager.ensure("channel"); await new Promise(setImmediate);
  stopped.manager.dispose(); release(stopped.channel); await pending;
  assert.equal(stopped.calls.sends, 0);
});
test("Discord builders accept the component payload and Unicode text obeys code-unit limits", () => {
  const { ActionRowBuilder } = require("discord.js");
  const state = { current: track(), queue: [], loop: "off", panelSuggestions: [{ ...track("\uD83C\uDFB5".repeat(120)), author: "\uD83C\uDFB5".repeat(120), id: "short" }] };
  const payload = buildPlayerPanel(state);
  for (const row of payload.components) assert.doesNotThrow(() => new ActionRowBuilder(row).toJSON());
  assert.ok(payload.components[0].components[0].options[0].label.length <= 100);
  assert.ok(payload.components[0].components[0].options[0].description.length <= 100);
});


test("reference embed separates the current requester from unlinked numbered waiting tracks", () => {
  const single = buildPlayerPanel({ current: track("Current"), queue: [], loop: "off", volume: 70 }).embeds[0];
  assert.equal(single.description, "[Current](https://youtube.com/watch?v=abc) - [`02:05`],\n*Requested by -* <@12345678901234567>");
  assert.ok(!single.description.includes("Up Next"));
  const many = buildPlayerPanel({ current: { ...track("Current"), autoSuggested: true }, queue: [track("Waiting"), { ...track("Automatic"), autoSuggested: true }], loop: "off" });
  assert.match(many.embeds[0].description, /Requested by -\* Autoplay\n\n\*\*Up Next:\*\*/);
  assert.ok(many.embeds[0].description.includes("`1.` **Waiting** \u2014 [`02:05`] \u2014 <@12345678901234567>"));
  assert.ok(many.embeds[0].description.includes("`2.` **Automatic** \u2014 [`02:05`] \u2014 Autoplay"));
  assert.ok(!many.embeds[0].description.includes("[Waiting]("));
  assert.deepEqual(many.allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
});

test("waiting titles truncate at forty characters and hostile markdown/mentions remain inert", () => {
  const state = { current: track("[Fake](bad)* @everyone <@&12345678901234567>"),
    queue: [track("A".repeat(100)), track("**bold** @here <@12345678901234567>")], loop: "off" };
  const payload = buildPlayerPanel(state);
  const text = payload.embeds[0].description;
  assert.ok(text.includes("A".repeat(39) + "\u2026"));
  assert.ok(text.includes("\\[Fake\\]\\(bad\\)\\*"));
  assert.ok(!text.includes("@everyone")); assert.ok(!text.includes("@here"));
  assert.ok(text.length <= 4096);
  assert.equal(payload.allowedMentions.parse.length, 0);
});


test("suggestion count has one exported setting and channel descriptions retain source and duration", () => {
  const { PANEL_SUGGESTION_COUNT } = require("../src/player-panel");
  assert.equal(PANEL_SUGGESTION_COUNT, 5);
  const suggestions = Array.from({ length: 10 }, (_, index) => ({ ...track("Title " + index), author: "C".repeat(160), id: "short_" + index }));
  const menu = buildPlayerPanel({ current: track(), queue: [], loop: "off", panelSuggestions: suggestions }).components[0].components[0];
  assert.equal(menu.placeholder, "Select a suggested song");
  assert.equal(menu.options.length, PANEL_SUGGESTION_COUNT);
  for (const option of menu.options) {
    assert.ok(option.description.endsWith(" - youtube - 02:05"));
    assert.equal(option.description.length, 100); assert.ok(option.description.includes("\u2026"));
    assert.ok(option.label.startsWith("Title ")); assert.ok(option.value.startsWith("short_"));
  }
});
test("play/pause/loop states are reflected and idle/replay keep the same message", async () => {
  for (const status of ["playing", "paused", "buffering"]) {
    const payload = buildPlayerPanel({ current: track(), queue: [], player: { state: { status } }, loop: "off" });
    const row = payload.components[1].components;
    assert.equal(row[0].disabled, status !== "paused");
    assert.equal(row[2].disabled, status !== "playing");
    assert.equal(row[4].style, 2);
  }
  const f = fixture(); await f.manager.ensure("channel");
  f.state.current = null; await f.manager.flush();
  assert.equal(f.state.panelMessageId, "message"); assert.equal(f.calls.sends, 1);
  f.state.current = track("New song"); await f.manager.ensure("elsewhere");
  assert.equal(f.calls.sends, 1); assert.equal(f.state.panelChannelId, "channel");
});
test("large hostile metadata stays below embed limits with ten waiting entries and complete links", () => {
  const waiting = Array.from({ length: 1000 }, () => track("\\[**@everyone**\\]".repeat(100)));
  const payload = buildPlayerPanel({ current: { ...track("Current"), url: "https://youtube.com/watch?v=(test)" }, queue: waiting, loop: "off" });
  const description = payload.embeds[0].description;
  assert.ok(description.includes("watch?v=%28test%29) - [`02:05`],"));
  assert.ok(description.includes("`10.`")); assert.ok(!description.includes("`11.`"));
  assert.match(description, /\.\.\.and 990 more$/); assert.ok(description.length < 4096);
  assert.ok(!description.includes("@everyone"));
});
test("confirmation helper emits exact public text with escaped titles and no mentions", () => {
  const { buildPlayConfirmation } = require("../src/player-panel");
  assert.equal(buildPlayConfirmation([track("Song")]).content, "**Song** added to the queue");
  assert.equal(buildPlayConfirmation([track(), track()]).content, "**2 tracks** added to the queue");
  const unsafe = buildPlayConfirmation([track("[test] @everyone <@&12345678901234567>")]);
  assert.ok(unsafe.content.includes("\\[test\\]")); assert.ok(!unsafe.content.includes("@everyone"));
  assert.ok(!unsafe.content.includes("<@&")); assert.deepEqual(unsafe.allowedMentions.users, []);
  assert.deepEqual(unsafe.allowedMentions.roles, []); assert.equal(unsafe.ephemeral, false);
});
