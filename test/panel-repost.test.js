const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PlayerPanel, escapePanelText, buildPlayerPanel, PANEL_REPOST_DELAY_MS } = require("../src/player-panel");
const { createPanelInteractionHandler } = require("../src/panel-interactions");

function fixture() {
  const events = [], timers = new Map();
  let timerId = 0;
  const state = { guild: { id: "guild" }, panelChannelId: "channel", panelMessageId: "old",
    current: { title: "Song", url: "https://example.com/song", duration: 100, panelInstanceId: "one" }, queue: [] };
  const old = { id: "old", edit: async () => events.push("edit:old"), delete: async () => events.push("delete:old") };
  const fresh = { id: "new", edit: async () => events.push("edit:new"), delete: async () => {} };
  const channel = { id: "channel", lastMessageId: "chat", messages: { fetch: async id => id === "old" ? old : fresh },
    send: async () => { events.push("send"); return fresh; } };
  const panel = new PlayerPanel(state, { getChannel: async () => channel,
    onIdentity: async () => events.push("persist:" + state.panelMessageId), log: () => events.push("log"),
    setTimer: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimer: id => timers.delete(id) });
  state.panel = panel;
  panel.trackStarted(state.current, { restoring: true });
  const start = (id = "two") => { state.current = { ...state.current, panelInstanceId: id }; panel.trackStarted(state.current); };
  const tick = async () => { const pending = [...timers.values()]; timers.clear(); for (const { fn } of pending) fn(); await panel.chain; };
  return { state, panel, old, fresh, channel, events, timers, start, tick };
}

test("different instances of the same URL send, persist new IDs, then delete; later edits use new IDs", async () => {
  const f = fixture(); f.start();
  assert.equal([...f.timers.values()][0].ms, PANEL_REPOST_DELAY_MS);
  await f.tick();
  assert.deepEqual(f.events, ["send", "persist:new", "delete:old"]);
  assert.equal(f.state.panelChannelId, "channel"); assert.equal(f.state.panelMessageId, "new");
  f.state.volume = 120; await f.panel.flush();
  assert.equal(f.events.at(-1), "edit:new");
});

test("same-instance seek, effects, retries, voice recovery, loop replay and startup never repost", async () => {
  const f = fixture();
  for (const reason of ["seek", "effects", "403", "short-stream", "voice", "loop-track"]) {
    f.state.current = { ...f.state.current, reason };
    f.panel.trackStarted(f.state.current);
    assert.equal(f.timers.size, 0);
  }
  f.state.current.panelInstanceId = "restored";
  f.panel.trackStarted(f.state.current, { restoring: true });
  await f.panel.reattach();
  assert.deepEqual(f.events, ["edit:old"]);
});

test("pause, resume, volume, queue and suggestion changes edit the existing panel", async () => {
  const f = fixture();
  for (const status of ["paused", "playing"]) {
    f.state.player = { state: { status } }; f.panel.scheduleUpdate(); await f.tick();
  }
  f.state.volume = 99; f.panel.scheduleUpdate(); await f.tick();
  f.state.queue.push({ ...f.state.current, title: "Waiting" }); f.panel.scheduleUpdate(); await f.tick();
  assert.deepEqual(f.events, Array(4).fill("edit:old"));
});

test("rapid skips restart debounce, supersede pending edits, and idle cancels repost", async () => {
  const f = fixture(); f.state.volume = 99; f.panel.scheduleUpdate();
  f.start("two"); f.start("three"); f.start("four"); f.panel.scheduleUpdate();
  assert.equal(f.timers.size, 1); await f.tick();
  assert.equal(f.events.filter(e => e === "send").length, 1);
  const idle = fixture(); idle.start(); idle.state.current = null; idle.panel.scheduleUpdate(); await idle.tick();
  assert.deepEqual(idle.events, ["edit:old"]);
});

test("newest panel edits in place, send failure falls back once, delete failure is quiet", async () => {
  const newest = fixture(); newest.channel.lastMessageId = "old"; newest.start(); await newest.tick();
  assert.deepEqual(newest.events, ["edit:old"]);
  const denied = fixture(); denied.channel.send = async () => { throw new Error("denied"); };
  denied.start(); await denied.tick();
  assert.deepEqual(denied.events, ["log", "edit:old"]); assert.equal(denied.state.panelMessageId, "old");
  const deleted = fixture(); deleted.old.delete = async () => { throw { code: 10008 }; };
  deleted.start(); await deleted.tick();
  assert.deepEqual(deleted.events, ["send", "persist:new"]); assert.equal(deleted.state.panelMessageId, "new");
});

test("pending persistence gates deletion and old-message clicks acknowledge and refresh stored panel", async () => {
  const f = fixture(); let release;
  f.panel.onIdentity = () => new Promise(resolve => { release = resolve; });
  f.start(); const swapping = f.tick(); await new Promise(setImmediate);
  assert.equal(f.state.panelMessageId, "new"); assert.deepEqual(f.events, ["send"]);
  const interaction = { customId: "panel:lyrics", isButton: () => true, guild: { id: "guild" }, user: { id: "listener" },
    message: { id: "old" }, reply: async () => f.events.push("acknowledge") };
  await createPanelInteractionHandler({ getMusic: () => f.state })(interaction);
  release(); await swapping;
  assert.deepEqual(f.events, ["send", "acknowledge", "delete:old"]);
  f.state.volume = 90; await f.tick(); assert.equal(f.events.at(-1), "edit:new");
});

test("an edit in progress finishes before swap, and queued edits cannot return to old IDs", async () => {
  const f = fixture(); let release;
  f.old.edit = () => new Promise(resolve => { release = resolve; });
  const editing = f.panel.flush(); await new Promise(setImmediate);
  f.start(); const repost = f.tick(); const queuedEdit = f.panel.flush();
  assert.deepEqual(f.events, []); release(); await Promise.all([editing, repost, queuedEdit]);
  assert.deepEqual(f.events, ["send", "persist:new", "delete:old"]);
  assert.equal(f.state.panelMessageId, "new");
});

test("failed persistence leaves old panel undeleted; missing channel clears both stored IDs", async () => {
  const failed = fixture(); failed.panel.onIdentity = async () => { throw new Error("disk unavailable"); };
  failed.start(); await failed.tick(); assert.deepEqual(failed.events, ["send", "log"]);
  const missing = fixture(); missing.panel.getChannel = async () => { throw { code: 10003 }; };
  missing.start(); await missing.tick();
  assert.equal(missing.state.panelChannelId, null); assert.equal(missing.state.panelMessageId, null);
});

test("track IDs survive copies and differ for separate instances; parentheses stay plain and mentions/brackets safe", () => {
  const f = fixture(), first = {}, second = {};
  assert.notEqual(f.panel.identifyTrack(first), f.panel.identifyTrack(second));
  assert.equal(f.panel.identifyTrack({ ...first }), first.panelInstanceId);
  const title = "Closer (Video) [x] @everyone <@&123>";
  const text = escapePanelText(title);
  assert.ok(text.includes("(Video) \\[x\\]")); assert.ok(!text.includes("\\("));
  assert.ok(!text.includes("@everyone")); assert.ok(!text.includes("<@&123>"));
  const description = buildPlayerPanel({ current: { ...f.state.current, title }, queue: [{ ...f.state.current, title }] }).embeds[0].description;
  assert.ok(!description.includes("\\(")); assert.ok(description.includes("\\[x\\]"));
});
